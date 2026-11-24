import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type EmployeeRecord,
  type SavedRecommendationRecord,
  type TrainedModelSummary,
  type UploadSnapshot,
  type WorkforceSettings,
} from '../../types/workforce';

export interface StoredEmployeeRow extends EmployeeRecord {
  snapshotId: string;
}

export interface StoredScoreRow {
  employeeId: string;
  snapshotId: string;
  riskScore: number;
  riskBand: EmployeeRecord['riskBand'];
  mode: string;
}

class HayWorkforceDatabase extends Dexie {
  employees!: Table<StoredEmployeeRow, string>;
  uploads!: Table<UploadSnapshot, string>;
  settings!: Table<WorkforceSettings, string>;
  models!: Table<TrainedModelSummary, string>;
  scores!: Table<StoredScoreRow, string>;
  recommendations!: Table<SavedRecommendationRecord, string>;
  chatHistory!: Table<ChatMessage, string>;

  constructor() {
    super('HayWorkforceCentralDB');
    this.version(1).stores({
      employees: 'employeeId, snapshotId, department, location, workStatus, riskScore',
      uploads: 'id, uploadedAt',
      settings: 'id',
      models: 'id, trainedAt, mode',
      scores: 'employeeId, snapshotId, riskBand',
      recommendations: 'id, scopeKey, createdAt, snapshotId',
      chatHistory: 'id, createdAt',
    });

    // Version 2 migration hook: ensure new threshold defaults exist on upgrades
    this.version(2)
      .stores({
        employees: 'employeeId, snapshotId, department, location, workStatus, riskScore',
        uploads: 'id, uploadedAt',
        settings: 'id',
        models: 'id, trainedAt, mode',
        scores: 'employeeId, snapshotId, riskBand',
        recommendations: 'id, scopeKey, createdAt, snapshotId',
        chatHistory: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        const existing = await tx.table('settings').get('default');
        if (existing) {
          await tx.table('settings').put({ ...DEFAULT_SETTINGS, ...existing });
        }
      });
  }
}

export interface PersistedState {
  snapshots: UploadSnapshot[];
  activeSnapshotId: string | null;
  settings: WorkforceSettings;
  models: TrainedModelSummary[];
  recommendations: SavedRecommendationRecord[];
  chatHistory: ChatMessage[];
  columnMapping: Record<string, string>;
  inMemoryFallback: boolean;
}

const memoryStore: {
  snapshots: UploadSnapshot[];
  settings: WorkforceSettings;
  models: TrainedModelSummary[];
  recommendations: SavedRecommendationRecord[];
  chatHistory: ChatMessage[];
  columnMapping: Record<string, string>;
} = {
  snapshots: [],
  settings: { ...DEFAULT_SETTINGS },
  models: [],
  recommendations: [],
  chatHistory: [],
  columnMapping: {},
};

let dbInstance: HayWorkforceDatabase | null = null;
let useInMemory = false;

async function getDb(): Promise<HayWorkforceDatabase | null> {
  if (useInMemory) return null;
  try {
    if (!dbInstance) {
      dbInstance = new HayWorkforceDatabase();
    }
    await dbInstance.open();
    return dbInstance;
  } catch {
    useInMemory = true;
    return null;
  }
}

export async function loadPersistedState(): Promise<PersistedState> {
  const db = await getDb();
  if (!db) {
    return {
      snapshots: memoryStore.snapshots,
      activeSnapshotId: memoryStore.snapshots[0]?.id ?? null,
      settings: memoryStore.settings,
      models: memoryStore.models,
      recommendations: memoryStore.recommendations,
      chatHistory: memoryStore.chatHistory,
      columnMapping: memoryStore.columnMapping,
      inMemoryFallback: true,
    };
  }

  try {
    const snapshots = await db.uploads.orderBy('uploadedAt').reverse().toArray();
    const storedSettings = await db.settings.get('default');
    const settings: WorkforceSettings = storedSettings
      ? { ...DEFAULT_SETTINGS, ...storedSettings }
      : { ...DEFAULT_SETTINGS };
    const models = await db.models.orderBy('trainedAt').reverse().toArray();
    const recommendations = await db.recommendations.orderBy('createdAt').reverse().toArray();
    const chatHistory = await db.chatHistory.orderBy('createdAt').toArray();
    const latestMapping = snapshots[0]?.columnMapping ?? {};

    return {
      snapshots,
      activeSnapshotId: snapshots[0]?.id ?? null,
      settings,
      models,
      recommendations,
      chatHistory,
      columnMapping: latestMapping,
      inMemoryFallback: false,
    };
  } catch {
    useInMemory = true;
    return {
      snapshots: memoryStore.snapshots,
      activeSnapshotId: memoryStore.snapshots[0]?.id ?? null,
      settings: memoryStore.settings,
      models: memoryStore.models,
      recommendations: memoryStore.recommendations,
      chatHistory: memoryStore.chatHistory,
      columnMapping: memoryStore.columnMapping,
      inMemoryFallback: true,
    };
  }
}

