import type { RiskDriver, TrainedModelSummary } from '../../types/workforce';

export interface MlWorkerRequest {
  id: string;
  mode: 'supervised_attrition' | 'attention_proxy';
  snapshotId: string;
  featureNames: string[];
  rows: number[][];
  targets: number[]; // 0 or 1
  employeeIds: string[];
  departments: string[];
  locations: string[];
  jobLevels: string[];
  thresholdPriority: 'recall' | 'balanced' | 'precision';
  seed?: number;
}

export interface MlWorkerResponse {
  id: string;
  type: 'result' | 'error';
  summary?: TrainedModelSummary;
  error?: string;
}

function createRng(seed: number) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

interface FittedScaler {
  medians: number[];
  p01: number[];
  p99: number[];
  means: number[];
  stds: number[];
}

function fitScaler(X: number[][]): FittedScaler {
  const cols = X[0]?.length ?? 0;
  const medians = new Array<number>(cols).fill(0);
  const p01 = new Array<number>(cols).fill(0);
  const p99 = new Array<number>(cols).fill(0);
  const means = new Array<number>(cols).fill(0);
  const stds = new Array<number>(cols).fill(1);

  for (let c = 0; c < cols; c++) {
    const vals = X.map((r) => r[c]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    medians[c] = quantileSorted(vals, 0.5);
    p01[c] = quantileSorted(vals, 0.01);
    p99[c] = quantileSorted(vals, 0.99);

    const capped = X.map((r) => {
      const raw = Number.isFinite(r[c]) ? r[c] : medians[c];
      return Math.max(p01[c], Math.min(p99[c], raw));
    });
    const m = capped.reduce((a, b) => a + b, 0) / capped.length;
    const v = capped.reduce((a, b) => a + (b - m) ** 2, 0) / capped.length;
    means[c] = m;
    stds[c] = Math.sqrt(v) > 1e-8 ? Math.sqrt(v) : 1;
  }

  return { medians, p01, p99, means, stds };
}

function applyScaler(X: number[][], scaler: FittedScaler): number[][] {
  return X.map((row) =>
    row.map((val, c) => {
      const imputed = Number.isFinite(val) ? val : scaler.medians[c];
      const capped = Math.max(scaler.p01[c], Math.min(scaler.p99[c], imputed));
      return (capped - scaler.means[c]) / scaler.stds[c];
    })
  );
}

function stratifiedSplit(targets: number[], rng: () => number) {
  const posIdx: number[] = [];
  const negIdx: number[] = [];
  targets.forEach((y, i) => (y === 1 ? posIdx : negIdx).push(i));

  const shuffle = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const p = shuffle(posIdx);
  const n = shuffle(negIdx);

  const splitGroup = (arr: number[]) => {
    const tEnd = Math.max(1, Math.floor(arr.length * 0.6));
    const vEnd = Math.max(tEnd + 1, Math.floor(arr.length * 0.8));
    return {
      train: arr.slice(0, tEnd),
      val: arr.slice(tEnd, vEnd),
      test: arr.slice(vEnd),
    };
  };

  const ps = splitGroup(p);
  const ns = splitGroup(n);

  return {
    train: [...ps.train, ...ns.train],
    val: [...ps.val, ...ns.val],
    test: [...ps.test, ...ns.test],
  };
}

// 1. L2-regularised weighted Logistic Regression
function trainLogisticRegression(X: number[][], y: number[], l2 = 0.05, epochs = 180) {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const weights = new Array<number>(d).fill(0);
  let bias = 0;

  const posCount = Math.max(1, y.filter((v) => v === 1).length);
  const negCount = Math.max(1, n - posCount);
  const wPos = negCount / posCount;

  const lr = 0.08;
  for (let ep = 0; ep < epochs; ep++) {
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < d; j++) z += weights[j] * X[i][j];
      const pred = sigmoid(z);
      const sampleWeight = y[i] === 1 ? wPos : 1;
      const err = (pred - y[i]) * sampleWeight;
      gradB += err;
      for (let j = 0; j < d; j++) gradW[j] += err * X[i][j];
    }
    bias -= (lr * gradB) / n;
    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
    }
  }

  return {
    weights,
    bias,
    predictProba(Xtest: number[][]): number[] {
      return Xtest.map((row) => {
        let z = bias;
        for (let j = 0; j < d; j++) z += weights[j] * row[j];
        return sigmoid(z);
      });
    },
  };
}

