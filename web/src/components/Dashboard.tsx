"use client";

import { useEffect, useMemo, useState } from "react";
import { SkewChart, SERIES_COLORS } from "./SkewChart";

interface MarketSnapshot {
  ticker: string;
  spot: number;
  expiry: string;
  T: number;
  fetchedAt: string;
  chain: { strike: number; impliedVolatility: number }[];
}

interface PriceResponse {
  trueParams: Record<string, number>;
  calibrated: {
    mean: Record<string, number>;
    lower: Record<string, number>;
    upper: Record<string, number>;
  };
  mlTimeMs: number;
  priceRange: { mean: number; lower: number; upper: number };
  naive: { flatVol: number; price: number };
  skew: { strike: number; hestonIv: number | null; flatIv: number }[];
}

const PARAM_META: { key: keyof PriceResponse["trueParams"]; label: string; min: number; max: number; step: number }[] = [
  { key: "v0", label: "v0 — today's variance", min: 0.01, max: 0.09, step: 0.005 },
  { key: "kappa", label: "kappa — mean-reversion speed", min: 0.5, max: 4.0, step: 0.1 },
  { key: "theta", label: "theta — long-run variance", min: 0.01, max: 0.09, step: 0.005 },
  { key: "xi", label: "xi — vol of vol", min: 0.1, max: 0.8, step: 0.05 },
  { key: "rho", label: "rho — leverage correlation", min: -0.9, max: -0.1, step: 0.05 },
];

// Synthetic Heston skew from the research pipeline (src/run_experiments.py),
// reused here so the real-vs-synthetic chart matches results/vol_smile.png.
const SYNTHETIC_STRIKES = [75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130];
const SYNTHETIC_IV = [
  0.2363, 0.2285, 0.2207, 0.2131, 0.2057, 0.1985, 0.1914, 0.1846, 0.1782, 0.1722, 0.1667, 0.1619,
];

