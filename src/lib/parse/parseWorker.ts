import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export interface ParsedTableResult {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  sheetNames?: string[];
  selectedSheet?: string;
  format: string;
}

export interface ParseWorkerRequest {
  id: string;
  action: 'parse_file' | 'parse_text';
  fileName?: string;
  buffer?: ArrayBuffer;
  text?: string;
  selectedSheet?: string;
}

export interface ParseWorkerResponse {
  id: string;
  type: 'progress' | 'sheets' | 'result' | 'error';
  progress?: number;
  sheetNames?: string[];
  result?: ParsedTableResult;
  error?: string;
}

const MAX_ROWS = 100_000;

function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Check UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // Check UTF-16 LE/BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  // Try strict UTF-8 first, fall back to Windows-1252
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function parseXmlRecords(xmlText: string): ParsedTableResult {
  // Simple, reliable flat repeating-record XML parser usable inside a Web Worker (no DOMParser needed)
  const cleaned = xmlText.replace(/<\?xml[^>]*\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const rootMatch = cleaned.match(/^<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*)<\/\1>$/);
  const body = rootMatch ? rootMatch[2] : cleaned;

  const rows: Array<Record<string, unknown>> = [];
  const headerSet = new Set<string>();

  const recordRegex = /<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let recMatch: RegExpExecArray | null;
  while ((recMatch = recordRegex.exec(body)) !== null) {
    const inner = recMatch[2];
    const row: Record<string, unknown> = {};
    const fieldRegex = /<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(inner)) !== null) {
      const key = fieldMatch[1];
      const val = fieldMatch[2]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
      row[key] = val;
      headerSet.add(key);
    }
    if (Object.keys(row).length > 0) {
      rows.push(row);
      if (rows.length > MAX_ROWS) {
        throw new Error(`File exceeds the maximum of ${MAX_ROWS.toLocaleString()} rows.`);
      }
    }
  }

  return {
    headers: Array.from(headerSet),
    rows,
    format: 'xml',
  };
}

function normalizeObjectArray(arr: unknown[], format: string): ParsedTableResult {
  if (arr.length > MAX_ROWS) {
    throw new Error(`File exceeds the maximum of ${MAX_ROWS.toLocaleString()} rows.`);
  }
  const headerSet = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const item of arr) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      Object.keys(rec).forEach((k) => headerSet.add(k));
      rows.push(rec);
    }
  }
  return {
    headers: Array.from(headerSet),
    rows,
    format,
  };
}

function parseDelimitedText(text: string, format: string): ParsedTableResult {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('The uploaded file or pasted text is empty.');
  }
  const parsed = Papa.parse<Record<string, unknown>>(trimmed, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`Could not parse delimited text: ${parsed.errors[0].message}`);
  }
  if (parsed.data.length > MAX_ROWS) {
    throw new Error(`File exceeds the maximum of ${MAX_ROWS.toLocaleString()} rows.`);
  }
  const headers = parsed.meta.fields ?? (parsed.data[0] ? Object.keys(parsed.data[0]) : []);
  return {
    headers,
    rows: parsed.data,
    format,
  };
}

self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const { id, action, fileName = '', buffer, text, selectedSheet } = event.data;

  const post = (msg: Omit<ParseWorkerResponse, 'id'>) => {
    self.postMessage({ id, ...msg });
  };

  try {
    post({ type: 'progress', progress: 15 });

    if (action === 'parse_text' && text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsedJson = JSON.parse(trimmed);
          const arr = Array.isArray(parsedJson)
            ? parsedJson
            : Object.values(parsedJson).find((v) => Array.isArray(v));
          if (Array.isArray(arr)) {
            post({ type: 'progress', progress: 100 });
            post({ type: 'result', result: normalizeObjectArray(arr, 'json') });
            return;
          }
        } catch {
          // Fall through to delimited parser
        }
      }
      const res = parseDelimitedText(trimmed, 'clipboard');
      post({ type: 'progress', progress: 100 });
      post({ type: 'result', result: res });
      return;
    }

    if (!buffer) {
      throw new Error('No file contents were received.');
    }

    const lower = fileName.toLowerCase();

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
      post({ type: 'progress', progress: 40 });
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      if (wb.SheetNames.length === 0) {
        throw new Error('The workbook contains no sheets.');
      }
      if (wb.SheetNames.length > 1 && !selectedSheet) {
        post({ type: 'sheets', sheetNames: wb.SheetNames });
        return;
      }
      const targetSheet = selectedSheet ?? wb.SheetNames[0];
      const ws = wb.Sheets[targetSheet];
      if (!ws) {
        throw new Error(`Sheet "${targetSheet}" was not found in the workbook.`);
      }
      post({ type: 'progress', progress: 75 });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: '',
        raw: true,
      });
      if (rows.length > MAX_ROWS) {
        throw new Error(`Sheet exceeds the maximum of ${MAX_ROWS.toLocaleString()} rows.`);
      }
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      post({ type: 'progress', progress: 100 });
      post({
        type: 'result',
        result: {
          headers,
          rows,
          sheetNames: wb.SheetNames,
          selectedSheet: targetSheet,
          format: lower.split('.').pop() ?? 'xlsx',
        },
      });
      return;
    }

    const decoded = decodeTextBuffer(buffer);
    post({ type: 'progress', progress: 50 });

    if (lower.endsWith('.json')) {
      const parsed = JSON.parse(decoded);
      const arr = Array.isArray(parsed)
        ? parsed
        : Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
      if (!Array.isArray(arr)) {
        throw new Error('JSON file must contain an array of records or an object with a single array property.');
      }
      post({ type: 'progress', progress: 100 });
      post({ type: 'result', result: normalizeObjectArray(arr, 'json') });
      return;
    }

    if (lower.endsWith('.ndjson')) {
      const lines = decoded
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const arr = lines.map((l) => JSON.parse(l));
      post({ type: 'progress', progress: 100 });
      post({ type: 'result', result: normalizeObjectArray(arr, 'ndjson') });
      return;
    }

    if (lower.endsWith('.xml')) {
      const res = parseXmlRecords(decoded);
      if (res.rows.length === 0) {
        throw new Error('No repeating XML records could be extracted. Ensure the XML has flat repeating record elements.');
      }
      post({ type: 'progress', progress: 100 });
      post({ type: 'result', result: res });
      return;
    }

    // Default: CSV / TSV / TXT via PapaParse auto-delimiter
    const ext = lower.split('.').pop() ?? 'csv';
    const res = parseDelimitedText(decoded, ext);
    post({ type: 'progress', progress: 100 });
    post({ type: 'result', result: res });
  } catch (err) {
    post({
      type: 'error',
      error: err instanceof Error ? err.message : 'Unable to parse file.',
    });
  }
};
