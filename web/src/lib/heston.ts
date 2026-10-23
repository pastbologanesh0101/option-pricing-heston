// Heston stochastic-volatility Monte Carlo pricer, ported from
// src/heston.py (full-truncation Euler scheme, Lord/Koekkoek/Van Dijk 2010).
// Runs client/server-side in plain TS — no scipy/numpy needed, so this ships
// fine as a Vercel serverless/edge function with no package-size issues.

import type { OptionType } from "./blackScholes";

// Mulberry32 PRNG — deterministic, seedable, good enough for this demo
// (not cryptographic, matches the reproducibility role numpy's seeded
// Generator plays in the Python version).
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rng: () => number) {
  let spare: number | null = null;
  return function (): number {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0,
      v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };
}

export interface HestonParams {
  v0: number;
  kappa: number;
  theta: number;
  xi: number;
  rho: number;
}

export interface HestonPriceResult {
  price: number;
  stdError: number;
}

export function hestonMcPrice(
  S0: number,
  K: number,
  T: number,
  r: number,
  params: HestonParams,
  optionType: OptionType = "call",
  nPaths = 20000,
  nSteps = 60,
  seed = 42
): HestonPriceResult {
  const { v0, kappa, theta, xi, rho } = params;
  const dt = T / nSteps;
  const sqrtDt = Math.sqrt(dt);
  const rng = mulberry32(seed);
  const gaussian = makeGaussian(rng);

  // antithetic variates: simulate half the paths, mirror the shocks for
  // the other half, average payoff per pair -- same trick as gbm_mc.py
  const half = Math.floor(nPaths / 2);
  const pairAverages = new Float64Array(half);

  for (let p = 0; p < half; p++) {
    let Sp = S0,
      Sn = S0; // "positive" and "negative" (mirrored) paths
    let vp = v0,
      vn = v0;

    for (let t = 0; t < nSteps; t++) {
      const z1 = gaussian();
      const z2 = gaussian();
      const w1 = z1;
      const w2 = rho * z1 + Math.sqrt(1 - rho * rho) * z2;

      const vpPos = Math.max(vp, 0);
      const vnPos = Math.max(vn, 0);
      const sqrtVp = Math.sqrt(vpPos);
      const sqrtVn = Math.sqrt(vnPos);

      Sp = Sp * Math.exp((r - 0.5 * vpPos) * dt + sqrtVp * sqrtDt * w1);
      Sn = Sn * Math.exp((r - 0.5 * vnPos) * dt + sqrtVn * sqrtDt * -w1);

      vp = vp + kappa * (theta - vpPos) * dt + xi * sqrtVp * sqrtDt * w2;
      vn = vn + kappa * (theta - vnPos) * dt + xi * sqrtVn * sqrtDt * -w2;
    }

    const payoffP = optionType === "call" ? Math.max(Sp - K, 0) : Math.max(K - Sp, 0);
    const payoffN = optionType === "call" ? Math.max(Sn - K, 0) : Math.max(K - Sn, 0);
    pairAverages[p] = 0.5 * (payoffP + payoffN);
  }

  const disc = Math.exp(-r * T);
  let sum = 0;
  for (let i = 0; i < half; i++) sum += pairAverages[i];
  const mean = sum / half;

  let sqDiff = 0;
  for (let i = 0; i < half; i++) sqDiff += (pairAverages[i] - mean) ** 2;
  const std = Math.sqrt(sqDiff / (half - 1));

  return {
    price: disc * mean,
    stdError: (disc * std) / Math.sqrt(half),
  };
}

// Prices a strike grid in one call — used to build the implied-vol skew
// shown on the page.
export function hestonSkew(
  S0: number,
  strikes: number[],
  T: number,
  r: number,
  params: HestonParams,
  nPaths = 20000,
  nSteps = 60,
  seed = 42
): { strike: number; price: number }[] {
  return strikes.map((K, i) => ({
    strike: K,
    price: hestonMcPrice(S0, K, T, r, params, "call", nPaths, nSteps, seed + i).price,
  }));
}
