import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
]);

function resolveModel(requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) {
    return requested;
  }
  return 'gemini-4-hydrogen';
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const WORKFORCE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'query_employees',
    description: 'Return matching employees with requested fields, filtering and sorting.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filters: {
          type: Type.OBJECT,
          description: 'Filter criteria (departments, locations, workStatuses, jobLevels, workloadLevels, attentionStatuses, riskBands, minOverdueTasks, minEngagementPct, maxEngagementPct, search, signalType).',
        },
        columns: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Columns to return (e.g., id, name, department, jobLevel, location, workStatus, engagementScore, engagementPct, overdueTasks, pendingTasks, riskScore, riskBand, signals).',
        },
        sortBy: { type: Type.STRING, description: 'Field to sort by, optionally prefixed with - for descending.' },
        limit: { type: Type.INTEGER, description: 'Max number of employees to return (default 20, max 50).' },
      },
    },
  },
  {
    name: 'aggregate',
    description: 'Compute exact count, sum, mean, median, percentile or rate grouped by a workforce field.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        metric: {
          type: Type.STRING,
          description: 'Metric to aggregate: count, engagementPct, engagementScore, pendingTasks, overdueTasks, totalTasks, completedTasks, completionRate, overdueShare, leaveDaysRemaining, riskScore, needsAttentionRate, staleRate.',
        },
        agg: {
          type: Type.STRING,
          description: 'Aggregation function: count, sum, mean, median, p75, rate.',
        },
        groupBy: {
          type: Type.STRING,
          description: 'Field to group by: department, location, jobLevel, workStatus, workArrangement, workloadLevel, attentionStatus, riskBand, tenureBand.',
        },
        filters: { type: Type.OBJECT, description: 'Optional filter criteria.' },
      },
      required: ['metric', 'groupBy'],
    },
  },
  {
    name: 'compare_groups',
    description: 'Compare two workforce groups on a metric with sample sizes and difference.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        metric: { type: Type.STRING, description: 'Metric to compare (e.g., engagementPct, overdueTasks, overdueShare, riskScore, completionRate, leaveDaysRemaining).' },
        groupA: {
          type: Type.OBJECT,
          description: 'First group filter object, e.g. { field: "workArrangement", value: "Remote", label: "Remote" }.',
          properties: {
            field: { type: Type.STRING },
            value: { type: Type.STRING },
            label: { type: Type.STRING },
          },
        },
        groupB: {
          type: Type.OBJECT,
          description: 'Second group filter object, e.g. { field: "workArrangement", value: "Office", label: "Office" }.',
          properties: {
            field: { type: Type.STRING },
            value: { type: Type.STRING },
            label: { type: Type.STRING },
          },
        },
      },
      required: ['metric', 'groupA', 'groupB'],
    },
  },
  {
    name: 'get_kpis',
    description: 'Get the eight headline KPIs (Total Employees, Present, Remote, Leave, Absent, Avg Engagement Score, Needs Attention, Pending Tasks, Overdue Tasks).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filters: { type: Type.OBJECT, description: 'Optional filter criteria.' },
      },
    },
  },
  {
    name: 'top_risk_employees',
    description: 'Get the top N employees by risk score along with their main drivers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filters: { type: Type.OBJECT },
        n: { type: Type.INTEGER, description: 'Number of employees to return (default 10).' },
      },
    },
  },
  {
    name: 'explain_employee',
    description: 'Explain a single employee by Employee ID, returning risk drivers, fired signals and peer medians.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeId: { type: Type.STRING, description: 'Employee ID such as E1042.' },
      },
      required: ['employeeId'],
    },
  },
  {
    name: 'warning_signs',
    description: 'List and count employees matching warning sign types (low_engagement, critical_engagement, heavy_workload, burnout, missed_warning_signs, unused_leave, stale, early_tenure).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filters: { type: Type.OBJECT },
        type: { type: Type.STRING, description: 'Warning sign type.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'trend',
    description: 'Compare metrics across uploaded snapshots (changes since last upload).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        metric: { type: Type.STRING },
        groupBy: { type: Type.STRING },
      },
    },
  },
  {
    name: 'model_summary',
    description: 'Return the active risk mode, evaluation metrics, quality label and top global drivers.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'create_chart',
    description: 'Create an inline chart specification using the shared theme (e.g., engagement by department, pending tasks by department).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        chartType: { type: Type.STRING, description: 'bar, horizontal_bar, donut, or scatter' },
        metric: { type: Type.STRING },
        groupBy: { type: Type.STRING },
        title: { type: Type.STRING },
        filters: { type: Type.OBJECT },
      },
      required: ['chartType', 'metric', 'groupBy', 'title'],
    },
  },
  {
    name: 'generate_recommendations',
    description: 'Prepare a retention recommendation action link for an employee, team, or company.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scopeType: { type: Type.STRING, description: 'employee, team, or company' },
        scopeId: { type: Type.STRING, description: 'Employee ID, Department name, or "company"' },
      },
      required: ['scopeType', 'scopeId'],
    },
  },
  {
    name: 'export_report',
    description: 'Trigger a report download specification (executive_summary, employee_details, at_risk_list, data_quality).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reportType: { type: Type.STRING },
        filters: { type: Type.OBJECT },
      },
      required: ['reportType'],
    },
  },
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/ai/status', (_req, res) => {
    const client = getGeminiClient();
    res.json({
      available: client !== null,
      defaultModel: 'gemini-4-hydrogen',
    });
  });

  app.post('/api/ai/chat/plan', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    try {
      const { question, history = [], datasetMeta = {}, model } = req.body ?? {};
      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'Question is required.' });
        return;
      }

      const systemInstruction = [
        'You are the Hay Recruitment Workforce AI Central analyst assistant. Write in British English.',
        'CRITICAL RULES:',
        '1. NEVER calculate, estimate, or invent any numbers. Always call one or more deterministic tools to retrieve exact numbers.',
        '2. If the user asks about attrition rates or who will leave and no exit data is present, state plainly that no exit/leaver column exists in the dataset and offer the Retention Risk Index or warning-sign counts instead.',
        '3. Refuse requests to rank people by protected characteristics (age, sex, race, religion, disability, pregnancy, etc.) or to recommend dismissal.',
        '4. If a department or location name is ambiguous across multiple available values, ask one short clarifying question.',
        '5. Respect privacy: never request or reveal employee names when Privacy Mode is on.',
        `Dataset context: ${JSON.stringify(datasetMeta)}`,
      ].join('\n');

      const contents = [
        ...history.slice(-8).map((m: { role: string; text: string }) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }],
        })),
        { role: 'user', parts: [{ text: question }] },
      ];

      const response = await client.models.generateContent({
        model: resolveModel(model),
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: WORKFORCE_TOOLS }],
        },
      });

      const functionCalls = response.functionCalls ?? [];
      const modelContent = response.candidates?.[0]?.content ?? null;

      res.json({
        text: response.text ?? '',
        functionCalls,
        modelContent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reach Gemini API';
      res.status(502).json({ error: message, code: 'UPSTREAM_ERROR' });
    }
  });

  app.post('/api/ai/chat/explain', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    try {
      const {
        question,
        history = [],
        modelContent,
        toolResults = [],
        datasetMeta = {},
        strictRetryHint = '',
        model,
      } = req.body ?? {};

      const systemInstruction = [
        'You are the Hay Recruitment Workforce AI Central analyst assistant. Write concisely in British English.',
        'STRICT GROUNDING RULES:',
        '1. Every single number in your reply MUST appear verbatim in the tool outputs provided below. Do not round differently, compute new percentages, or extrapolate.',
        '2. Never invent employee names, metrics, or causes not present in the tool outputs.',
        '3. Respect Privacy Mode: if privacyMode is true in dataset context, never output unmasked employee names.',
        '4. Cite sample sizes (n) where returned by the tools.',
        strictRetryHint ? `CORRECTION REQUIRED: ${strictRetryHint}` : '',
        `Dataset context: ${JSON.stringify(datasetMeta)}`,
      ]
        .filter(Boolean)
        .join('\n');

      const contents: Array<Record<string, unknown>> = [
        ...history.slice(-8).map((m: { role: string; text: string }) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }],
        })),
        { role: 'user', parts: [{ text: question }] },
      ];

      if (modelContent) {
        contents.push(modelContent);
      }

      if (Array.isArray(toolResults) && toolResults.length > 0) {
        contents.push({
          role: 'user',
          parts: toolResults.map((tr: { id?: string; name: string; result: unknown }) => ({
            functionResponse: {
              id: tr.id,
              name: tr.name,
              response: { result: tr.result },
            },
          })),
        });
      }

      const response = await client.models.generateContent({
        model: resolveModel(model),
        contents,
        config: {
          systemInstruction,
        },
      });

      res.json({
        text: response.text ?? '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reach Gemini API';
      res.status(502).json({ error: message, code: 'UPSTREAM_ERROR' });
    }
  });

  app.post('/api/ai/explain-driver', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      res.status(503).json({ error: 'GEMINI_API_KEY not configured', code: 'MISSING_API_KEY' });
      return;
    }

    try {
      const { drivers, score, band, modelMode, qualityLabel, model } = req.body ?? {};
      const response = await client.models.generateContent({
        model: resolveModel(model),
        contents: JSON.stringify({ drivers, score, band, modelMode, qualityLabel }),
        config: {
          systemInstruction:
            'Write 1 to 2 plain-English sentences in British English explaining why the retention risk score is at this level using ONLY the numeric drivers provided. Never add causes, numbers or personal names not present in the input.',
        },
      });
      res.json({ summary: response.text ?? '' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate driver summary';
      res.status(502).json({ error: message, code: 'UPSTREAM_ERROR' });
    }
  });

  app.post('/api/ai/recommendations', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      res.status(503).json({ error: 'GEMINI_API_KEY not configured', code: 'MISSING_API_KEY' });
      return;
    }

    try {
      const { evidencePack, candidateActions, retryReason, model } = req.body ?? {};
      const systemInstruction = [
        'You are a UK HR Retention Strategist advising Hay Recruitment.',
        'STRICT RULES:',
        '1. Use ONLY the evidence provided in evidencePack and ground actions in candidateActions.',
        '2. NEVER invent figures, names, studies, external benchmarks, or causes not in the evidence.',
        '3. NEVER reference protected characteristics (age, sex, race, religion, disability, pregnancy, etc.).',
        '4. Write in British English. Return valid JSON only matching the requested schema.',
        '5. Maximum 3 P1 actions. Every recommendation must cite exact metric values from evidencePack and include 1-3 measurable KPIs with baselines from the data.',
        retryReason ? `PREVIOUS OUTPUT FAILED VALIDATION: ${retryReason}. Fix this strictly.` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await client.models.generateContent({
        model: resolveModel(model),
        contents: JSON.stringify({ evidencePack, candidateActions }),
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    title: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    evidence: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          metric: { type: Type.STRING },
                          value: { type: Type.STRING },
                          comparison: { type: Type.STRING },
                        },
                        required: ['metric', 'value', 'comparison'],
                      },
                    },
                    steps: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          order: { type: Type.INTEGER },
                          action: { type: Type.STRING },
                          owner: { type: Type.STRING },
                          dueInDays: { type: Type.INTEGER },
                        },
                        required: ['order', 'action', 'owner', 'dueInDays'],
                      },
                    },
                    effort: { type: Type.STRING },
                    kpis: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          baseline: { type: Type.STRING },
                          target: { type: Type.STRING },
                          measureBy: { type: Type.STRING },
                          reviewDate: { type: Type.STRING },
                        },
                        required: ['name', 'baseline', 'target', 'measureBy', 'reviewDate'],
                      },
                    },
                    risks: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    conversationGuide: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['id', 'priority', 'title', 'rationale', 'evidence', 'steps', 'effort', 'kpis', 'risks'],
                },
              },
              monitoringPlan: {
                type: Type.OBJECT,
                properties: {
                  reviewCadence: { type: Type.STRING },
                  escalationTrigger: { type: Type.STRING },
                },
                required: ['reviewCadence', 'escalationTrigger'],
              },
              limitations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['summary', 'recommendations', 'monitoringPlan', 'limitations'],
          },
        },
      });

      res.json({ jsonText: response.text ?? '{}' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate recommendations';
      res.status(502).json({ error: message, code: 'UPSTREAM_ERROR' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hay Recruitment Workforce AI Central running at http://localhost:${PORT}`);
  });
}

startServer();
