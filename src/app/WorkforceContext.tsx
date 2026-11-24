import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_SETTINGS,
  INITIAL_FILTER_STATE,
  type ChatMessage,
  type EmployeeRecord,
  type GlobalFilterState,
  type RiskMode,
  type SavedRecommendationRecord,
  type SignalCode,
  type TrainedModelSummary,
  type UploadSnapshot,
  type WorkforceSettings,
} from '../types/workforce';
import {
  clearAllDataInDb,
  clearChatHistoryInDb,
  loadPersistedState,
  replaceAllSnapshotsInDb,
  saveChatMessageToDb,
  saveModelToDb,
  saveRecommendationToDb,
  saveSettingsToDb,
  saveSnapshotToDb,
} from '../lib/db/database';
import { runCleaningPipeline, reconcileTaskTotals } from '../lib/clean/pipeline';
import { enrichSignalsAndScores, getRiskBand } from '../lib/features/signals';
import { DEMO_COLUMN_MAPPING, generateDemoRawRows } from '../lib/demo/generator';
import {
  computeHeadlineKpis,
  filterEmployees,
  getCascadingFilterCounts,
  type HeadlineKpis,
} from '../lib/metrics';
import { checkSupervisedEligibility } from '../lib/ml/mlRunner';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface WorkforceContextValue {
  loading: boolean;
  inMemoryFallback: boolean;
  snapshots: UploadSnapshot[];
  activeSnapshot: UploadSnapshot | null;
  previousSnapshot: UploadSnapshot | null;
  allEmployees: EmployeeRecord[];
  filteredEmployees: EmployeeRecord[];
  kpis: HeadlineKpis;
  cascadingCounts: ReturnType<typeof getCascadingFilterCounts>;
  settings: WorkforceSettings;
  privacyMode: boolean;
  setPrivacyMode: (v: boolean) => void;
  filters: GlobalFilterState;
  setFilters: (next: GlobalFilterState | ((prev: GlobalFilterState) => GlobalFilterState)) => void;
  undoFilters: () => void;
  canUndoFilters: boolean;
  clearFilters: () => void;
  toggleFilterValue: <K extends keyof GlobalFilterState>(
    key: K,
    value: GlobalFilterState[K] extends Array<infer U> ? U : never
  ) => void;
  models: TrainedModelSummary[];
  activeModel: TrainedModelSummary | null;
  supervisedEligibility: ReturnType<typeof checkSupervisedEligibility>;
  recommendations: SavedRecommendationRecord[];
  chatHistory: ChatMessage[];
  columnMapping: Record<string, string>;
  aiServerAvailable: boolean | null;
  assistantDrawerOpen: boolean;
  setAssistantDrawerOpen: (v: boolean) => void;
  tourOpen: boolean;
  setTourOpen: (v: boolean) => void;
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  loadDemoData: () => Promise<void>;
  saveUploadedSnapshot: (
    snapshot: UploadSnapshot,
    mode: 'upsert' | 'replace' | 'snapshot'
  ) => Promise<void>;
  switchActiveSnapshot: (snapshotId: string) => void;
  reconcileAllTasks: () => Promise<void>;
  updateSettings: (patch: Partial<WorkforceSettings>) => Promise<void>;
  saveTrainedModel: (model: TrainedModelSummary) => Promise<void>;
  saveRecommendation: (rec: SavedRecommendationRecord) => Promise<void>;
  appendChatMessage: (msg: ChatMessage) => Promise<void>;
  clearChatHistory: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

const WorkforceContext = createContext<WorkforceContextValue | null>(null);

function filtersToSearchParams(f: GlobalFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (f.departments.length) params.set('dept', f.departments.join(','));
  if (f.locations.length) params.set('loc', f.locations.join(','));
  if (f.workStatuses.length) params.set('status', f.workStatuses.join(','));
  if (f.jobLevels.length) params.set('level', f.jobLevels.join(','));
  if (f.workArrangements.length) params.set('arr', f.workArrangements.join(','));
  if (f.workloadLevels.length) params.set('load', f.workloadLevels.join(','));
  if (f.attentionStatuses.length) params.set('att', f.attentionStatuses.join(','));
  if (f.riskBands.length) params.set('risk', f.riskBands.join(','));
  if (f.signalTypes.length) params.set('sig', f.signalTypes.join(','));
  if (f.tenureBands.length) params.set('ten', f.tenureBands.join(','));
  if (f.staleOnly) params.set('stale', '1');
  if (f.engagementRange[0] !== 0 || f.engagementRange[1] !== 100) {
    params.set('eng', `${f.engagementRange[0]}-${f.engagementRange[1]}`);
  }
  if (f.search) params.set('q', f.search);
  return params;
}

function searchParamsToFilters(params: URLSearchParams): GlobalFilterState | null {
  const keys = ['dept', 'loc', 'status', 'level', 'arr', 'load', 'att', 'risk', 'sig', 'ten', 'stale', 'eng', 'q'];
  if (!keys.some((k) => params.has(k))) return null;
  const split = (k: string) => (params.get(k) ? params.get(k)!.split(',').filter(Boolean) : []);
  const engRaw = params.get('eng')?.split('-').map(Number);
  return {
    departments: split('dept'),
    locations: split('loc'),
    workStatuses: split('status') as GlobalFilterState['workStatuses'],
    jobLevels: split('level'),
    workArrangements: split('arr') as GlobalFilterState['workArrangements'],
    workloadLevels: split('load') as GlobalFilterState['workloadLevels'],
    attentionStatuses: split('att') as GlobalFilterState['attentionStatuses'],
    riskBands: split('risk') as GlobalFilterState['riskBands'],
    signalTypes: split('sig') as Array<SignalCode | 'missed_warning_signs'>,
    tenureBands: split('ten'),
    staleOnly: params.get('stale') === '1',
    engagementRange:
      engRaw && engRaw.length === 2 && !Number.isNaN(engRaw[0]) && !Number.isNaN(engRaw[1])
        ? [engRaw[0], engRaw[1]]
        : [0, 100],
    search: params.get('q') ?? '',
  };
}

export const WorkforceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [inMemoryFallback, setInMemoryFallback] = useState(false);
  const [snapshots, setSnapshots] = useState<UploadSnapshot[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkforceSettings>(DEFAULT_SETTINGS);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [models, setModels] = useState<TrainedModelSummary[]>([]);
  const [recommendations, setRecommendations] = useState<SavedRecommendationRecord[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [aiServerAvailable, setAiServerAvailable] = useState<boolean | null>(null);
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const [filters, setFiltersState] = useState<GlobalFilterState>(() => {
    const fromUrl = searchParamsToFilters(searchParams);
    if (fromUrl) return fromUrl;
    try {
      const saved = localStorage.getItem('hay_last_filters');
      if (saved) return { ...INITIAL_FILTER_STATE, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return INITIAL_FILTER_STATE;
  });
  const filterHistoryRef = useRef<GlobalFilterState[]>([]);

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await loadPersistedState();
      if (cancelled) return;
      setSnapshots(state.snapshots);
      setActiveSnapshotId(state.activeSnapshotId);
      setSettings(state.settings);
      setPrivacyMode(state.settings.privacyModeDefault);
      setModels(state.models);
      setRecommendations(state.recommendations);
      setChatHistory(state.chatHistory);
      setColumnMapping(state.columnMapping);
      setInMemoryFallback(state.inMemoryFallback);
      setLoading(false);
    })();

    fetch('/api/ai/status')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAiServerAvailable(Boolean(d.available));
      })
      .catch(() => {
        if (!cancelled) setAiServerAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setFilters = useCallback(
    (next: GlobalFilterState | ((prev: GlobalFilterState) => GlobalFilterState)) => {
      setFiltersState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        filterHistoryRef.current = [...filterHistoryRef.current.slice(-14), prev];
        try {
          localStorage.setItem('hay_last_filters', JSON.stringify(resolved));
        } catch {
          // ignore
        }
        const nextParams = filtersToSearchParams(resolved);
        setSearchParams(nextParams, { replace: true });
        return resolved;
      });
    },
    [setSearchParams]
  );

  const undoFilters = useCallback(() => {
    const last = filterHistoryRef.current.pop();
    if (!last) return;
    setFiltersState(last);
    setSearchParams(filtersToSearchParams(last), { replace: true });
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    setFilters(INITIAL_FILTER_STATE);
  }, [setFilters]);

  const toggleFilterValue = useCallback(
    <K extends keyof GlobalFilterState>(
      key: K,
      value: GlobalFilterState[K] extends Array<infer U> ? U : never
    ) => {
      setFilters((prev) => {
        const currentArr = prev[key] as unknown[];
        const exists = currentArr.includes(value);
        const nextArr = exists
          ? currentArr.filter((v) => v !== value)
          : [...currentArr, value];
        return { ...prev, [key]: nextArr };
      });
    },
    [setFilters]
  );

  const activeSnapshot = useMemo(
    () => snapshots.find((s) => s.id === activeSnapshotId) ?? snapshots[0] ?? null,
    [snapshots, activeSnapshotId]
  );

  const previousSnapshot = useMemo(() => {
    if (!activeSnapshot) return null;
    const idx = snapshots.findIndex((s) => s.id === activeSnapshot.id);
    return idx >= 0 && idx + 1 < snapshots.length ? snapshots[idx + 1] : null;
  }, [snapshots, activeSnapshot]);

  const activeModel = useMemo(() => {
    if (settings.activeRiskMode === 'retention_index') return null;
    const match = models.find(
      (m) => m.mode === settings.activeRiskMode && m.snapshotId === activeSnapshot?.id
    );
    return match ?? models.find((m) => m.mode === settings.activeRiskMode) ?? null;
  }, [models, settings.activeRiskMode, activeSnapshot?.id]);

  // Apply active model probabilities if mode 2 or 3 is active and trained
  const allEmployees = useMemo(() => {
    const base = activeSnapshot?.employees ?? [];
    if (
      settings.activeRiskMode === 'retention_index' ||
      !activeModel ||
      Object.keys(activeModel.employeeProbabilities).length === 0
    ) {
      return base;
    }
    const scored = base.map((emp) => {
      const mRes = activeModel.employeeProbabilities[emp.employeeId];
      if (!mRes) return emp;
      const newScore = Math.round(mRes.probability);
      return {
        ...emp,
        riskScore: newScore,
        riskBand: getRiskBand(newScore),
        drivers: mRes.drivers.length > 0 ? mRes.drivers : emp.drivers,
      };
    });
    const byComp = [...scored].sort((a, b) => b.riskScore - a.riskScore);
    const rankMap = new Map(byComp.map((e, i) => [e.employeeId, i + 1]));
    return scored.map((e) => ({
      ...e,
      riskRankCompany: rankMap.get(e.employeeId) ?? e.riskRankCompany,
    }));
  }, [activeSnapshot, settings.activeRiskMode, activeModel]);

  const filteredEmployees = useMemo(
    () => filterEmployees(allEmployees, filters),
    [allEmployees, filters]
  );

  const kpis = useMemo(
    () =>
      computeHeadlineKpis(
        filteredEmployees,
        activeSnapshot?.engagementScaleMax ?? 10,
        previousSnapshot?.employees
      ),
    [filteredEmployees, activeSnapshot?.engagementScaleMax, previousSnapshot?.employees]
  );

  const cascadingCounts = useMemo(
    () => getCascadingFilterCounts(allEmployees, filters),
    [allEmployees, filters]
  );

  const supervisedEligibility = useMemo(
    () => checkSupervisedEligibility(allEmployees),
    [allEmployees]
  );

  const loadDemoData = useCallback(async () => {
    const raw = generateDemoRawRows();
    const cleaned = runCleaningPipeline(raw, {
      mapping: DEMO_COLUMN_MAPPING,
      settings,
      referenceTodayIso: '2026-11-24',
    });

    const demoSnapshot: UploadSnapshot = {
      id: `demo_${Date.now()}`,
      fileName: 'Hay_Demo_Workforce_300.csv (Demo data)',
      uploadedAt: new Date().toISOString(),
      rowCount: cleaned.employees.length,
      isDemo: true,
      engagementScaleMax: cleaned.engagementScaleMax,
      latestLastUpdated: cleaned.latestLastUpdated,
      dataQualityReport: cleaned.report,
      columnMapping: DEMO_COLUMN_MAPPING,
      employees: cleaned.employees,
    };

    const persisted = await replaceAllSnapshotsInDb(demoSnapshot);
    setInMemoryFallback(!persisted);
    setSnapshots([demoSnapshot]);
    setActiveSnapshotId(demoSnapshot.id);
    setColumnMapping(DEMO_COLUMN_MAPPING);
    setFiltersState(INITIAL_FILTER_STATE);
    setSearchParams(new URLSearchParams(), { replace: true });
    pushToast(`Loaded ${demoSnapshot.rowCount} synthetic demo employees for testing.`, 'success');
  }, [settings, pushToast, setSearchParams]);

  const saveUploadedSnapshot = useCallback(
    async (incoming: UploadSnapshot, mode: 'upsert' | 'replace' | 'snapshot') => {
      if (mode === 'replace' || snapshots.length === 0 || activeSnapshot?.isDemo) {
        const persisted = await replaceAllSnapshotsInDb(incoming);
        setInMemoryFallback(!persisted);
        setSnapshots([incoming]);
        setActiveSnapshotId(incoming.id);
        setColumnMapping(incoming.columnMapping);
        pushToast(`Saved ${incoming.rowCount} employees from ${incoming.fileName}.`, 'success');
        return;
      }

      if (mode === 'upsert' && activeSnapshot) {
        const mergedMap = new Map<string, EmployeeRecord>();
        for (const oldEmp of activeSnapshot.employees) {
          mergedMap.set(oldEmp.employeeId, oldEmp);
        }
        for (const newEmp of incoming.employees) {
          mergedMap.set(newEmp.employeeId, newEmp);
        }
        const mergedEmployees = enrichSignalsAndScores(
          Array.from(mergedMap.values()),
          settings,
          activeSnapshot.employees
        );
        const upsertedSnapshot: UploadSnapshot = {
          ...incoming,
          rowCount: mergedEmployees.length,
          employees: mergedEmployees,
        };
        const persisted = await saveSnapshotToDb(upsertedSnapshot);
        setInMemoryFallback(!persisted);
        setSnapshots((prev) => [upsertedSnapshot, ...prev].slice(0, 12));
        setActiveSnapshotId(upsertedSnapshot.id);
        setColumnMapping(incoming.columnMapping);
        pushToast(
          `Updated dataset (${upsertedSnapshot.rowCount} total employees) and kept previous snapshot.`,
          'success'
        );
        return;
      }

      // mode === 'snapshot'
      const persisted = await saveSnapshotToDb(incoming);
      setInMemoryFallback(!persisted);
      setSnapshots((prev) => [incoming, ...prev].slice(0, 12));
      setActiveSnapshotId(incoming.id);
      setColumnMapping(incoming.columnMapping);
      pushToast(`Saved snapshot "${incoming.fileName}" (${incoming.rowCount} employees).`, 'success');
    },
    [snapshots.length, activeSnapshot, settings, pushToast]
  );

  const switchActiveSnapshot = useCallback(
    (snapshotId: string) => {
      const target = snapshots.find((s) => s.id === snapshotId);
      if (!target) return;
      setActiveSnapshotId(snapshotId);
      pushToast(`Switched active snapshot to ${target.fileName}.`, 'info');
    },
    [snapshots, pushToast]
  );

  const reconcileAllTasks = useCallback(async () => {
    if (!activeSnapshot) return;
    const fixed = enrichSignalsAndScores(
      reconcileTaskTotals(activeSnapshot.employees),
      settings,
      previousSnapshot?.employees
    );
    const updatedSnap: UploadSnapshot = {
      ...activeSnapshot,
      employees: fixed,
      dataQualityReport: {
        ...activeSnapshot.dataQualityReport,
        ruleFailures: activeSnapshot.dataQualityReport.ruleFailures.filter(
          (r) => r.rule !== 'Task count reconciliation'
        ),
      },
    };
    await saveSnapshotToDb(updatedSnap);
    setSnapshots((prev) => prev.map((s) => (s.id === updatedSnap.id ? updatedSnap : s)));
    pushToast('Reconciled Total Tasks = Completed + Pending + Overdue across flagged rows.', 'success');
  }, [activeSnapshot, settings, previousSnapshot?.employees, pushToast]);

  const updateSettings = useCallback(
    async (patch: Partial<WorkforceSettings>) => {
      const next: WorkforceSettings = { ...settings, ...patch };
      // Check if risk mode requested without eligibility
      if (patch.activeRiskMode === 'supervised_attrition' && !supervisedEligibility.eligible) {
        next.activeRiskMode = settings.activeRiskMode;
        pushToast(supervisedEligibility.reason, 'warning');
        return;
      }
      setSettings(next);
      if (patch.privacyModeDefault !== undefined) {
        setPrivacyMode(patch.privacyModeDefault);
      }
      await saveSettingsToDb(next);

      // Recompute signals and composite scores on active snapshot
      if (activeSnapshot) {
        const recomputed = enrichSignalsAndScores(
          activeSnapshot.employees.map((e) => ({
            ...e,
            engagementPct: Math.min(
              100,
              Math.max(
                0,
                (e.engagementScore / (next.engagementScaleOverride ?? activeSnapshot.engagementScaleMax)) * 100
              )
            ),
            isStale: e.daysSinceUpdated > next.staleDaysThreshold,
          })),
          next,
          previousSnapshot?.employees
        );
        const updatedSnap: UploadSnapshot = {
          ...activeSnapshot,
          engagementScaleMax: next.engagementScaleOverride ?? activeSnapshot.engagementScaleMax,
          employees: recomputed,
        };
        setSnapshots((prev) => prev.map((s) => (s.id === updatedSnap.id ? updatedSnap : s)));
        await saveSnapshotToDb(updatedSnap);
      }
      pushToast('Settings saved and workforce scores updated.', 'success');
    },
    [settings, supervisedEligibility, activeSnapshot, previousSnapshot?.employees, pushToast]
  );

  const saveTrainedModel = useCallback(
    async (model: TrainedModelSummary) => {
      await saveModelToDb(model);
      setModels((prev) => [model, ...prev.filter((m) => m.id !== model.id)]);
      const nextMode: RiskMode = model.mode;
      const nextSettings: WorkforceSettings = {
        ...settings,
        activeRiskMode: nextMode,
        attentionProxyAccepted: nextMode === 'attention_proxy' ? true : settings.attentionProxyAccepted,
      };
      setSettings(nextSettings);
      await saveSettingsToDb(nextSettings);
      pushToast(`Trained ${model.mode.replace('_', ' ')} (${model.qualityLabel}).`, 'success');
    },
    [settings, pushToast]
  );

  const saveRecommendation = useCallback(
    async (rec: SavedRecommendationRecord) => {
      await saveRecommendationToDb(rec);
      setRecommendations((prev) => [rec, ...prev.filter((r) => r.id !== rec.id)]);
    },
    []
  );

  const appendChatMessage = useCallback(async (msg: ChatMessage) => {
    await saveChatMessageToDb(msg);
    setChatHistory((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = msg;
        return copy;
      }
      return [...prev, msg];
    });
  }, []);

  const clearChatHistory = useCallback(async () => {
    await clearChatHistoryInDb();
    setChatHistory([]);
    pushToast('Cleared conversation history.', 'info');
  }, [pushToast]);

  const clearAllData = useCallback(async () => {
    await clearAllDataInDb();
    setSnapshots([]);
    setActiveSnapshotId(null);
    setModels([]);
    setRecommendations([]);
    setChatHistory([]);
    setSettings(DEFAULT_SETTINGS);
    setFiltersState(INITIAL_FILTER_STATE);
    setSearchParams(new URLSearchParams(), { replace: true });
    pushToast('All saved workforce data has been cleared.', 'info');
  }, [pushToast, setSearchParams]);

  return (
    <WorkforceContext.Provider
      value={{
        loading,
        inMemoryFallback,
        snapshots,
        activeSnapshot,
        previousSnapshot,
        allEmployees,
        filteredEmployees,
        kpis,
        cascadingCounts,
        settings,
        privacyMode,
        setPrivacyMode,
        filters,
        setFilters,
        undoFilters,
        canUndoFilters: filterHistoryRef.current.length > 0,
        clearFilters,
        toggleFilterValue,
        models,
        activeModel,
        supervisedEligibility,
        recommendations,
        chatHistory,
        columnMapping,
        aiServerAvailable,
        assistantDrawerOpen,
        setAssistantDrawerOpen,
        tourOpen,
        setTourOpen,
        toasts,
        pushToast,
        loadDemoData,
        saveUploadedSnapshot,
        switchActiveSnapshot,
        reconcileAllTasks,
        updateSettings,
        saveTrainedModel,
        saveRecommendation,
        appendChatMessage,
        clearChatHistory,
        clearAllData,
      }}
    >
      {children}
    </WorkforceContext.Provider>
  );
};

export function useWorkforce(): WorkforceContextValue {
  const ctx = useContext(WorkforceContext);
  if (!ctx) throw new Error('useWorkforce must be used inside WorkforceProvider');
  return ctx;
}
