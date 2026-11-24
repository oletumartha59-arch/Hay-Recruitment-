import { z } from 'zod';

export type WorkStatus = 'Present' | 'Remote' | 'Leave' | 'Absent' | 'Unmapped';
export type WorkArrangement = 'Office' | 'Remote' | 'Hybrid' | 'Unspecified';
export type WorkloadLevel = 'Low' | 'Medium' | 'High';
export type AttentionStatus = 'Needs Attention' | 'OK';
export type RiskBand = 'Low' | 'Medium' | 'High' | 'Critical';
export type RiskMode = 'retention_index' | 'supervised_attrition' | 'attention_proxy';
export type SignalSeverity = 'Critical' | 'Warning' | 'Watch' | 'Data warning';

export type SignalCode =
  | 'low_engagement'
  | 'critical_engagement'
  | 'engagement_vs_peers'
  | 'heavy_workload'
  | 'severe_overload'
  | 'delivery_slippage'
  | 'burnout_pattern'
  | 'unused_leave'
  | 'low_presence'
  | 'stale_record'
  | 'early_tenure_risk';

export interface WarningSignal {
  code: SignalCode;
  label: string;
  severity: SignalSeverity;
  reason: string;
  actualValue: string;
  thresholdValue: string;
}

export interface DataQualityProvenance {
  issues: string[];
  taskReconciled: boolean;
  imputedFields: string[];
  outlierFields: string[];
  fixesApplied: Array<{
    field: string;
    rule: string;
    from: string;
    to: string;
  }>;
}

export interface RiskDriver {
  factor: string;
  employeeValue: string;
  peerMedian: string;
  effectPoints: number;
  direction: 'up' | 'down';
}

export interface EmployeeRecord {
  employeeId: string;
  employeeName: string;
  department: string;
  jobLevel: string;
  location: string;
  workArrangement: WorkArrangement;
  workStatus: WorkStatus;
  rawWorkStatus?: string;
  hireDate: string; // ISO YYYY-MM-DD
  lastUpdated: string; // ISO YYYY-MM-DD
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  engagementScore: number;
  workloadLevel: WorkloadLevel;
  leaveDaysRemaining: number;
  attentionStatus: AttentionStatus;
  attentionReason: string;
  attentionReasonTags: string[];
  exitTarget?: boolean; // Optional if file includes Left / Leaver / Exit Date

  // Derived fields
  tenureMonths: number;
  completionRate: number | null;
  openTasks: number;
  overdueShare: number | null;
  engagementPct: number;
  isStale: boolean;
  daysSinceUpdated: number;
  jobLevelRank: number;
  needsAttentionFlag: boolean;

  // Signals & Scoring
  signals: WarningSignal[];
  hasWarningOrCriticalSignal: boolean;
  missedByCurrentProcess: boolean;
  flaggedWithoutSignal: boolean;

  engagementRisk: number;
  workloadPressure: number;
  deliveryRisk: number;
  tenureRisk: number;
  riskScore: number;
  riskBand: RiskBand;
  riskRankCompany: number;
  riskRankDepartment: number;
  riskDelta: number | null;
  drivers: RiskDriver[];

  dataQuality: DataQualityProvenance;
}

export interface CleaningDecision {
  id: string;
  ruleId: string;
  ruleName: string;
  description: string;
  affectedCount: number;
  enabled: boolean;
  samples: Array<{
    employeeId: string;
    field: string;
    from: string;
    to: string;
  }>;
}

export interface DataQualityReport {
  overallScore: number;
  dimensions: {
    completeness: number;
    validity: number;
    uniqueness: number;
    consistency: number;
    freshness: number;
  };
  totalRowsRead: number;
  validRowsSaved: number;
  rejectedRows: Array<{ rowIndex: number; employeeId: string; reason: string }>;
  duplicatesRemoved: number;
  conflictsResolved: Array<{
    employeeId: string;
    keptLastUpdated: string;
    discardedLastUpdated: string;
  }>;
  imputedCellsCount: number;
  outliersFlaggedCount: number;
  highMissingColumns: Array<{ column: string; missingPct: number }>;
  ruleFailures: Array<{
    rule: string;
    description: string;
    count: number;
    sampleIds: string[];
  }>;
  cleaningDecisions: CleaningDecision[];
  ambiguousDateAssumption: string;
  unmappedStatuses: Array<{ rawValue: string; count: number }>;
}

