import type { EmployeeRecord, TrainedModelSummary } from '../../types/workforce';
import { buildModelFeatureMatrix } from './featuresBuilder';
import type { MlWorkerResponse } from './mlWorker';

export function checkSupervisedEligibility(employees: EmployeeRecord[]): {
  eligible: boolean;
  totalRows: number;
  leaverCount: number;
  reason: string;
} {
  const totalRows = employees.length;
  const leaverCount = employees.filter((e) => e.exitTarget === true).length;
  const hasExitColumn = employees.some((e) => e.exitTarget !== undefined);

  if (!hasExitColumn) {
    return {
      eligible: false,
      totalRows,
      leaverCount: 0,
      reason: 'No exit target column (Left / Leaver / Exit Date) was found in the uploaded file.',
    };
  }
  if (totalRows < 200) {
    return {
      eligible: false,
      totalRows,
      leaverCount,
      reason: `Supervised attrition requires at least 200 employees (currently ${totalRows}).`,
    };
  }
  if (leaverCount < 30) {
    return {
      eligible: false,
      totalRows,
      leaverCount,
      reason: `Supervised attrition requires at least 30 leavers (currently ${leaverCount}).`,
    };
  }
  return {
    eligible: true,
    totalRows,
    leaverCount,
    reason: `Eligible: ${totalRows} employees with ${leaverCount} recorded leavers.`,
  };
}

export function trainModelInWorker(params: {
  employees: EmployeeRecord[];
  snapshotId: string;
  mode: 'supervised_attrition' | 'attention_proxy';
  thresholdPriority: 'recall' | 'balanced' | 'precision';
  seed?: number;
}): Promise<TrainedModelSummary> {
  const { employees, snapshotId, mode, thresholdPriority, seed = 2026 } = params;

  const matrix = buildModelFeatureMatrix(employees);
  const targets = employees.map((e) =>
    mode === 'supervised_attrition' ? (e.exitTarget ? 1 : 0) : e.needsAttentionFlag ? 1 : 0
  );

  return new Promise<TrainedModelSummary>((resolve, reject) => {
    const worker = new Worker(new URL('./mlWorker.ts', import.meta.url), {
      type: 'module',
    });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    worker.onmessage = (event: MessageEvent<MlWorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      worker.terminate();
      if (msg.type === 'result' && msg.summary) {
        resolve(msg.summary);
      } else {
        reject(new Error(msg.error ?? 'Model training failed.'));
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'ML worker crashed during training.'));
    };

    worker.postMessage({
      id,
      mode,
      snapshotId,
      featureNames: matrix.featureNames,
      rows: matrix.rows,
      targets,
      employeeIds: matrix.employeeIds,
      departments: employees.map((e) => e.department),
      locations: employees.map((e) => e.location),
      jobLevels: employees.map((e) => e.jobLevel),
      thresholdPriority,
      seed,
    });
  });
}
