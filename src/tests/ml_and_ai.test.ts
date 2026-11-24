import { describe, expect, it } from 'vitest';
import { runCleaningPipeline } from '../lib/clean/pipeline';
import { DEMO_COLUMN_MAPPING, generateDemoRawRows } from '../lib/demo/generator';
import { buildModelFeatureMatrix } from '../lib/ml/featuresBuilder';
import { buildRuleBasedChatFallback, executeWorkforceTool, type ToolContext } from '../lib/ai/tools';
import {
  buildEvidencePack,
  buildPlaybookFallbackPlan,
  validateAiRecommendationNumbers,
} from '../lib/ai/recommendations';
import { aggregateByGroup, compareTwoGroups } from '../lib/metrics';
import { DEFAULT_SETTINGS, RecommendationSchema } from '../types/workforce';

describe('ML Leakage Guard, AI Tool Parity & Recommendation Schema', () => {
  const cleaned = runCleaningPipeline(generateDemoRawRows(), {
    mapping: DEMO_COLUMN_MAPPING,
    settings: DEFAULT_SETTINGS,
    referenceTodayIso: '2026-11-24',
  });
  const employees = cleaned.employees;

  it('excludes Attention Status, Attention Reason, ID, Name, and protected attributes from model features', () => {
    const matrix = buildModelFeatureMatrix(employees);
    const lowerNames = matrix.featureNames.map((n) => n.toLowerCase());
    expect(lowerNames.some((n) => n.includes('attention'))).toBe(false);
    expect(lowerNames.some((n) => n.includes('employeeid') || n.includes('employeename'))).toBe(false);
    expect(
      lowerNames.some((n) =>
        /^(age|gender|sex|race|ethnicity|religion|disability|pregnancy|marital)/.test(n)
      )
    ).toBe(false);
    expect(matrix.rows.length).toBe(300);
  });

  it('returns identical numbers from chatbot tools and direct metrics.ts calls', () => {
    const ctx: ToolContext = {
      employees,
      engagementScaleMax: cleaned.engagementScaleMax,
      settings: DEFAULT_SETTINGS,
      privacyMode: false,
      includeNamesInAI: false,
      snapshots: [],
    };

    // Question: "How many employees are on leave in Manchester?"
    const leaveMcr = buildRuleBasedChatFallback('How many employees are on leave in Manchester?', ctx);
    const expectedLeaveMcr = employees.filter(
      (e) => e.location === 'Manchester' && e.workStatus === 'Leave'
    ).length;
    expect(leaveMcr.text).toContain(String(expectedLeaveMcr));

    // Question: "Which department has the lowest average engagement?"
    const lowDept = buildRuleBasedChatFallback('Which department has the lowest average engagement?', ctx);
    const directDept = aggregateByGroup(employees, 'engagementPct', 'department', 'mean').sort(
      (a, b) => (a.value ?? 100) - (b.value ?? 100)
    )[0];
    expect(lowDept.text).toContain(directDept.group);
    expect(lowDept.text).toContain(String(directDept.value));

    // Question: "Compare remote and office staff on engagement and overdue tasks."
    const cmpRes = buildRuleBasedChatFallback(
      'Compare remote and office staff on engagement and overdue tasks.',
      ctx
    );
    const directCmp = compareTwoGroups(
      employees,
      'engagementPct',
      { field: 'workArrangement', value: 'Remote' },
      { field: 'workArrangement', value: 'Office' }
    );
    expect(cmpRes.text).toContain(String(directCmp.groupA.n));
    expect(cmpRes.text).toContain(String(directCmp.groupB.n));

    // Question: "What is our attrition rate?" -> must clearly refuse fabricated attrition rate
    const attritionRes = buildRuleBasedChatFallback('What is our attrition rate?', ctx);
    expect(attritionRes.text.toLowerCase()).toContain('does not contain');

    // Question: "List the senior consultants with more than 5 overdue tasks."
    const seniorRes = executeWorkforceTool(
      'query_employees',
      { filters: { jobLevels: ['Senior Consultant'], minOverdueTasks: 5 }, limit: 50 },
      ctx
    );
    const expectedSenior = employees.filter(
      (e) => e.jobLevel === 'Senior Consultant' && e.overdueTasks > 5
    ).length;
    expect((seniorRes.result as { totalMatched: number }).totalMatched).toBe(expectedSenior);
  });

  it('validates recommendation schema, rejects fabricated metrics, and builds playbook fallback', () => {
    const highRiskEmp = [...employees].sort((a, b) => b.riskScore - a.riskScore)[0];
    const bundle = buildEvidencePack(
      'employee',
      highRiskEmp.employeeId,
      employees,
      DEFAULT_SETTINGS,
      true,
      false
    );

    const plan = buildPlaybookFallbackPlan(
      bundle.evidencePack,
      bundle.candidateActions,
      bundle.targetEmployees,
      DEFAULT_SETTINGS
    );

    expect(RecommendationSchema.safeParse(plan).success).toBe(true);
    expect(plan.recommendations.filter((r) => r.priority === 'P1').length).toBeLessThanOrEqual(3);

    // Reject fabricated metric number in AI evidence
    const fabricated = {
      ...plan,
      recommendations: [
        {
          ...plan.recommendations[0],
          evidence: [{ metric: 'Engagement', value: '9999.7% invented', comparison: 'none' }],
        },
      ],
    };
    const check = validateAiRecommendationNumbers(fabricated, bundle.evidencePack);
    expect(check.ok).toBe(false);
  });
});