// Decision Tree node for Random Forest and GBT
interface TreeNode {
  leaf: boolean;
  value: number;
  feature?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function buildRegressionTree(
  X: number[][],
  targets: number[],
  sampleWeights: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minLeaf: number,
  featureSubset: number[]
): TreeNode {
  if (indices.length === 0) return { leaf: true, value: 0 };
  let wSum = 0;
  let wySum = 0;
  for (const idx of indices) {
    wSum += sampleWeights[idx];
    wySum += sampleWeights[idx] * targets[idx];
  }
  const meanVal = wSum > 0 ? wySum / wSum : 0;

  if (depth >= maxDepth || indices.length < minLeaf * 2) {
    return { leaf: true, value: meanVal };
  }

  let bestGain = 1e-7;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  const totalVar = indices.reduce((acc, idx) => {
    const diff = targets[idx] - meanVal;
    return acc + sampleWeights[idx] * diff * diff;
  }, 0);

  for (const f of featureSubset) {
    const vals = indices.map((i) => X[i][f]).sort((a, b) => a - b);
    // Test up to 8 quantile candidate thresholds for speed
    for (let q = 1; q <= 7; q++) {
      const thresh = quantileSorted(vals, q / 8);
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      let lw = 0, lwy = 0, rw = 0, rwy = 0;

      for (const idx of indices) {
        if (X[idx][f] <= thresh) {
          leftIdx.push(idx);
          lw += sampleWeights[idx];
          lwy += sampleWeights[idx] * targets[idx];
        } else {
          rightIdx.push(idx);
          rw += sampleWeights[idx];
          rwy += sampleWeights[idx] * targets[idx];
        }
      }
      if (leftIdx.length < minLeaf || rightIdx.length < minLeaf) continue;

      const lMean = lw > 0 ? lwy / lw : 0;
      const rMean = rw > 0 ? rwy / rw : 0;
      let err = 0;
      for (const idx of leftIdx) err += sampleWeights[idx] * (targets[idx] - lMean) ** 2;
      for (const idx of rightIdx) err += sampleWeights[idx] * (targets[idx] - rMean) ** 2;

      const gain = totalVar - err;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = thresh;
        bestLeft = leftIdx;
        bestRight = rightIdx;
      }
    }
  }

  if (bestFeature === -1) {
    return { leaf: true, value: meanVal };
  }

  return {
    leaf: false,
    value: meanVal,
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildRegressionTree(X, targets, sampleWeights, bestLeft, depth + 1, maxDepth, minLeaf, featureSubset),
    right: buildRegressionTree(X, targets, sampleWeights, bestRight, depth + 1, maxDepth, minLeaf, featureSubset),
  };
}

function predictTree(node: TreeNode, row: number[]): number {
  let cur = node;
  while (!cur.leaf) {
    if (cur.feature === undefined || cur.threshold === undefined) break;
    cur = row[cur.feature] <= cur.threshold ? cur.left! : cur.right!;
  }
  return cur.value;
}

// 2. Random Forest (100 trees, depth 4, class-weighted)
function trainRandomForest(X: number[][], y: number[], rng: () => number, nTrees = 100) {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const posCount = Math.max(1, y.filter((v) => v === 1).length);
  const wPos = Math.max(1, (n - posCount) / posCount);
  const sampleWeights = y.map((v) => (v === 1 ? wPos : 1));
  const mtry = Math.max(2, Math.floor(Math.sqrt(d)));
  const trees: TreeNode[] = [];

  for (let t = 0; t < nTrees; t++) {
    const bootIdx: number[] = [];
    for (let i = 0; i < n; i++) bootIdx.push(Math.floor(rng() * n));
    const allFeat = Array.from({ length: d }, (_, i) => i);
    for (let i = allFeat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [allFeat[i], allFeat[j]] = [allFeat[j], allFeat[i]];
    }
    const subset = allFeat.slice(0, mtry);
    trees.push(buildRegressionTree(X, y, sampleWeights, bootIdx, 0, 4, 4, subset));
  }

  return {
    predictProba(Xtest: number[][]): number[] {
      return Xtest.map((row) => {
        let sum = 0;
        for (const tree of trees) sum += predictTree(tree, row);
        return Math.max(0.001, Math.min(0.999, sum / trees.length));
      });
    },
  };
}

