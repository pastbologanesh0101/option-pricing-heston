// Walks the Random Forest exported by src/export_rf_for_web.py to predict
// Heston parameters from a price surface, with a 90% confidence range taken
// from the spread across trees -- same idea as ml_calibration.py's
// predict_with_uncertainty(), just reimplemented in TS so it can run in a
// Vercel serverless function without a Python runtime.

export interface RfTree {
  childrenLeft: number[];
  childrenRight: number[];
  feature: number[];
  threshold: number[];
  value: number[][]; // [node][paramIndex]
}

export interface RfModel {
  paramNames: string[];
  priceCols: string[];
  nEstimators: number;
  trees: RfTree[];
}

function predictOneTree(tree: RfTree, x: number[]): number[] {
  let node = 0;
  while (tree.childrenLeft[node] !== -1) {
    const f = tree.feature[node];
    node = x[f] <= tree.threshold[node] ? tree.childrenLeft[node] : tree.childrenRight[node];
  }
  return tree.value[node];
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface CalibrationResult {
  mean: Record<string, number>;
  lower: Record<string, number>;
  upper: Record<string, number>;
}

// x must be in the same order as model.priceCols (prices at strikes
// 85,90,95,100,105,110,115 for S0=100, T=1.0, r=0.05).
export function predictWithUncertainty(model: RfModel, x: number[]): CalibrationResult {
  const nParams = model.paramNames.length;
  const perTree: number[][] = model.trees.map((t) => predictOneTree(t, x));

  const mean: Record<string, number> = {};
  const lower: Record<string, number> = {};
  const upper: Record<string, number> = {};

  for (let p = 0; p < nParams; p++) {
    const vals = perTree.map((row) => row[p]).sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    mean[model.paramNames[p]] = sum / vals.length;
    lower[model.paramNames[p]] = percentile(vals, 5);
    upper[model.paramNames[p]] = percentile(vals, 95);
  }

  return { mean, lower, upper };
}