export interface UploadSnapshot {
  id: string;
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  isDemo: boolean;
  engagementScaleMax: number;
  latestLastUpdated: string;
  dataQualityReport: DataQualityReport;
  columnMapping: Record<string, string>;
  employees: EmployeeRecord[];
}

export interface WorkforceSettings {
  id: 'default';
  lowEngagementPct: number; // 60
  criticalEngagementPct: number; // 40
  heavyWorkloadPercentile: number; // 75
  heavyWorkloadOverduePct: number; // 30
  severeOverloadOverduePct: number; // 50
  deliverySlippagePct: number; // 50
  deliverySlippageMinTasks: number; // 5
  unusedLeavePercentile: number; // 75
  unusedLeaveMinTenureMonths: number; // 12
  earlyTenureMonths: number; // 6
  staleDaysThreshold: number; // 30
  smallSampleThreshold: number; // 5

  engagementScaleOverride: number | null;
  jobLevelOrder: string[];
  statusAliases: Record<string, WorkStatus>;

  riskWeights: {
    engagement: number; // 40
    workload: number; // 30
    delivery: number; // 20
    tenure: number; // 10
  };
  tenureRiskEarlyMonths: number; // 6
  tenureRiskPlateauMonths: number; // 36

  activeRiskMode: RiskMode;
  attentionProxyAccepted: boolean;
  geminiModel: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite' | 'gemini-4-neon';
  includeNamesInAI: boolean;
  privacyModeDefault: boolean;
  aiExplanationsEnabled: boolean;
  tourCompleted: boolean;
}

export interface GlobalFilterState {
  departments: string[];
  locations: string[];
  workStatuses: WorkStatus[];
  jobLevels: string[];
  workArrangements: WorkArrangement[];
  workloadLevels: WorkloadLevel[];
  attentionStatuses: AttentionStatus[];
  riskBands: RiskBand[];
  signalTypes: Array<SignalCode | 'missed_warning_signs'>;
  tenureBands: string[];
  staleOnly: boolean;
  engagementRange: [number, number]; // percentage 0..100
  search: string;
}

export interface TrainedModelSummary {
  id: string;
  mode: 'supervised_attrition' | 'attention_proxy';
  trainedAt: string;
  snapshotId: string;
  sampleCount: number;
  positiveCount: number;
  bestAlgorithm: 'logistic_regression' | 'random_forest' | 'gradient_boosted_trees';
  decisionThreshold: number;
  thresholdPriority: 'recall' | 'balanced' | 'precision';
  qualityLabel: 'Reliable' | 'Use with caution' | 'Not reliable';
  qualityReason: string;
  featuresUsed: string[];
  leaderboard: Array<{
    algorithm: 'logistic_regression' | 'random_forest' | 'gradient_boosted_trees' | 'naive_baseline';
    label: string;
    rocAuc: number;
    prAuc: number;
    precision: number;
    recall: number;
    f1: number;
    balancedAccuracy: number;
    brierScore: number;
  }>;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
  calibrationCurve: Array<{ binCenter: number; meanPredicted: number; observedRate: number; count: number }>;
  thresholdCurve: Array<{ threshold: number; precision: number; recall: number; f1: number }>;
  globalImportance: Array<{ feature: string; importance: number; direction?: 'positive' | 'negative' }>;
  pdpTop3: Array<{
    feature: string;
    points: Array<{ x: string; y: number }>;
  }>;
  fairnessWarnings: Array<{
    dimension: string;
    group: string;
    flagRate: number;
    overallRate: number;
    ratio: number;
  }>;
  employeeProbabilities: Record<string, {
    probability: number;
    drivers: RiskDriver[];
  }>;
}