// 3. Gradient-Boosted Trees (depth 3, class-weighted log-loss)
function trainGradientBoostedTrees(X: number[][], y: number[], rng: () => number, nRounds = 40) {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const posCount = Math.max(1, y.filter((v) => v === 1).length);
  const wPos = Math.max(1, (n - posCount) / posCount);
  const sampleWeights = y.map((v) => (v === 1 ? wPos : 1));

  const baseRate = posCount / Math.max(1, n);
  const baseLogOdds = Math.log(Math.max(0.01, baseRate) / Math.max(0.01, 1 - baseRate));
  const rawPreds = new Array<number>(n).fill(baseLogOdds);
  const trees: TreeNode[] = [];
  const lr = 0.08;
  const allIndices = Array.from({ length: n }, (_, i) => i);
  const allFeatures = Array.from({ length: d }, (_, i) => i);

  for (let r = 0; r < nRounds; r++) {
    const residuals = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      residuals[i] = y[i] - sigmoid(rawPreds[i]);
    }
    // Subsample 80% rows for stochastic boosting
    const subIdx = allIndices.filter(() => rng() < 0.8);
    const tree = buildRegressionTree(
      X,
      residuals,
      sampleWeights,
      subIdx.length >= 10 ? subIdx : allIndices,
      0,
      3,
      5,
      allFeatures
    );
    trees.push(tree);
    for (let i = 0; i < n; i++) {
      rawPreds[i] += lr * predictTree(tree, X[i]);
    }
  }

  return {
    predictProba(Xtest: number[][]): number[] {
      return Xtest.map((row) => {
        let z = baseLogOdds;
        for (const tree of trees) z += lr * predictTree(tree, row);
        return sigmoid(z);
      });
    },
  };
}

function computeAuc(yTrue: number[], yProb: number[]): number {
  const pairs = yTrue.map((y, i) => ({ y, p: yProb[i] })).sort((a, b) => b.p - a.p);
  const pos = pairs.filter((x) => x.y === 1).length;
  const neg = pairs.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  let tp = 0;
  let fp = 0;
  let prevTp = 0;
  let prevFp = 0;
  let auc = 0;
  for (const item of pairs) {
    if (item.y === 1) tp += 1;
    else fp += 1;
    auc += ((fp - prevFp) * (tp + prevTp)) / 2;
    prevTp = tp;
    prevFp = fp;
  }
  return auc / (pos * neg);
}

function computePrAuc(yTrue: number[], yProb: number[]): number {
  const pairs = yTrue.map((y, i) => ({ y, p: yProb[i] })).sort((a, b) => b.p - a.p);
  const totalPos = pairs.filter((x) => x.y === 1).length;
  if (totalPos === 0) return 0;
  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevRecall = 0;
  for (const item of pairs) {
    if (item.y === 1) tp += 1;
    else fp += 1;
    const recall = tp / totalPos;
    const precision = tp / (tp + fp);
    auc += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return auc;
}

function evalAtThreshold(yTrue: number[], yProb: number[], threshold: number) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  let brierSum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const pred = yProb[i] >= threshold ? 1 : 0;
    const y = yTrue[i];
    if (pred === 1 && y === 1) tp += 1;
    else if (pred === 1 && y === 0) fp += 1;
    else if (pred === 0 && y === 0) tn += 1;
    else fn += 1;
    brierSum += (yProb[i] - y) ** 2;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const spec = tn + fp > 0 ? tn / (tn + fp) : 0;
  const balancedAccuracy = (recall + spec) / 2;
  const brierScore = yTrue.length > 0 ? brierSum / yTrue.length : 0;
  return { tp, fp, tn, fn, precision, recall, f1, balancedAccuracy, brierScore };
}

