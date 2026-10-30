import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { blackScholesPrice, impliedVol } from "@/lib/blackScholes";
import { hestonMcPrice, hestonSkew, HestonParams } from "@/lib/heston";
import { predictWithUncertainty, RfModel } from "@/lib/rfCalibrator";

const S0 = 100;
const T = 1.0;
const R = 0.05;
const STRIKES = [85, 90, 95, 100, 105, 110, 115];

export const PARAM_RANGES: Record<keyof HestonParams, [number, number]> = {
  v0: [0.01, 0.09],
  kappa: [0.5, 4.0],
  theta: [0.01, 0.09],
  xi: [0.1, 0.8],
  rho: [-0.9, -0.1],
};

let cachedModel: RfModel | null = null;
async function loadModel(): Promise<RfModel> {
  if (cachedModel) return cachedModel;
  const p = path.join(process.cwd(), "src", "data", "rf_model.json");
  const raw = await fs.readFile(p, "utf-8");
  cachedModel = JSON.parse(raw) as RfModel;
  return cachedModel;
}

function clamp(v: number, [lo, hi]: [number, number]) {
  return Math.min(hi, Math.max(lo, v));
}

export async function POST(request: Request) {
  const body = await request.json();

  const trueParams: HestonParams = {
    v0: clamp(Number(body.v0 ?? 0.04), PARAM_RANGES.v0),
    kappa: clamp(Number(body.kappa ?? 2.0), PARAM_RANGES.kappa),
    theta: clamp(Number(body.theta ?? 0.04), PARAM_RANGES.theta),
    xi: clamp(Number(body.xi ?? 0.3), PARAM_RANGES.xi),
    rho: clamp(Number(body.rho ?? -0.7), PARAM_RANGES.rho),
  };

  // 1. Build the "target market" price surface from the chosen true params
  //    (same role as slow_price_surface() in calibration.py / ml_calibration.py)
  const targetSurface = hestonSkew(S0, STRIKES, T, R, trueParams, 8000, 40, 99);
  const targetPrices = targetSurface.map((s) => s.price);

  // 2. ML calibration: recover Heston params from the price surface, with a
  //    90% confidence range from tree-to-tree spread (predictWithUncertainty)
  const model = await loadModel();
  const t0 = Date.now();
  const { mean, lower, upper } = predictWithUncertainty(model, targetPrices);
  const mlTimeMs = Date.now() - t0;

  // 3. Carry the parameter uncertainty through to a final option price range,
  //    at whatever strike the user actually typed in (defaults to 100 = ATM).
  //    Only bounded enough to keep the Monte Carlo numerically sane (no
  //    zero/negative strikes) -- NOT clamped to a narrow window, so two
  //    different real inputs never silently collapse to the same output.
  const kTarget = clamp(Number(body.K ?? 100), [1, 100_000]);
  const pMean = hestonMcPrice(S0, kTarget, T, R, mean as unknown as HestonParams, "call", 12000, 50, 5).price;
  const pLower = hestonMcPrice(S0, kTarget, T, R, lower as unknown as HestonParams, "call", 12000, 50, 5).price;
  const pUpper = hestonMcPrice(S0, kTarget, T, R, upper as unknown as HestonParams, "call", 12000, 50, 5).price;
  const [priceLo, priceHi] = [pLower, pUpper].sort((a, b) => a - b);

  // 4. The "existing website" baseline: flat-vol Black-Scholes, no range at
  //    all. We back out a flat implied vol from the ATM target price so the
  //    comparison uses the same market price input, then price with it.
  const atmIdx = STRIKES.indexOf(100);
  const flatVol = impliedVol(targetPrices[atmIdx], S0, 100, T, R, "call") ?? Math.sqrt(trueParams.theta);
  const naivePrice = blackScholesPrice(S0, kTarget, T, R, flatVol, "call");

  // 5. Implied-vol skew for the chart: our Heston surface vs. the flat line
  //    a naive site would draw (constant at `flatVol`)
  const skew = targetSurface.map((s) => {
    const iv = impliedVol(s.price, S0, s.strike, T, R, "call");
    return { strike: s.strike, hestonIv: iv, flatIv: flatVol };
  });

  return NextResponse.json({
    trueParams,
    calibrated: { mean, lower, upper },
    mlTimeMs,
    priceRange: { mean: pMean, lower: priceLo, upper: priceHi },
    naive: { flatVol, price: naivePrice },
    skew,
    targetSurface,
  });
}
