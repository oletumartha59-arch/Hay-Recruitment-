import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from 'lucide-react';
import { useWorkforce } from '../app/WorkforceContext';
import { ChartCard } from '../components/ChartCard';
import { trainModelInWorker } from '../lib/ml/mlRunner';
import { BRAND_TOKENS } from '../theme/tokens';

export const RiskModelsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    allEmployees,
    activeSnapshot,
    settings,
    models,
    activeModel,
    supervisedEligibility,
    updateSettings,
    saveTrainedModel,
    pushToast,
  } = useWorkforce();

  const [training, setTraining] = useState(false);
  const [priority, setPriority] = useState<'recall' | 'balanced' | 'precision'>('recall');
  const [proxyAccepted, setProxyAccepted] = useState(settings.attentionProxyAccepted);

  const bandDistribution = useMemo(() => {
    const counts = { Low: 0, Medium: 0, High: 0, Critical: 0 };
    allEmployees.forEach((e) => {
      counts[e.riskBand] += 1;
    });
    return counts;
  }, [allEmployees]);

  const handleTrain = async (mode: 'supervised_attrition' | 'attention_proxy') => {
    if (!activeSnapshot) return;
    setTraining(true);
    try {
      const summary = await trainModelInWorker({
        employees: allEmployees,
        snapshotId: activeSnapshot.id,
        mode,
        thresholdPriority: priority,
      });
      await saveTrainedModel(summary);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Training failed.', 'error');
    } finally {
      setTraining(false);
    }
  };

  if (allEmployees.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center card-surface mt-8">
        <h1 className="font-page-title text-xl font-semibold text-[var(--brown)]">
          Risk & Churn Modelling
        </h1>
        <p className="text-xs text-[var(--muted)] mt-2 mb-4">
          Upload workforce data or load demo data first to inspect risk scores and models.
        </p>
        <button type="button" onClick={() => navigate('/')} className="btn-primary px-4 py-2 text-xs">
          Go to Home
        </button>
      </div>
    );
  }

  const displayedModel = activeModel ?? models[0] ?? null;

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1500px] w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-page-title text-2xl font-semibold text-[var(--brown)]">
            Risk & Churn Modelling
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Active Mode: <strong className="text-[var(--brown)]">{settings.activeRiskMode.replace('_', ' ')}</strong> · Protected characteristics are strictly excluded from all models.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          Adjust weights in Settings
        </button>
      </div>

      {/* Permanent banner when Attention-status proxy is active */}
      {settings.activeRiskMode === 'attention_proxy' && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--risk-critical)] bg-[var(--oxblood-tint)] text-[var(--risk-critical)] px-4 py-3 text-xs flex items-start gap-2.5"
        >
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong>Attention-Status Proxy Active:</strong> This predicts who HR currently flags, not who will leave. Attention Status and Attention Reason are strictly excluded from inputs so the model does not learn the label directly.
          </span>
        </div>
      )}

      {/* Three Mode Cards */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Mode 1 */}
        <div
          className={`card-surface p-4 flex flex-col justify-between gap-3 ${
            settings.activeRiskMode === 'retention_index' ? 'ring-2 ring-[var(--amber)]' : ''
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--brown)]">
                1. Retention Risk Index (Default)
              </h2>
              {settings.activeRiskMode === 'retention_index' && (
                <span className="text-[11px] font-semibold text-[var(--olive-text)]">Active</span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              Transparent rule-weighted score (0–100) blending Engagement ({settings.riskWeights.engagement}%), Workload ({settings.riskWeights.workload}%), Delivery ({settings.riskWeights.delivery}%), and Tenure ({settings.riskWeights.tenure}%). No training or fabricated attrition claims.
            </p>
            <div className="grid grid-cols-4 gap-1.5 mt-3 text-center text-xs tabular-nums">
              {(['Low', 'Medium', 'High', 'Critical'] as const).map((b) => (
                <div key={b} className="rounded bg-[var(--cream)]/60 p-1.5 border border-[var(--border)]">
                  <div className="text-[10px] text-[var(--muted)]">{b}</div>
                  <div className="font-semibold text-[var(--brown)]">{bandDistribution[b]}</div>
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={settings.activeRiskMode === 'retention_index'}
            onClick={() => updateSettings({ activeRiskMode: 'retention_index' })}
            className="btn-primary py-2 text-xs"
          >
            {settings.activeRiskMode === 'retention_index' ? 'Active mode' : 'Use Retention Risk Index'}
          </button>
        </div>

        {/* Mode 2 */}
        <div
          className={`card-surface p-4 flex flex-col justify-between gap-3 ${
            settings.activeRiskMode === 'supervised_attrition' ? 'ring-2 ring-[var(--amber)]' : ''
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--brown)]">
                2. Supervised Attrition Model
              </h2>
              {supervisedEligibility.eligible ? (
                <CheckCircle2 className="w-4 h-4 text-[var(--olive-text)]" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[var(--muted)]" />
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              Trains Logistic Regression, Random Forest, and Gradient-Boosted Trees on real exit data (requires &ge;200 rows and &ge;30 leavers).
            </p>
            <p className="text-xs mt-2 font-medium text-[var(--brown)]">
              Status: {supervisedEligibility.reason}
            </p>
          </div>
          <button
            type="button"
            disabled={!supervisedEligibility.eligible || training}
            onClick={() => handleTrain('supervised_attrition')}
            className="btn-primary py-2 text-xs inline-flex items-center justify-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {training ? 'Training in Web Worker...' : 'Train & activate attrition model'}
          </button>
        </div>

        {/* Mode 3 */}
        <div
          className={`card-surface p-4 flex flex-col justify-between gap-3 ${
            settings.activeRiskMode === 'attention_proxy' ? 'ring-2 ring-[var(--amber)]' : ''
          }`}
        >
          <div>
            <h2 className="text-sm font-semibold text-[var(--brown)]">
              3. Attention-Status Proxy (Optional)
            </h2>
            <p className="text-xs text-[var(--muted)] mt-1">
              Trains client-side models to predict HR&apos;s current Attention Status flag using behavioural and workload features only (no label leakage).
            </p>
            <label className="mt-2.5 flex items-start gap-2 text-xs text-[var(--brown)] cursor-pointer">
              <input
                type="checkbox"
                checked={proxyAccepted}
                onChange={(e) => setProxyAccepted(e.target.checked)}
                className="mt-0.5 accent-[var(--amber)]"
              />
              <span>
                I understand this predicts current HR flags, not actual resignation.
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Threshold priority:</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'recall' | 'balanced' | 'precision')}
                className="h-7 px-2 rounded border border-[var(--border)] bg-[var(--surface)]"
              >
                <option value="recall">Recall (early warning)</option>
                <option value="balanced">Balanced (F1)</option>
                <option value="precision">Precision (limited HR capacity)</option>
              </select>
            </div>
            <button
              type="button"
              disabled={!proxyAccepted || training}
              onClick={() => handleTrain('attention_proxy')}
              className="btn-primary py-2 text-xs inline-flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              {training ? 'Training in Web Worker...' : 'Train & activate proxy model'}
            </button>
          </div>
        </div>
      </section>

      {/* Trained Model Evaluation & Fairness */}
      {displayedModel ? (
        <div className="flex flex-col gap-4">
          {activeSnapshot && displayedModel.snapshotId !== activeSnapshot.id && (
            <div className="rounded-xl border border-[var(--amber)] bg-[var(--amber-tint)]/55 px-4 py-3 text-xs text-[var(--ink-on-amber)] flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>New upload detected:</strong> The displayed model was trained on a previous upload. Retrain to refresh predictions for <strong>{activeSnapshot.fileName}</strong>.
              </span>
              <button
                type="button"
                disabled={training}
                onClick={() => handleTrain(displayedModel.mode)}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {training ? 'Retraining...' : 'Retrain on current upload'}
              </button>
            </div>
          )}

          <div className="card-surface p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--brown)]">
                Model Evaluation & Leaderboard ({displayedModel.mode.replace('_', ' ')})
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Quality Label: <strong className="text-[var(--brown)]">{displayedModel.qualityLabel}</strong> — {displayedModel.qualityReason} · Decision threshold {displayedModel.decisionThreshold}
              </p>
            </div>
            <span className="text-xs text-[var(--muted)] tabular-nums">
              {displayedModel.sampleCount} samples · {displayedModel.positiveCount} positives · Stratified 60/20/20 split
            </span>
          </div>

          {displayedModel.fairnessWarnings.length > 0 && (
            <div className="rounded-xl border border-[var(--amber)] bg-[var(--amber-tint)] px-4 py-3 text-xs text-[var(--ink-on-amber)]">
              <strong>Fairness Check Warning (&gt;1.5× overall flag rate):</strong>{' '}
              {displayedModel.fairnessWarnings
                .map(
                  (w) =>
                    `${w.dimension} "${w.group}" flagged at ${w.flagRate}% vs ${w.overallRate}% overall (${w.ratio}×)`
                )
                .join(' · ')}
            </div>
          )}

          {/* Leaderboard Table */}
          <div className="card-surface p-4 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[var(--cream)] text-[var(--brown)]">
                  <th className="px-3 py-2 border-b border-[var(--border)]">Model</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">ROC AUC</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">PR AUC</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">Precision</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">Recall</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">F1</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">Balanced Acc</th>
                  <th className="px-3 py-2 border-b border-[var(--border)]">Brier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]/60 tabular-nums">
                {displayedModel.leaderboard.map((row) => (
                  <tr
                    key={row.algorithm}
                    className={
                      row.algorithm === displayedModel.bestAlgorithm
                        ? 'bg-[var(--olive-tint)]/45 font-semibold'
                        : ''
                    }
                  >
                    <td className="px-3 py-2">
                      {row.label}
                      {row.algorithm === displayedModel.bestAlgorithm && ' (Selected)'}
                    </td>
                    <td className="px-3 py-2">{row.rocAuc.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.prAuc.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.precision.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.recall.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.f1.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.balancedAccuracy.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.brierScore.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard
              title="Global Feature Importance"
              subtitle="Top drivers without protected characteristics or target leakage"
              exportSlug="model-feature-importance"
              summaryText="Global feature importance ranking."
              csvHeaders={['Feature', 'Importance']}
              csvRows={displayedModel.globalImportance.map((g) => [g.feature, g.importance])}
              option={{
                tooltip: { trigger: 'axis' },
                grid: { left: 155, right: 24, top: 12, bottom: 24 },
                xAxis: { type: 'value' },
                yAxis: {
                  type: 'category',
                  data: [...displayedModel.globalImportance].slice(0, 10).reverse().map((g) => g.feature),
                },
                series: [
                  {
                    type: 'bar',
                    data: [...displayedModel.globalImportance].slice(0, 10).reverse().map((g) => g.importance),
                    itemStyle: { color: BRAND_TOKENS.amber },
                  },
                ],
              }}
            />

            <ChartCard
              title="Threshold Trade-Off Curve"
              subtitle="Validation precision vs recall across decision thresholds"
              exportSlug="model-threshold-curve"
              summaryText="Precision and recall across decision thresholds."
              option={{
                tooltip: { trigger: 'axis' },
                legend: { bottom: 0 },
                grid: { left: 45, right: 20, top: 18, bottom: 42 },
                xAxis: { type: 'category', data: displayedModel.thresholdCurve.map((t) => String(t.threshold)) },
                yAxis: { type: 'value', min: 0, max: 1 },
                series: [
                  { name: 'Precision', type: 'line', data: displayedModel.thresholdCurve.map((t) => t.precision), itemStyle: { color: BRAND_TOKENS.amber } },
                  { name: 'Recall', type: 'line', data: displayedModel.thresholdCurve.map((t) => t.recall), itemStyle: { color: BRAND_TOKENS.olive } },
                  { name: 'F1', type: 'line', data: displayedModel.thresholdCurve.map((t) => t.f1), itemStyle: { color: BRAND_TOKENS.brown } },
                ],
              }}
            />

            <ChartCard
              title="Calibration Curve & Confusion Matrix"
              subtitle={`Test matrix: TP ${displayedModel.confusionMatrix.tp}, FP ${displayedModel.confusionMatrix.fp}, TN ${displayedModel.confusionMatrix.tn}, FN ${displayedModel.confusionMatrix.fn}`}
              exportSlug="model-calibration"
              summaryText="Model probability calibration vs observed rate."
              option={{
                tooltip: { trigger: 'axis' },
                legend: { bottom: 0 },
                grid: { left: 45, right: 20, top: 18, bottom: 42 },
                xAxis: { type: 'category', data: displayedModel.calibrationCurve.map((c) => String(c.meanPredicted)), name: 'Predicted' },
                yAxis: { type: 'value', min: 0, max: 1, name: 'Observed' },
                series: [
                  { name: 'Observed rate', type: 'line', data: displayedModel.calibrationCurve.map((c) => c.observedRate), itemStyle: { color: BRAND_TOKENS.amber } },
                  { name: 'Ideal', type: 'line', lineStyle: { type: 'dashed' }, data: displayedModel.calibrationCurve.map((c) => c.meanPredicted), itemStyle: { color: BRAND_TOKENS.brown } },
                ],
              }}
            />
          </div>

          {displayedModel.pdpTop3 && displayedModel.pdpTop3.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {displayedModel.pdpTop3.map((pdp) => (
                <ChartCard
                  key={pdp.feature}
                  title={`Partial Dependence: ${pdp.feature}`}
                  subtitle="Average predicted probability across feature values"
                  exportSlug={`pdp-${pdp.feature.toLowerCase().replace(/\s+/g, '-')}`}
                  height={220}
                  summaryText={`Partial dependence curve for ${pdp.feature}.`}
                  option={{
                    tooltip: { trigger: 'axis' },
                    grid: { left: 45, right: 18, top: 16, bottom: 28 },
                    xAxis: { type: 'category', data: pdp.points.map((pt) => pt.x) },
                    yAxis: { type: 'value', min: 0, max: 1 },
                    series: [
                      {
                        type: 'line',
                        smooth: true,
                        data: pdp.points.map((pt) => pt.y),
                        itemStyle: { color: BRAND_TOKENS.riskHigh },
                        areaStyle: { color: 'rgba(168, 72, 42, 0.14)' },
                      },
                    ],
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold text-[var(--brown)] mb-2">
            Retention Risk Index Component Drivers (Active Baseline)
          </h2>
          <p className="text-xs text-[var(--muted)] mb-3">
            In Mode 1, risk scores come directly from the deterministic weighted blend of Engagement Risk ({settings.riskWeights.engagement}%), Workload Pressure ({settings.riskWeights.workload}%), Delivery Risk ({settings.riskWeights.delivery}%), and Tenure Risk ({settings.riskWeights.tenure}%).
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard
              title="Average Component Contributions Across Workforce"
              subtitle="Mean component score (0–100) before weighting"
              exportSlug="risk-index-components"
              summaryText="Average Engagement Risk, Workload Pressure, Delivery Risk, and Tenure Risk."
              option={{
                tooltip: { trigger: 'axis' },
                grid: { left: 135, right: 24, top: 14, bottom: 24 },
                xAxis: { type: 'value', min: 0, max: 100 },
                yAxis: { type: 'category', data: ['Tenure Risk', 'Delivery Risk', 'Workload Pressure', 'Engagement Risk'] },
                series: [
                  {
                    type: 'bar',
                    data: [
                      Math.round(allEmployees.reduce((a, b) => a + b.tenureRisk, 0) / allEmployees.length),
                      Math.round(allEmployees.reduce((a, b) => a + b.deliveryRisk, 0) / allEmployees.length),
                      Math.round(allEmployees.reduce((a, b) => a + b.workloadPressure, 0) / allEmployees.length),
                      Math.round(allEmployees.reduce((a, b) => a + b.engagementRisk, 0) / allEmployees.length),
                    ],
                    itemStyle: { color: BRAND_TOKENS.amber },
                    label: { show: true, position: 'right', color: BRAND_TOKENS.brown },
                  },
                ],
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
