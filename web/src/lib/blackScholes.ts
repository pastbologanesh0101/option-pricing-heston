// Closed-form Black-Scholes pricing — the "flat volatility" baseline that
// every plain/free option calculator website uses. We price with it too, so
// the UI can show it side by side with our Heston + ML result.

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export type OptionType = "call" | "put";

export function blackScholesPrice(
  S0: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  optionType: OptionType = "call"
): number {
  if (T <= 0) {
    return optionType === "call" ? Math.max(S0 - K, 0) : Math.max(K - S0, 0);
  }
  const d1 = (Math.log(S0 / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (optionType === "call") {
    return S0 * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S0 * normCdf(-d1);
}

// Inverts Black-Scholes for implied vol via bisection (stand-in for
// scipy.optimize.brentq used in the Python version).
export function impliedVol(
  price: number,
  S0: number,
  K: number,
  T: number,
  r: number,
  optionType: OptionType = "call"
): number | null {
  let lo = 1e-4;
  let hi = 5.0;
  const f = (sigma: number) => blackScholesPrice(S0, K, T, r, sigma, optionType) - price;
  let flo = f(lo);
  const fhi = f(hi);
  if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-8) return mid;
    if (flo * fmid < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}
