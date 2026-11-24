import type { ParsedTableResult, ParseWorkerResponse } from './parseWorker';

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export type ParseOutcome =
  | { kind: 'sheets'; sheetNames: string[] }
  | { kind: 'result'; result: ParsedTableResult };

export function validateFileSizeAndExt(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) {
    return `File "${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the 20 MB limit. Split the file or remove unused columns and try again.`;
  }
  const allowed = ['.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.txt', '.json', '.ndjson', '.xml'];
  const lower = file.name.toLowerCase();
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    return `Unsupported file type for "${file.name}". Upload .xlsx, .xls, .xlsm, .csv, .tsv, .txt, .json, .ndjson, or .xml.`;
  }
  return null;
}

export async function parseFileInWorker(
  file: File,
  onProgress: (pct: number) => void,
  selectedSheet?: string
): Promise<ParseOutcome> {
  const err = validateFileSizeAndExt(file);
  if (err) throw new Error(err);

  const buffer = await file.arrayBuffer();
  return new Promise<ParseOutcome>((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.ts', import.meta.url), {
      type: 'module',
    });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress' && msg.progress !== undefined) {
        onProgress(msg.progress);
      } else if (msg.type === 'sheets' && msg.sheetNames) {
        worker.terminate();
        resolve({ kind: 'sheets', sheetNames: msg.sheetNames });
      } else if (msg.type === 'result' && msg.result) {
        worker.terminate();
        resolve({ kind: 'result', result: msg.result });
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.error ?? 'Failed to parse file.'));
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker failed while parsing the file.'));
    };

    worker.postMessage({
      id,
      action: 'parse_file',
      fileName: file.name,
      buffer,
      selectedSheet,
    });
  });
}

export async function parseClipboardTextInWorker(
  text: string,
  onProgress: (pct: number) => void
): Promise<ParsedTableResult> {
  if (!text.trim()) {
    throw new Error('Paste tabular CSV, TSV, or JSON text before continuing.');
  }
  return new Promise<ParsedTableResult>((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.ts', import.meta.url), {
      type: 'module',
    });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress' && msg.progress !== undefined) {
        onProgress(msg.progress);
      } else if (msg.type === 'result' && msg.result) {
        worker.terminate();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.error ?? 'Failed to parse pasted text.'));
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker failed while parsing pasted text.'));
    };

    worker.postMessage({
      id,
      action: 'parse_text',
      text,
    });
  });
}