export const RecommendationSchema = z.object({
  scope: z.object({
    type: z.enum(['employee', 'team', 'company']),
    id: z.string(),
  }),
  summary: z.string().min(10),
  riskContext: z.object({
    score: z.number(),
    band: z.string(),
    topDrivers: z.array(
      z.object({
        factor: z.string(),
        employeeValue: z.string(),
        peerMedian: z.string(),
        effectPoints: z.number(),
      })
    ),
  }),
  recommendations: z.array(
    z.object({
      id: z.string(),
      priority: z.enum(['P1', 'P2', 'P3']),
      title: z.string(),
      rationale: z.string(),
      evidence: z.array(
        z.object({
          metric: z.string(),
          value: z.string(),
          comparison: z.string(),
        })
      ),
      steps: z.array(
        z.object({
          order: z.number(),
          action: z.string(),
          owner: z.string(),
          dueInDays: z.number(),
        })
      ),
      effort: z.enum(['Low', 'Medium', 'High']),
      expectedImpact: z.object({
        riskScoreBefore: z.number(),
        riskScoreAfter: z.number(),
        confidence: z.enum(['Low', 'Medium', 'High']),
      }),
      kpis: z.array(
        z.object({
          name: z.string(),
          baseline: z.string(),
          target: z.string(),
          measureBy: z.string(),
          reviewDate: z.string(),
        })
      ),
      risks: z.array(z.string()),
      conversationGuide: z.array(z.string()).optional(),
    })
  ),
  monitoringPlan: z.object({
    reviewCadence: z.string(),
    escalationTrigger: z.string(),
  }),
  limitations: z.array(z.string()),
});

export type RetentionPlan = z.infer<typeof RecommendationSchema>;

export interface SavedRecommendationRecord {
  id: string;
  scopeKey: string;
  createdAt: string;
  snapshotId: string;
  source: 'gemini' | 'playbook_fallback';
  plan: RetentionPlan;
  actionStatuses: Record<string, {
    status: 'Not started' | 'In progress' | 'Done' | 'Dismissed';
    owner?: string;
    dueDate?: string;
    notes?: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  toolsUsed?: string[];
  filterContext?: string;
  dataPayload?: {
    type: 'table' | 'chart' | 'kpis' | 'employee';
    title?: string;
    rows?: Array<Record<string, unknown>>;
    chartSpec?: {
      chartType: string;
      title: string;
      subtitle: string;
      labels: string[];
      values: number[];
      unit: string;
    };
  };
  aiFallback?: boolean;
  feedback?: 'up' | 'down' | null;
  pinned?: boolean;
}

export const DEFAULT_JOB_LEVEL_ORDER = [
  'Graduate',
  'Junior',
  'Consultant',
  'Senior Consultant',
  'Principal Consultant',
  'Manager',
  'Director',
];

export const DEFAULT_SETTINGS: WorkforceSettings = {
  id: 'default',
  lowEngagementPct: 60,
  criticalEngagementPct: 40,
  heavyWorkloadPercentile: 75,
  heavyWorkloadOverduePct: 30,
  severeOverloadOverduePct: 50,
  deliverySlippagePct: 50,
  deliverySlippageMinTasks: 5,
  unusedLeavePercentile: 75,
  unusedLeaveMinTenureMonths: 12,
  earlyTenureMonths: 6,
  staleDaysThreshold: 30,
  smallSampleThreshold: 5,
  engagementScaleOverride: null,
  jobLevelOrder: DEFAULT_JOB_LEVEL_ORDER,
  statusAliases: {},
  riskWeights: {
    engagement: 40,
    workload: 30,
    delivery: 20,
    tenure: 10,
  },
  tenureRiskEarlyMonths: 6,
  tenureRiskPlateauMonths: 36,
  activeRiskMode: 'retention_index',
  attentionProxyAccepted: false,
  geminiModel: 'gemini-4-hydrogen',
  includeNamesInAI: false,
  privacyModeDefault: false,
  aiExplanationsEnabled: true,
  tourCompleted: false,
};

export const INITIAL_FILTER_STATE: GlobalFilterState = {
  departments: [],
  locations: [],
  workStatuses: [],
  jobLevels: [],
  workArrangements: [],
  workloadLevels: [],
  attentionStatuses: [],
  riskBands: [],
  signalTypes: [],
  tenureBands: [],
  staleOnly: false,
  engagementRange: [0, 100],
  search: '',
};