export function Dashboard({ initialSnapshot }: { initialSnapshot: MarketSnapshot }) {
  const [spot, setSpot] = useState<{ price: number; changePercent: number } | null>(null);

  const [params, setParams] = useState<Record<string, number>>({
    v0: 0.04,
    kappa: 2.0,
    theta: 0.04,
    xi: 0.3,
    rho: -0.7,
  });
  const [result, setResult] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/spot?ticker=${initialSnapshot.ticker}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok) setSpot(json);
      } catch {
        // live ticker is a nice-to-have; silently skip on failure
      }
    }
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [initialSnapshot.ticker]);

  async function runCalibration() {
    setLoading(true);
    try {
      const res = await fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const json = await res.json();
      setResult(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runCalibration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moneyness = useMemo(
    () => initialSnapshot.chain.map((c) => ({ x: (c.strike / initialSnapshot.spot) * 100, y: c.impliedVolatility * 100 })),
    [initialSnapshot]
  );

  const realExpiryDays = Math.round(initialSnapshot.T * 365);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      {/* Header */}
      <header className="mb-10 border-b pb-6" style={{ borderColor: "#e5e5e3" }}>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#C9A227" }}>
          Review 3 — live demo
        </div>
        <h1 className="mt-1 text-3xl font-bold" style={{ color: "#1E2761" }}>
          Option Pricing Under Stochastic Volatility
        </h1>
        <p className="mt-1 text-neutral-600">
          Using the Heston model and machine learning to make option pricing faster — and honest about its own
          uncertainty.
        </p>
        <p className="mt-1 text-sm text-neutral-500">Rikhil Modalavalasa (25BCE2884) · Vishwanathan (25BCE2885)</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          {spot ? (
            <span>
              {initialSnapshot.ticker} live: <strong>${spot.price.toFixed(2)}</strong>{" "}
              <span className={spot.changePercent >= 0 ? "text-green-600" : "text-red-600"}>
                ({spot.changePercent >= 0 ? "+" : ""}
                {spot.changePercent.toFixed(2)}%)
              </span>
            </span>
          ) : (
            <span className="text-neutral-500">fetching live spot price…</span>
          )}
        </div>
      </header>

      {/* Section 1: interactive calibration */}
      <section className="mb-14">
        <h2 className="text-xl font-semibold" style={{ color: "#1E2761" }}>
          1. Calibrate instantly, with honest uncertainty
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Pick a &quot;true&quot; market via the Heston parameters below. We generate its price surface, then our
          Random Forest recovers the parameters — and a 90% confidence range — in milliseconds, live in your browser.
        </p>

        <div className="mt-5 grid gap-8 md:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            {PARAM_META.map((p) => (
              <div key={p.key}>
                <label className="flex justify-between text-xs text-neutral-600">
                  <span>{p.label}</span>
                  <span className="font-mono">{params[p.key].toFixed(3)}</span>
                </label>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={params[p.key]}
                  onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>
            ))}
            <button
              onClick={runCalibration}
              disabled={loading}
              className="w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#1E2761" }}
            >
              {loading ? "Calibrating…" : "Re-calibrate"}
            </button>
          </div>

          <div>
            {result && (
              <>
                <div className="rounded-lg border p-4" style={{ borderColor: "#e5e5e3" }}>
                  <div className="text-sm text-neutral-500">Fair price (K=100 call), 90% confidence</div>
                  <div className="mt-1 text-2xl font-bold" style={{ color: "#1E2761" }}>
                    ₹{result.priceRange.mean.toFixed(2)}
                    <span className="ml-2 text-base font-normal text-neutral-500">
                      likely ₹{result.priceRange.lower.toFixed(2)} – ₹{result.priceRange.upper.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    Calibrated in <strong>{result.mlTimeMs}ms</strong> (vs. ~2,000ms / 55 resims for the classic
                    Nelder-Mead baseline — roughly {Math.max(1, Math.round(2000 / Math.max(result.mlTimeMs, 1)))}x
                    faster)
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: "#e5e5e3" }}>
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Param</th>
                        <th className="px-3 py-2 text-right">True</th>
                        <th className="px-3 py-2 text-right">ML mean</th>
                        <th className="px-3 py-2 text-right">90% range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PARAM_META.map((p) => (
                        <tr key={p.key} className="border-t" style={{ borderColor: "#e5e5e3" }}>
                          <td className="px-3 py-1.5 font-mono text-xs">{p.key}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs">
                            {result.trueParams[p.key].toFixed(3)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs">
                            {result.calibrated.mean[p.key].toFixed(3)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs text-neutral-500">
                            [{result.calibrated.lower[p.key].toFixed(3)}, {result.calibrated.upper[p.key].toFixed(3)}]
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Notice the ML mean rarely matches &quot;true&quot; exactly even when prices fit well — that&apos;s
                  Heston&apos;s known parameter non-identifiability, not an error.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Section 2: real market validation */}
      <section className="mb-14">
        <h2 className="text-xl font-semibold" style={{ color: "#1E2761" }}>
          2. Validated against real market data
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Real {initialSnapshot.ticker} options chain, spot ${initialSnapshot.spot.toFixed(2)}, {realExpiryDays} days
          to expiry ({initialSnapshot.expiry}) — snapshot fetched{" "}
          {new Date(initialSnapshot.fetchedAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          .
        </p>
        <div className="mt-4">
          <SkewChart
            xLabel="Moneyness (strike / spot × 100)"
            yLabel="Implied volatility (%)"
            series={[
              { label: `Real ${initialSnapshot.ticker} (${realExpiryDays}d)`, color: SERIES_COLORS.real, points: moneyness },
              {
                label: "Synthetic Heston (365d)",
                color: SERIES_COLORS.synthetic,
                points: SYNTHETIC_STRIKES.map((s, i) => ({ x: s, y: SYNTHETIC_IV[i] * 100 })),
              },
            ]}
          />
        </div>
        <p className="mt-2 text-xs italic text-neutral-500">
          Different expiries — short-dated real options are naturally steeper. Compare shape (both skew downward), not
          scale.
        </p>
      </section>

      {/* Section 3: comparison vs a plain existing calculator */}
      <section className="mb-14">
        <h2 className="text-xl font-semibold" style={{ color: "#1E2761" }}>
          3. vs. a typical free options calculator
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Same market price fed into both. Most free calculators assume flat volatility and hand back one number.
        </p>
        {result && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-5" style={{ borderColor: "#e5e5e3" }}>
              <div className="text-xs font-semibold uppercase text-neutral-400">Typical free calculator</div>
              <div className="mt-2 text-2xl font-bold text-neutral-700">₹{result.naive.price.toFixed(2)}</div>
              <ul className="mt-3 space-y-1 text-sm text-neutral-500">
                <li>Flat volatility ({(result.naive.flatVol * 100).toFixed(1)}% assumed at every strike)</li>
                <li>Single number, no confidence range</li>
                <li>No real-market validation shown</li>
              </ul>
            </div>
            <div className="rounded-lg border-2 p-5" style={{ borderColor: "#C9A227" }}>
              <div className="text-xs font-semibold uppercase" style={{ color: "#C9A227" }}>
                This project
              </div>
              <div className="mt-2 text-2xl font-bold" style={{ color: "#1E2761" }}>
                ₹{result.priceRange.mean.toFixed(2)}{" "}
                <span className="text-base font-normal text-neutral-500">
                  (₹{result.priceRange.lower.toFixed(2)}–₹{result.priceRange.upper.toFixed(2)})
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-neutral-600">
                <li>Stochastic volatility — produces a real skew</li>
                <li>Honest 90% confidence range, not a false-precision number</li>
                <li>Validated against a live real options chain, above</li>
              </ul>
            </div>
          </div>
        )}
      </section>

      <footer className="border-t pt-6 text-xs text-neutral-400" style={{ borderColor: "#e5e5e3" }}>
        Full research code, Monte Carlo verification, and write-up:{" "}
        <a
          href="https://github.com/pastbologanesh0101/option-pricing-heston"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          github.com/pastbologanesh0101/option-pricing-heston
        </a>
      </footer>
    </div>
  );
}
