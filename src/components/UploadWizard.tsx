import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Upload,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { CANONICAL_FIELDS, autoMatchColumns } from '../lib/clean/aliases';
import { runCleaningPipeline } from '../lib/clean/pipeline';
import { createBlankCsvTemplate } from '../lib/demo/generator';
import { parseClipboardTextInWorker, parseFileInWorker } from '../lib/parse/parseFile';
import type { UploadSnapshot } from '../types/workforce';

interface UploadWizardProps {
  onClose?: () => void;
  onComplete?: () => void;
}

export const UploadWizard: React.FC<UploadWizardProps> = ({ onClose, onComplete }) => {
  const {
    snapshots,
    activeSnapshot,
    settings,
    columnMapping: savedMapping,
    saveUploadedSnapshot,
    pushToast,
  } = useWorkforce();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [sheetNames, setSheetNames] = useState<string[] | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [disabledRuleIds, setDisabledRuleIds] = useState<Set<string>>(new Set());
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const [mergeMode, setMergeMode] = useState<'upsert' | 'replace' | 'snapshot'>('upsert');
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleDownloadTemplate = () => {
    const csv = createBlankCsvTemplate();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hay-workforce-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const processParsed = (
    name: string,
    parsedHeaders: string[],
    parsedRows: Array<Record<string, unknown>>
  ) => {
    if (parsedRows.length === 0) {
      setErrorMsg('The file contains headers but zero data rows.');
      return;
    }
    setFileName(name);
    setHeaders(parsedHeaders);
    setRawRows(parsedRows);
    const auto = autoMatchColumns(parsedHeaders, savedMapping);
    setMapping(auto);
    setSheetNames(null);
    setStep(2);
  };

  const handleFile = async (file: File, sheet?: string) => {
    setErrorMsg(null);
    setParsing(true);
    setParseProgress(5);
    try {
      const outcome = await parseFileInWorker(file, setParseProgress, sheet);
      if (outcome.kind === 'sheets') {
        setPendingFile(file);
        setSheetNames(outcome.sheetNames);
        setParsing(false);
        return;
      }
      processParsed(
        sheet ? `${file.name} [${sheet}]` : file.name,
        outcome.result.headers,
        outcome.result.rows
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse file.');
    } finally {
      setParsing(false);
    }
  };

  const handlePasteSubmit = async () => {
    setErrorMsg(null);
    setParsing(true);
    setParseProgress(10);
    try {
      const res = await parseClipboardTextInWorker(pasteText, setParseProgress);
      processParsed('Clipboard Paste', res.headers, res.rows);
      setPasteOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse pasted data.');
    } finally {
      setParsing(false);
    }
  };

  const missingRequiredFields = useMemo(
    () => CANONICAL_FIELDS.filter((f) => f.required && !mapping[f.key]),
    [mapping]
  );

  const cleaningPreview = useMemo(() => {
    if (step < 3 || rawRows.length === 0) return null;
    return runCleaningPipeline(rawRows, {
      mapping,
      settings,
      disabledRuleIds,
      previousSnapshotEmployees: activeSnapshot?.isDemo ? undefined : activeSnapshot?.employees,
    });
  }, [step, rawRows, mapping, settings, disabledRuleIds, activeSnapshot]);

  const hasExistingRealData = snapshots.length > 0 && !activeSnapshot?.isDemo;

  const handleConfirmSave = async () => {
    if (!cleaningPreview) return;
    if (hasExistingRealData && mergeMode === 'replace' && replaceConfirmText.trim() !== 'REPLACE') {
      setErrorMsg('Type REPLACE in capital letters to confirm replacing all existing data.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const snapshot: UploadSnapshot = {
        id: `snap_${Date.now()}`,
        fileName,
        uploadedAt: new Date().toISOString(),
        rowCount: cleaningPreview.employees.length,
        isDemo: false,
        engagementScaleMax: cleaningPreview.engagementScaleMax,
        latestLastUpdated: cleaningPreview.latestLastUpdated,
        dataQualityReport: cleaningPreview.report,
        columnMapping: mapping,
        employees: cleaningPreview.employees,
      };
      await saveUploadedSnapshot(snapshot, hasExistingRealData ? mergeMode : 'replace');
      onComplete?.();
      onClose?.();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to save data.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = (ruleId: string) => {
    setDisabledRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  return (
    <div className="card-surface p-6 flex flex-col gap-5 max-w-5xl w-full mx-auto">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="font-page-title text-xl font-semibold text-[var(--brown)]">
            Upload Workforce Data
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Step {step} of 4 ·{' '}
            {step === 1
              ? 'Choose file or paste table'
              : step === 2
              ? 'Map columns'
              : step === 3
              ? 'Review automatic cleaning'
              : 'Confirm and save'}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload wizard"
            className="w-8 h-8 rounded-lg border border-[var(--border)] inline-flex items-center justify-center text-[var(--brown)] hover:bg-[var(--cream)]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Stepper indicator */}
      <ol className="grid grid-cols-4 gap-2 text-xs">
        {[
          { n: 1, label: '1. Choose file' },
          { n: 2, label: '2. Map columns' },
          { n: 3, label: '3. Review cleaning' },
          { n: 4, label: '4. Confirm & save' },
        ].map((s) => (
          <li
            key={s.n}
            className={`px-3 py-2 rounded-lg border font-medium truncate ${
              step === s.n
                ? 'bg-[var(--amber)] text-[var(--ink-on-amber)] border-[var(--amber)]'
                : step > s.n
                ? 'bg-[var(--olive-tint)] text-[var(--olive-text)] border-[var(--olive)]/30'
                : 'bg-[var(--cream)]/40 text-[var(--muted)] border-[var(--border)]'
            }`}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--risk-critical)] bg-[var(--oxblood-tint)] text-[var(--risk-critical)] px-4 py-3 text-xs flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className="border-2 border-dashed border-[var(--border)] hover:border-[var(--amber)] rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-[var(--cream)]/30 transition-colors text-center"
          >
            <Upload className="w-8 h-8 text-[var(--brown)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[var(--brown)]">
                Drag and drop a workforce file here, or click to browse
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                Maximum 20 MB · Up to 100,000 rows · Parsed locally in your browser
              </p>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.json,.ndjson,.xml"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-[var(--muted)] mt-1">
              {['.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.txt', '.json', '.ndjson', '.xml'].map((ext) => (
                <span
                  key={ext}
                  className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]"
                >
                  {ext}
                </span>
              ))}
            </div>
          </label>

          {parsing && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-[var(--brown)]">
                <span>Parsing file in background worker...</span>
                <span className="tabular-nums">{parseProgress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[var(--cream)] overflow-hidden">
                <div
                  className="h-full bg-[var(--amber)] transition-all"
                  style={{ width: `${parseProgress}%` }}
                />
              </div>
            </div>
          )}

          {sheetNames && pendingFile && (
            <div className="rounded-lg border border-[var(--amber)] bg-[var(--amber-tint)] p-4 flex flex-col gap-2">
              <p className="text-xs font-semibold text-[var(--ink-on-amber)]">
                This workbook has multiple sheets. Select the sheet to import:
              </p>
              <div className="flex flex-wrap gap-2">
                {sheetNames.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleFile(pendingFile, s)}
                    className="btn-primary px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-2"
            >
              <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
              Paste tabular text from clipboard
            </button>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="btn-secondary px-3 py-2 text-xs inline-flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Download blank CSV template
            </button>
          </div>

          {pasteOpen && (
            <div className="flex flex-col gap-2 border border-[var(--border)] rounded-lg p-3 bg-[var(--cream)]/30">
              <textarea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste CSV, TSV, or JSON rows with headers..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs font-mono text-[var(--brown)]"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePasteSubmit}
                  className="btn-primary px-4 py-1.5 text-xs"
                >
                  Parse pasted text
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--muted)]">
              Source: <strong className="text-[var(--brown)]">{fileName}</strong> ·{' '}
              <span className="tabular-nums">{rawRows.length.toLocaleString()}</span> rows read
            </p>
            {missingRequiredFields.length > 0 && (
              <span className="text-xs font-medium text-[var(--risk-critical)]">
                {missingRequiredFields.length} required column(s) need mapping
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
            {CANONICAL_FIELDS.map((field) => {
              const matched = mapping[field.key] ?? '';
              const isOk = Boolean(matched);
              return (
                <div
                  key={field.key}
                  className={`rounded-lg border p-2.5 flex flex-col gap-1.5 ${
                    !isOk && field.required
                      ? 'border-[var(--risk-critical)] bg-[var(--oxblood-tint)]/40'
                      : 'border-[var(--border)] bg-[var(--cream)]/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--brown)]">
                      {field.label}
                      {field.required && <span className="text-[var(--risk-critical)]"> *</span>}
                    </span>
                    {isOk && (
                      <CheckCircle2
                        className="w-3.5 h-3.5 text-[var(--olive-text)] shrink-0"
                        aria-label="Matched"
                      />
                    )}
                  </div>
                  <select
                    value={matched}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    className="h-8 px-2 rounded border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--brown)]"
                  >
                    <option value="">-- Not mapped --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div>
            <p className="text-xs font-semibold text-[var(--brown)] mb-1.5">
              Preview (first 10 source rows)
            </p>
            <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[var(--cream)] text-[var(--brown)]">
                  <tr>
                    {headers.slice(0, 8).map((h) => (
                      <th key={h} className="px-2.5 py-2 font-semibold border-b border-[var(--border)] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-b border-[var(--border)]/60">
                      {headers.slice(0, 8).map((h) => (
                        <td key={h} className="px-2.5 py-1.5 text-[var(--brown)] whitespace-nowrap max-w-[160px] truncate">
                          {String(r[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              disabled={missingRequiredFields.length > 0}
              onClick={() => setStep(3)}
              className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              Review cleaning
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && cleaningPreview && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-3">
              <p className="text-xs text-[var(--muted)]">Rows read</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.report.totalRowsRead.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-3">
              <p className="text-xs text-[var(--muted)]">Duplicates / Conflicts</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.report.duplicatesRemoved +
                  cleaningPreview.report.conflictsResolved.length}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-3">
              <p className="text-xs text-[var(--muted)]">Cells imputed / Outliers</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.report.imputedCellsCount} / {cleaningPreview.report.outliersFlaggedCount}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-3">
              <p className="text-xs text-[var(--muted)]">Rows rejected</p>
              <p className="text-xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.report.rejectedRows.length}
              </p>
            </div>
          </div>

          <p className="text-xs text-[var(--muted)]">
            {cleaningPreview.report.ambiguousDateAssumption} Detected Engagement Scale: 0 to{' '}
            <strong className="text-[var(--brown)]">{cleaningPreview.engagementScaleMax}</strong>.
          </p>

          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {cleaningPreview.report.cleaningDecisions.map((dec) => (
              <div
                key={dec.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--brown)]">
                      {dec.ruleName}{' '}
                      <span className="font-normal text-[var(--muted)] tabular-nums">
                        ({dec.affectedCount} affected)
                      </span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">{dec.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRuleId(expandedRuleId === dec.id ? null : dec.id)
                      }
                      className="text-xs underline text-[var(--brown)]"
                    >
                      {expandedRuleId === dec.id ? 'Hide detail' : 'Detail'}
                    </button>
                    {dec.ruleId !== 'deduplicate_exact' && dec.ruleId !== 'deduplicate_conflict' && (
                      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!disabledRuleIds.has(dec.ruleId)}
                          onChange={() => toggleRule(dec.ruleId)}
                          className="accent-[var(--amber)]"
                        />
                        Apply
                      </label>
                    )}
                  </div>
                </div>
                {expandedRuleId === dec.id && dec.samples.length > 0 && (
                  <div className="text-[11px] bg-[var(--cream)]/40 rounded p-2 font-mono text-[var(--brown)]">
                    {dec.samples.map((s, idx) => (
                      <div key={idx}>
                        {s.employeeId} · {s.field}: &ldquo;{s.from}&rdquo; → &ldquo;{s.to}&rdquo;
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {cleaningPreview.report.ruleFailures.length > 0 && (
              <div className="rounded-lg border border-[var(--risk-high)]/40 bg-[var(--sienna-tint)]/50 p-3">
                <p className="text-xs font-semibold text-[var(--risk-high)] mb-1">
                  Integrity checks flagged (rows kept and marked)
                </p>
                <ul className="text-xs text-[var(--brown)] space-y-0.5">
                  {cleaningPreview.report.ruleFailures.map((rf) => (
                    <li key={rf.rule}>
                      • {rf.rule}: {rf.count} rows ({rf.description})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="btn-primary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              Next: Confirm & save
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && cleaningPreview && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-4">
              <p className="text-xs text-[var(--muted)]">Final valid employees</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.employees.length.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-4">
              <p className="text-xs text-[var(--muted)]">Data Quality Score</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--brown)]">
                {cleaningPreview.report.overallScore} / 100
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--cream)]/40 p-4">
              <p className="text-xs text-[var(--muted)]">Exit target column</p>
              <p className="text-sm font-semibold text-[var(--brown)] mt-1">
                {cleaningPreview.employees.some((e) => e.exitTarget !== undefined)
                  ? 'Detected (supervised ML available)'
                  : 'Not present (Retention Risk Index)'}
              </p>
            </div>
          </div>

          {hasExistingRealData && (
            <div className="rounded-lg border border-[var(--amber)] bg-[var(--amber-tint)]/60 p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-[var(--brown)]">
                Saved workforce data already exists ({activeSnapshot?.rowCount.toLocaleString()} employees). How should this upload be combined?
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                <label className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 cursor-pointer flex items-start gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    checked={mergeMode === 'upsert'}
                    onChange={() => setMergeMode('upsert')}
                    className="mt-0.5 accent-[var(--amber)]"
                  />
                  <span>
                    <strong className="block text-[var(--brown)]">Update & add (Recommended)</strong>
                    <span className="text-[var(--muted)]">Upsert by Employee ID and keep a history snapshot.</span>
                  </span>
                </label>

                <label className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 cursor-pointer flex items-start gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    checked={mergeMode === 'snapshot'}
                    onChange={() => setMergeMode('snapshot')}
                    className="mt-0.5 accent-[var(--amber)]"
                  />
                  <span>
                    <strong className="block text-[var(--brown)]">Keep as separate snapshot</strong>
                    <span className="text-[var(--muted)]">Compare trends across up to 12 snapshots.</span>
                  </span>
                </label>

                <label className="rounded-lg border border-[var(--risk-critical)]/40 bg-[var(--surface)] p-3 cursor-pointer flex items-start gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    checked={mergeMode === 'replace'}
                    onChange={() => setMergeMode('replace')}
                    className="mt-0.5 accent-[var(--risk-critical)]"
                  />
                  <span>
                    <strong className="block text-[var(--risk-critical)]">Replace everything</strong>
                    <span className="text-[var(--muted)]">Removes all prior snapshots and records.</span>
                  </span>
                </label>
              </div>

              {mergeMode === 'replace' && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-[var(--risk-critical)]">
                    Type REPLACE to confirm:
                  </label>
                  <input
                    type="text"
                    value={replaceConfirmText}
                    onChange={(e) => setReplaceConfirmText(e.target.value)}
                    placeholder="REPLACE"
                    className="h-8 px-2.5 rounded border border-[var(--risk-critical)] bg-[var(--surface)] text-xs text-[var(--brown)]"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="btn-secondary px-4 py-2 text-xs inline-flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Back
            </button>
            <div className="flex items-center gap-2">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmSave}
                className="btn-primary px-5 py-2 text-xs"
              >
                {saving ? 'Saving to IndexedDB...' : 'Save workforce data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