export async function saveSnapshotToDb(snapshot: UploadSnapshot): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    memoryStore.snapshots = [snapshot, ...memoryStore.snapshots.filter((s) => s.id !== snapshot.id)].slice(0, 12);
    return false;
  }
  try {
    await db.transaction('rw', db.uploads, db.employees, db.scores, async () => {
      await db.uploads.put(snapshot);
      // Keep max 12 snapshots
      const all = await db.uploads.orderBy('uploadedAt').reverse().toArray();
      if (all.length > 12) {
        const toDelete = all.slice(12).map((s) => s.id);
        await db.uploads.bulkDelete(toDelete);
      }
      // Store current active employees and scores in their tables for direct inspection/queries
      await db.employees.clear();
      await db.employees.bulkPut(
        snapshot.employees.map((e) => ({ ...e, snapshotId: snapshot.id }))
      );
      await db.scores.clear();
      await db.scores.bulkPut(
        snapshot.employees.map((e) => ({
          employeeId: e.employeeId,
          snapshotId: snapshot.id,
          riskScore: e.riskScore,
          riskBand: e.riskBand,
          mode: 'retention_index',
        }))
      );
    });
    return true;
  } catch {
    useInMemory = true;
    memoryStore.snapshots = [snapshot, ...memoryStore.snapshots].slice(0, 12);
    return false;
  }
}

export async function replaceAllSnapshotsInDb(snapshot: UploadSnapshot): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    memoryStore.snapshots = [snapshot];
    return false;
  }
  try {
    await db.transaction('rw', db.uploads, db.employees, db.scores, async () => {
      await db.uploads.clear();
      await db.uploads.put(snapshot);
      await db.employees.clear();
      await db.employees.bulkPut(
        snapshot.employees.map((e) => ({ ...e, snapshotId: snapshot.id }))
      );
      await db.scores.clear();
      await db.scores.bulkPut(
        snapshot.employees.map((e) => ({
          employeeId: e.employeeId,
          snapshotId: snapshot.id,
          riskScore: e.riskScore,
          riskBand: e.riskBand,
          mode: 'retention_index',
        }))
      );
    });
    return true;
  } catch {
    useInMemory = true;
    memoryStore.snapshots = [snapshot];
    return false;
  }
}

export async function saveSettingsToDb(settings: WorkforceSettings): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.settings = settings;
    return;
  }
  try {
    await db.settings.put(settings);
  } catch {
    useInMemory = true;
    memoryStore.settings = settings;
  }
}

export async function saveModelToDb(model: TrainedModelSummary): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.models = [model, ...memoryStore.models.filter((m) => m.id !== model.id)];
    return;
  }
  try {
    await db.models.put(model);
  } catch {
    useInMemory = true;
    memoryStore.models = [model, ...memoryStore.models];
  }
}

export async function saveRecommendationToDb(rec: SavedRecommendationRecord): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.recommendations = [
      rec,
      ...memoryStore.recommendations.filter((r) => r.id !== rec.id),
    ];
    return;
  }
  try {
    await db.recommendations.put(rec);
  } catch {
    useInMemory = true;
    memoryStore.recommendations = [rec, ...memoryStore.recommendations];
  }
}

export async function saveChatMessageToDb(msg: ChatMessage): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.chatHistory = [...memoryStore.chatHistory.filter((m) => m.id !== msg.id), msg];
    return;
  }
  try {
    await db.chatHistory.put(msg);
  } catch {
    useInMemory = true;
    memoryStore.chatHistory = [...memoryStore.chatHistory, msg];
  }
}

export async function clearChatHistoryInDb(): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryStore.chatHistory = [];
    return;
  }
  try {
    await db.chatHistory.clear();
  } catch {
    memoryStore.chatHistory = [];
  }
}

export async function clearAllDataInDb(): Promise<void> {
  memoryStore.snapshots = [];
  memoryStore.models = [];
  memoryStore.recommendations = [];
  memoryStore.chatHistory = [];
  memoryStore.settings = { ...DEFAULT_SETTINGS };

  const db = await getDb();
  if (!db) return;
  try {
    await db.transaction(
      'rw',
      [db.employees, db.uploads, db.settings, db.models, db.scores, db.recommendations, db.chatHistory],
      async () => {
        await db.employees.clear();
        await db.uploads.clear();
        await db.settings.clear();
        await db.models.clear();
        await db.scores.clear();
        await db.recommendations.clear();
        await db.chatHistory.clear();
      }
    );
  } catch {
    // ignore
  }
}

export async function exportAllDataAsJson(): Promise<string> {
  const state = await loadPersistedState();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'Hay Recruitment Workforce AI Central',
      ...state,
    },
    null,
    2
  );
}