self.onmessage = (event: MessageEvent<MlWorkerRequest>) => {
  const req = event.data;
  try {
    const rng = createRng(req.seed ?? 42);
    const split = stratifiedSplit(req.targets, rng);

    const takeRows = (indices: number[]) => indices.map((i) => req.rows[i]);
    const takeY = (indices: number[]) => indices.map((i) => req.targets[i]);

    const XTrainRaw = takeRows(split.train);
    const yTrain = takeY(split.train);
    const XValRaw = takeRows(split.val);
    const yVal = takeY(split.val);
    const XTestRaw = takeRows(split.test);
    const yTest = takeY(split.test);

    // Fit scaler ONLY on training fold (no leakage)
    const scaler = fitScaler(XTrainRaw);
    const XTrain = applyScaler(XTrainRaw, scaler);
    const XVal = applyScaler(XValRaw, scaler);
    const XTest = applyScaler(XTestRaw, scaler);
    const XAll = applyScaler(req.rows, scaler);

    const lrModel = trainLogisticRegression(XTrain, yTrain);
    const rfModel = trainRandomForest(XTrain, yTrain, rng, 100);
    const gbtModel = trainGradientBoostedTrees(XTrain, yTrain, rng, 40);

    const candidates = [
      { key: 'logistic_regression' as const, label: 'Logistic Regression (L2)', model: lrModel },
      { key: 'random_forest' as const, label: 'Random Forest (100 trees)', model: rfModel },
      { key: 'gradient_boosted_trees' as const, label: 'Gradient-Boosted Trees', model: gbtModel },
    ];

    // Pick best by validation PR AUC (ties broken by simplicity: LR -> RF -> GBT)
    let best = candidates[0];
    let bestValPrAuc = -1;
    for (const c of candidates) {
      const valProbs = c.model.predictProba(XVal);
      const prAuc = computePrAuc(yVal, valProbs);
      if (prAuc > bestValPrAuc + 0.005) {
        bestValPrAuc = prAuc;
        best = c;
      }
    }

    // Choose threshold on validation set by priority
    const bestValProbs = best.model.predictProba(XVal);
    const thresholdCurve: TrainedModelSummary['thresholdCurve'] = [];
    let chosenThreshold = 0.5;
    let bestScore = -1;

    for (let t = 15; t <= 85; t += 5) {
      const th = t / 100;
      const ev = evalAtThreshold(yVal, bestValProbs, th);
      thresholdCurve.push({
        threshold: th,
        precision: Math.round(ev.precision * 1000) / 1000,
        recall: Math.round(ev.recall * 1000) / 1000,
        f1: Math.round(ev.f1 * 1000) / 1000,
      });
      const objective =
        req.thresholdPriority === 'recall'
          ? ev.recall * 0.7 + ev.precision * 0.3
          : req.thresholdPriority === 'precision'
          ? ev.precision * 0.7 + ev.recall * 0.3
          : ev.f1;
      if (objective > bestScore) {
        bestScore = objective;
        chosenThreshold = th;
      }
    }

    // Evaluate all models + naive baseline on held-out test set
    const leaderboard: TrainedModelSummary['leaderboard'] = candidates.map((c) => {
      const testProbs = c.model.predictProba(XTest);
      const ev = evalAtThreshold(yTest, testProbs, chosenThreshold);
      return {
        algorithm: c.key,
        label: c.label,
        rocAuc: Math.round(computeAuc(yTest, testProbs) * 1000) / 1000,
        prAuc: Math.round(computePrAuc(yTest, testProbs) * 1000) / 1000,
        precision: Math.round(ev.precision * 1000) / 1000,
        recall: Math.round(ev.recall * 1000) / 1000,
        f1: Math.round(ev.f1 * 1000) / 1000,
        balancedAccuracy: Math.round(ev.balancedAccuracy * 1000) / 1000,
        brierScore: Math.round(ev.brierScore * 1000) / 1000,
      };
    });

    // Naive baseline (always predict majority class)
    const testPosRate = yTest.filter((v) => v === 1).length / Math.max(1, yTest.length);
    const naiveProbs = yTest.map(() => (testPosRate >= 0.5 ? 1 : 0));
    const naiveEv = evalAtThreshold(yTest, naiveProbs, 0.5);
    leaderboard.push({
      algorithm: 'naive_baseline',
      label: 'Naive Majority Baseline',
      rocAuc: 0.5,
      prAuc: Math.round(testPosRate * 1000) / 1000,
      precision: Math.round(naiveEv.precision * 1000) / 1000,
      recall: Math.round(naiveEv.recall * 1000) / 1000,
      f1: Math.round(naiveEv.f1 * 1000) / 1000,
      balancedAccuracy: 0.5,
      brierScore: Math.round(naiveEv.brierScore * 1000) / 1000,
    });

    const bestTestProbs = best.model.predictProba(XTest);
    const bestTestEv = evalAtThreshold(yTest, bestTestProbs, chosenThreshold);
    const bestTestMetrics = leaderboard.find((l) => l.algorithm === best.key)!;

    // Calibration curve (5 bins)
    const calibrationCurve: TrainedModelSummary['calibrationCurve'] = [];
    for (let b = 0; b < 5; b++) {
      const lo = b * 0.2;
      const hi = (b + 1) * 0.2;
      const binItems = bestTestProbs
        .map((p, idx) => ({ p, y: yTest[idx] }))
        .filter((item) => item.p >= lo && (b === 4 ? item.p <= hi : item.p < hi));
      if (binItems.length > 0) {
        calibrationCurve.push({
          binCenter: Math.round(((lo + hi) / 2) * 100) / 100,
          meanPredicted: Math.round((binItems.reduce((a, x) => a + x.p, 0) / binItems.length) * 1000) / 1000,
          observedRate: Math.round((binItems.reduce((a, x) => a + x.y, 0) / binItems.length) * 1000) / 1000,
          count: binItems.length,
        });
      }
    }

    // Quality label honesty check
    const testPositives = yTest.filter((v) => v === 1).length;
    let qualityLabel: TrainedModelSummary['qualityLabel'] = 'Reliable';
    let qualityReason = `Held-out test ROC AUC is ${bestTestMetrics.rocAuc.toFixed(2)} with ${testPositives} positive test cases.`;
    if (bestTestMetrics.rocAuc < 0.65 || testPositives < 10) {
      qualityLabel = 'Not reliable';
      qualityReason =
        testPositives < 10
          ? `Held-out test set has only ${testPositives} positive cases (< 10); metrics are unstable.`
          : `Held-out test ROC AUC (${bestTestMetrics.rocAuc.toFixed(2)}) is below 0.65.`;
    } else if (testPositives < 30 || bestTestMetrics.rocAuc < 0.75) {
      qualityLabel = 'Use with caution';
      qualityReason =
        testPositives < 30
          ? `Held-out test set has ${testPositives} positives (< 30 recommended).`
          : `Held-out test ROC AUC (${bestTestMetrics.rocAuc.toFixed(2)}) shows moderate separation.`;
    }

    // Global feature importance (permutation importance on test set for tree models; std coeffs for LR)
    const globalImportance: TrainedModelSummary['globalImportance'] = [];
    if (best.key === 'logistic_regression') {
      lrModel.weights.forEach((w, idx) => {
        globalImportance.push({
          feature: req.featureNames[idx],
          importance: Math.round(Math.abs(w) * 1000) / 1000,
          direction: w >= 0 ? 'positive' : 'negative',
        });
      });
    } else {
      const basePr = computePrAuc(yTest, bestTestProbs);
      for (let f = 0; f < req.featureNames.length; f++) {
        const permX = XTest.map((r) => [...r]);
        const colVals = permX.map((r) => r[f]);
        for (let i = colVals.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [colVals[i], colVals[j]] = [colVals[j], colVals[i]];
        }
        permX.forEach((r, idx) => {
          r[f] = colVals[idx];
        });
        const permPr = computePrAuc(yTest, best.model.predictProba(permX));
        globalImportance.push({
          feature: req.featureNames[f],
          importance: Math.round(Math.max(0, basePr - permPr) * 1000) / 1000,
        });
      }
    }
    globalImportance.sort((a, b) => b.importance - a.importance);

    // Partial-dependence style curve for top 3 drivers
    const pdpTop3: TrainedModelSummary['pdpTop3'] = globalImportance.slice(0, 3).map((imp) => {
      const fIdx = req.featureNames.indexOf(imp.feature);
      const rawSorted = req.rows.map((r) => r[fIdx]).sort((a, b) => a - b);
      const points: Array<{ x: string; y: number }> = [];
      for (let q = 0; q <= 4; q++) {
        const val = quantileSorted(rawSorted, q / 4);
        const stdVal = (val - scaler.means[fIdx]) / scaler.stds[fIdx];
        const modX = XTest.slice(0, 60).map((r) => {
          const copy = [...r];
          copy[fIdx] = stdVal;
          return copy;
        });
        const preds = best.model.predictProba(modX);
        const avgPred = preds.reduce((a, b) => a + b, 0) / Math.max(1, preds.length);
        points.push({
          x: val.toFixed(1),
          y: Math.round(avgPred * 1000) / 10,
        });
      }
      return { feature: imp.feature, points };
    });

    // Score all employees + fairness check + local drivers
    const allProbs = best.model.predictProba(XAll);
    const overallFlagRate =
      allProbs.filter((p) => p >= chosenThreshold).length / Math.max(1, allProbs.length);

    const fairnessWarnings: TrainedModelSummary['fairnessWarnings'] = [];
    const checkDimension = (dimName: string, values: string[]) => {
      const buckets = new Map<string, number[]>();
      values.forEach((v, idx) => {
        const arr = buckets.get(v) ?? [];
        arr.push(allProbs[idx]);
        buckets.set(v, arr);
      });
      for (const [group, probs] of buckets.entries()) {
        if (probs.length < 5 || overallFlagRate === 0) continue;
        const rate = probs.filter((p) => p >= chosenThreshold).length / probs.length;
        const ratio = rate / overallFlagRate;
        if (ratio > 1.5) {
          fairnessWarnings.push({
            dimension: dimName,
            group,
            flagRate: Math.round(rate * 1000) / 10,
            overallRate: Math.round(overallFlagRate * 1000) / 10,
            ratio: Math.round(ratio * 100) / 100,
          });
        }
      }
    };
    checkDimension('Department', req.departments);
    checkDimension('Location', req.locations);
    checkDimension('Job Level', req.jobLevels);

    const employeeProbabilities: TrainedModelSummary['employeeProbabilities'] = {};
    const topFeatures = globalImportance.slice(0, 8).map((g) => req.featureNames.indexOf(g.feature));

    req.employeeIds.forEach((empId, i) => {
      const drivers: RiskDriver[] = topFeatures.map((fIdx) => {
        const empRaw = req.rows[i][fIdx];
        const medRaw = scaler.medians[fIdx];
        // Approximate local contribution via signed standardised difference * importance
        const stdDiff = XAll[i][fIdx];
        const lrWeight = lrModel.weights[fIdx] ?? 0;
        const effectPts = Math.round(stdDiff * lrWeight * 15);
        return {
          factor: req.featureNames[fIdx],
          employeeValue: empRaw.toFixed(1),
          peerMedian: medRaw.toFixed(1),
          effectPoints: effectPts,
          direction: effectPts >= 0 ? 'up' : 'down',
        };
      });
      drivers.sort((a, b) => Math.abs(b.effectPoints) - Math.abs(a.effectPoints));
      employeeProbabilities[empId] = {
        probability: Math.round(allProbs[i] * 1000) / 10,
        drivers,
      };
    });

    const summary: TrainedModelSummary = {
      id: `${req.mode}_${Date.now()}`,
      mode: req.mode,
      trainedAt: new Date().toISOString(),
      snapshotId: req.snapshotId,
      sampleCount: req.rows.length,
      positiveCount: req.targets.filter((v) => v === 1).length,
      bestAlgorithm: best.key,
      decisionThreshold: chosenThreshold,
      thresholdPriority: req.thresholdPriority,
      qualityLabel,
      qualityReason,
      featuresUsed: req.featureNames,
      leaderboard,
      confusionMatrix: {
        tp: bestTestEv.tp,
        fp: bestTestEv.fp,
        tn: bestTestEv.tn,
        fn: bestTestEv.fn,
      },
      calibrationCurve,
      thresholdCurve,
      globalImportance: globalImportance.slice(0, 15),
      pdpTop3,
      fairnessWarnings,
      employeeProbabilities,
    };

    self.postMessage({ id: req.id, type: 'result', summary } satisfies MlWorkerResponse);
  } catch (err) {
    self.postMessage({
      id: req.id,
      type: 'error',
      error: err instanceof Error ? err.message : 'Model training failed.',
    } satisfies MlWorkerResponse);
  }
};
