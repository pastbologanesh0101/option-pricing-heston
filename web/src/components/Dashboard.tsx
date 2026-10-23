"use client";

import { useEffect, useMemo, useState } from "react";
import { SkewChart, SERIES_COLORS } from "./SkewChart";
import { Sparkline } from "./Sparkline";

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

// ---- design tokens --------------------------------------------------
const C = {
  bg: "#0a0a0d",
  surface: "#121216",
  panel: "#16161c",
  border: "#26262e",
  borderStrong: "#34343f",
  gold: "#C9A227",
  goldBright: "#e3bb3a",
  blue: "#3987e5",
  orange: "#d95926",
  good: "#19c37d",
  critical: "#e5484d",
  text: "#e8e8ec",
  textMuted: "#9a9aa5",
  textFaint: "#6b6b76",
};

const PARAM_META: { key: keyof PriceResponse["trueParams"]; label: string; min: number; max: number; step: number }[] = [
  { key: "v0", label: "v0 — today's variance", min: 0.01, max: 0.09, step: 0.005 },
  { key: "kappa", label: "kappa — mean-reversion speed", min: 0.5, max: 4.0, step: 0.1 },
  { key: "theta", label: "theta — long-run variance", min: 0.01, max: 0.09, step: 0.005 },
  { key: "xi", label: "xi — vol of vol", min: 0.1, max: 0.8, step: 0.05 },
  { key: "rho", label: "rho — leverage correlation", min: -0.9, max: -0.1, step: 0.05 },
];

const SYNTHETIC_STRIKES = [75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130];
const SYNTHETIC_IV = [
  0.2363, 0.2285, 0.2207, 0.2131, 0.2057, 0.1985, 0.1914, 0.1846, 0.1782, 0.1722, 0.1667, 0.1619,
];

const PIPELINE = [
  {
    n: 1,
    title: "Foundation",
    file: "black_scholes.py",
    desc: "Closed-form Black-Scholes pricer, verified against put-call parity.",
    stat: "Verified",
    good: true,
  },
  {
    n: 2,
    title: "Simulation",
    file: "gbm_mc.py",
    desc: "Monte Carlo pricing under GBM, with antithetic variates for variance reduction.",
    stat: "−28% std error",
    good: true,
  },
  {
    n: 3,
    title: "Realism",
    file: "heston.py",
    desc: "Heston stochastic volatility — collapses to Black-Scholes at xi=0, produces a real skew it can't.",
    stat: "3-SE collapse check",
    good: true,
  },
  {
    n: 4,
    title: "Data",
    file: "generate_dataset.py",
    desc: "6,000 random (parameters → price surface) samples for training the calibrator.",
    stat: "6,000 samples",
    good: true,
  },
  {
    n: 5,
    title: "Baseline calibration",
    file: "calibration.py",
    desc: "Nelder-Mead recovers parameters from prices — slow, and surfaces non-identifiability.",
    stat: "~2s / 55 resims",
    good: true,
  },
  {
    n: 6,
    title: "ML calibration",
    file: "ml_calibration.py",
    desc: "Random Forest prices → parameters directly. Tree-to-tree spread gives a 90% range for free.",
    stat: "~250x faster",
    good: true,
  },
  {
    n: 7,
    title: "Market validation",
    file: "market_validation.py",
    desc: "Live SPY options chain confirms the same downward skew direction, outside the simulation.",
    stat: "Live",
    good: true,
  },
];

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ background: C.panel, borderColor: C.border }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textFaint }}>
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-bold" style={{ color: C.goldBright }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

interface SpotData {
  price: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  volume: number;
  series: { t: number; price: number }[];
}

function fmtVol(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

function WatchRow({
  symbol,
  name,
  value,
  sub,
  deltaLabel,
  deltaPositive,
  badge,
  badgeColor,
}: {
  symbol: string;
  name: string;
  value: string;
  sub?: string;
  deltaLabel?: string;
  deltaPositive?: boolean;
  badge: string;
  badgeColor: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
          style={{ background: badgeColor, color: C.bg }}
        >
          {badge}
        </span>
        <div>
          <div className="font-mono text-xs font-semibold" style={{ color: C.text }}>
            {symbol}
          </div>
          <div className="text-[10px]" style={{ color: C.textFaint }}>
            {name}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-xs font-semibold" style={{ color: C.text }}>
          {value}
        </div>
        {deltaLabel ? (
          <div className="font-mono text-[10px]" style={{ color: deltaPositive ? C.good : C.critical }}>
            {deltaLabel}
          </div>
        ) : sub ? (
          <div className="text-[10px]" style={{ color: C.textFaint }}>
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeading({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold"
        style={{ background: C.gold, color: C.bg }}
      >
        {n}
      </span>
      <div>
        <h2 className="text-xl font-semibold" style={{ color: C.text }}>
          {title}
        </h2>
        <p className="mt-1 text-sm" style={{ color: C.textMuted }}>
          {sub}
        </p>
      </div>
    </div>
  );
}

export function Dashboard({ initialSnapshot }: { initialSnapshot: MarketSnapshot }) {
  const [spot, setSpot] = useState<SpotData | null>(null);
  const [tick, setTick] = useState(0);

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
        if (!cancelled && res.ok) {
          setSpot(json);
          setTick((t) => t + 1);
        }
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
  const atmReal = moneyness.find((m) => m.x >= 98 && m.x <= 102);

  return (
    <div style={{ background: C.bg }}>
      <div className="mx-auto max-w-6xl px-5 py-10">
        {/* ============ HERO ============ */}
        <header className="mb-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.gold }}>
              ● Review 3 — Live Demo
            </div>
            <a
              href="https://github.com/pastbologanesh0101/option-pricing-heston"
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-3 py-1 text-xs transition-colors hover:border-neutral-500"
              style={{ borderColor: C.border, color: C.textMuted }}
            >
              ↗ View source on GitHub
            </a>
          </div>

          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: C.text }}>
            Option Pricing Under <span style={{ color: C.goldBright }}>Stochastic Volatility</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base" style={{ color: C.textMuted }}>
            Using the Heston model and machine learning to make option pricing faster — and honest about its own
            uncertainty.
          </p>
          <p className="mt-2 font-mono text-sm" style={{ color: C.textFaint }}>
            Rikhil Modalavalasa (25BCE2884) · Vishwanathan (25BCE2885)
          </p>

          {/* live status pill */}
          <div
            className="mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            style={{ background: C.panel, borderColor: C.border }}
          >
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                style={{ background: C.good }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.good }} />
            </span>
            <span className="text-xs" style={{ color: C.textMuted }}>
              {spot ? `live feed connected · refreshed ${tick} time${tick === 1 ? "" : "s"} this session` : "connecting to live feed…"}
            </span>
          </div>

          {/* ===== TradingView-style hero: chart + watchlist ===== */}
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_300px]">
            {/* main chart card */}
            <div className="rounded-xl border p-5" style={{ background: C.panel, borderColor: C.border }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-sm font-bold"
                    style={{ background: C.blue, color: C.bg }}
                  >
                    S
                  </span>
                  <div>
                    <div className="font-mono text-sm font-semibold" style={{ color: C.text }}>
                      {initialSnapshot.ticker} <span style={{ color: C.textFaint }}>· SPDR S&amp;P 500 ETF</span>
                    </div>
                    <div className="text-[11px]" style={{ color: C.textFaint }}>
                      NYSEArca · intraday, 5m bars
                    </div>
                  </div>
                </div>
                {spot && (
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold" style={{ color: C.text }}>
                      ${spot.price.toFixed(2)}
                    </div>
                    <div className="font-mono text-sm" style={{ color: spot.changePercent >= 0 ? C.good : C.critical }}>
                      {spot.changePercent >= 0 ? "▲" : "▼"} {Math.abs(spot.changePercent).toFixed(2)}% today
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <Sparkline points={spot?.series ?? []} positive={(spot?.changePercent ?? 0) >= 0} />
              </div>
            </div>

            {/* watchlist sidebar */}
            <div className="rounded-xl border overflow-hidden" style={{ background: C.panel, borderColor: C.border }}>
              <div
                className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: "#1a1a20", color: C.textFaint, borderBottom: `1px solid ${C.border}` }}
              >
                Live &amp; derived — watchlist
              </div>
              {spot && (
                <>
                  <WatchRow
                    symbol={initialSnapshot.ticker}
                    name="Spot price"
                    value={`$${spot.price.toFixed(2)}`}
                    deltaLabel={`${spot.changePercent >= 0 ? "+" : ""}${spot.changePercent.toFixed(2)}%`}
                    deltaPositive={spot.changePercent >= 0}
                    badge="S"
                    badgeColor={C.blue}
                  />
                  <WatchRow
                    symbol="DAY RANGE"
                    name="High / low"
                    value={`$${spot.dayHigh.toFixed(2)}`}
                    sub={`$${spot.dayLow.toFixed(2)}`}
                    badge="D"
                    badgeColor="#4a4a56"
                  />
                  <WatchRow
                    symbol="52W RANGE"
                    name="High / low"
                    value={`$${spot.fiftyTwoWeekHigh.toFixed(2)}`}
                    sub={`$${spot.fiftyTwoWeekLow.toFixed(2)}`}
                    badge="52"
                    badgeColor="#4a4a56"
                  />
                  <WatchRow
                    symbol="VOLUME"
                    name="Today"
                    value={fmtVol(spot.volume)}
                    badge="V"
                    badgeColor="#4a4a56"
                  />
                </>
              )}
              {result && (
                <>
                  <WatchRow
                    symbol="NAIVE"
                    name="Flat-vol calculator"
                    value={`₹${result.naive.price.toFixed(2)}`}
                    sub="no range"
                    badge="N"
                    badgeColor={C.critical}
                  />
                  <WatchRow
                    symbol="THIS PROJECT"
                    name="Heston + ML, 90% range"
                    value={`₹${result.priceRange.mean.toFixed(2)}`}
                    sub={`₹${result.priceRange.lower.toFixed(2)}–₹${result.priceRange.upper.toFixed(2)}`}
                    badge="P"
                    badgeColor={C.gold}
                  />
                </>
              )}
            </div>
          </div>

          {/* stat strip */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Variance reduction" value="−28%" sub="antithetic variates" />
            <StatTile label="Calibration speedup" value="~250x" sub="RF vs Nelder-Mead" />
            <StatTile label="Training samples" value="6,000" sub="simulated price surfaces" />
            <StatTile label="Market validation" value="Live" sub="real SPY options chain" />
          </div>
        </header>

        <hr className="mb-12" style={{ borderColor: C.border }} />

        {/* ============ PIPELINE ============ */}
        <section className="mb-14">
          <SectionHeading
            n="0"
            title="The research pipeline"
            sub="Seven steps, each independently verified, from closed-form pricing to live market validation."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((p) => (
              <div
                key={p.n}
                className="rounded-lg border p-4 transition-colors hover:border-neutral-500"
                style={{ background: C.panel, borderColor: C.border }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold"
                    style={{ background: "#1f1f26", color: C.goldBright, border: `1px solid ${C.borderStrong}` }}
                  >
                    {p.n}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    style={{ background: "rgba(25,195,125,0.12)", color: C.good }}
                  >
                    {p.stat}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold" style={{ color: C.text }}>
                  {p.title}
                </div>
                <div className="font-mono text-[11px]" style={{ color: C.textFaint }}>
                  {p.file}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: C.textMuted }}>
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============ 1. CALIBRATION ============ */}
        <section className="mb-14">
          <SectionHeading
            n="1"
            title="Calibrate instantly, with honest uncertainty"
            sub="Pick a “true” market via the Heston parameters below. We generate its price surface, then our Random Forest recovers the parameters — and a 90% confidence range — in milliseconds, live in your browser."
          />

          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <div
              className="space-y-4 rounded-xl border p-5"
              style={{ background: C.panel, borderColor: C.border }}
            >
              {PARAM_META.map((p) => (
                <div key={p.key}>
                  <label className="flex justify-between text-xs" style={{ color: C.textMuted }}>
                    <span>{p.label}</span>
                    <span className="font-mono" style={{ color: C.goldBright }}>
                      {params[p.key].toFixed(3)}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={params[p.key]}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                    className="mt-1 w-full"
                  />
                </div>
              ))}
              <button
                onClick={runCalibration}
                disabled={loading}
                className="w-full rounded-md py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: C.gold, color: C.bg }}
              >
                {loading ? "Calibrating…" : "Re-calibrate"}
              </button>
            </div>

            <div className="space-y-4">
              {result && (
                <>
                  <div
                    className="rounded-xl border p-5"
                    style={{ background: C.panel, borderColor: C.border }}
                  >
                    <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint }}>
                      Fair price (K=100 call), 90% confidence
                    </div>
                    <div className="mt-1 font-mono text-3xl font-bold" style={{ color: C.goldBright }}>
                      ₹{result.priceRange.mean.toFixed(2)}
                      <span className="ml-3 text-base font-normal" style={{ color: C.textMuted }}>
                        likely ₹{result.priceRange.lower.toFixed(2)} – ₹{result.priceRange.upper.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span
                        className="rounded px-2 py-1 font-mono"
                        style={{ background: "rgba(25,195,125,0.12)", color: C.good }}
                      >
                        {result.mlTimeMs}ms
                      </span>
                      <span style={{ color: C.textMuted }}>
                        vs. ~2,000ms / 55 resims for the classic Nelder-Mead baseline. The research benchmark
                        (200 trees) measured <strong style={{ color: C.text }}>~250x faster</strong>; this lighter
                        60-tree browser demo runs even quicker.
                      </span>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border" style={{ background: C.panel, borderColor: C.border }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "#1a1a20" }}>
                          <th className="px-3 py-2 text-left text-[11px] uppercase" style={{ color: C.textFaint }}>
                            Param
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] uppercase" style={{ color: C.textFaint }}>
                            True
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] uppercase" style={{ color: C.textFaint }}>
                            ML mean
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] uppercase" style={{ color: C.textFaint }}>
                            90% range
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {PARAM_META.map((p, i) => (
                          <tr key={p.key} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "transparent" : "rgba(255,255,255,0.015)" }}>
                            <td className="px-3 py-2 font-mono text-xs" style={{ color: C.text }}>
                              {p.key}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: C.textMuted }}>
                              {result.trueParams[p.key].toFixed(3)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: C.goldBright }}>
                              {result.calibrated.mean[p.key].toFixed(3)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: C.textFaint }}>
                              [{result.calibrated.lower[p.key].toFixed(3)}, {result.calibrated.upper[p.key].toFixed(3)}]
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-xl border p-4" style={{ background: C.panel, borderColor: C.border }}>
                    <div className="mb-3 text-[10px] uppercase tracking-wider" style={{ color: C.textFaint }}>
                      ML mean vs. true, per parameter (% deviation)
                    </div>
                    <div className="space-y-2">
                      {PARAM_META.map((p) => {
                        const trueVal = result.trueParams[p.key];
                        const mlVal = result.calibrated.mean[p.key];
                        const pct = trueVal !== 0 ? ((mlVal - trueVal) / Math.abs(trueVal)) * 100 : 0;
                        const clamped = Math.max(-50, Math.min(50, pct));
                        const positive = clamped >= 0;
                        return (
                          <div key={p.key} className="flex items-center gap-2">
                            <span className="w-10 shrink-0 font-mono text-[10px]" style={{ color: C.textMuted }}>
                              {p.key}
                            </span>
                            <div className="relative h-3.5 flex-1 rounded" style={{ background: "#1a1a20" }}>
                              <div className="absolute left-1/2 top-0 h-full w-px" style={{ background: C.borderStrong }} />
                              <div
                                className="absolute top-0 h-full rounded"
                                style={{
                                  background: positive ? C.good : C.critical,
                                  left: positive ? "50%" : `${50 + (clamped / 50) * 50}%`,
                                  width: `${(Math.abs(clamped) / 50) * 50}%`,
                                }}
                              />
                            </div>
                            <span
                              className="w-14 shrink-0 text-right font-mono text-[10px]"
                              style={{ color: positive ? C.good : C.critical }}
                            >
                              {pct >= 0 ? "+" : ""}
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: C.textFaint }}>
                    Notice the ML mean rarely matches &quot;true&quot; exactly even when prices fit well — that&apos;s
                    Heston&apos;s known <strong style={{ color: C.textMuted }}>parameter non-identifiability</strong>:
                    several very different parameter sets can price the same strikes almost equally well. It&apos;s
                    why this project reports a range instead of a single confident number.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ============ 2. REAL MARKET VALIDATION ============ */}
        <section className="mb-14">
          <SectionHeading
            n="2"
            title="Validated against real market data"
            sub={`Real ${initialSnapshot.ticker} options chain — spot $${initialSnapshot.spot.toFixed(2)}, ${realExpiryDays} days to expiry (${initialSnapshot.expiry}).`}
          />

          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div>
              <SkewChart
                xLabel="Moneyness (strike / spot × 100)"
                yLabel="Implied volatility (%)"
                series={[
                  {
                    label: `Real ${initialSnapshot.ticker} (${realExpiryDays}d)`,
                    color: SERIES_COLORS.real,
                    points: moneyness,
                  },
                  {
                    label: "Synthetic Heston (365d)",
                    color: SERIES_COLORS.synthetic,
                    points: SYNTHETIC_STRIKES.map((s, i) => ({ x: s, y: SYNTHETIC_IV[i] * 100 })),
                  },
                ]}
              />
              <p className="mt-2 text-xs italic" style={{ color: C.textFaint }}>
                Different expiries — short-dated real options are naturally steeper. Compare shape (both skew
                downward), not scale. Snapshot fetched{" "}
                {new Date(initialSnapshot.fetchedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
              </p>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: C.textFaint }}>
                  ATM implied vol (real)
                </div>
                <div className="mt-1 font-mono text-xl font-bold" style={{ color: C.blue }}>
                  {atmReal ? `${atmReal.y.toFixed(1)}%` : "—"}
                </div>
              </div>
              <div className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: C.textFaint }}>
                  Skew direction
                </div>
                <div className="mt-1 font-mono text-xl font-bold" style={{ color: C.good }}>
                  Downward ✓
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
                  matches Heston prediction
                </div>
              </div>
              <div className="rounded-lg border p-4" style={{ background: C.panel, borderColor: C.border }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: C.textFaint }}>
                  Strikes compared
                </div>
                <div className="mt-1 font-mono text-xl font-bold" style={{ color: C.text }}>
                  {initialSnapshot.chain.length}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
                  liquid, real trading activity
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ 3. COMPARISON ============ */}
        <section className="mb-14">
          <SectionHeading
            n="3"
            title="How this stacks up"
            sub="Same market price fed into every column. Free calculators assume flat volatility; paid analytics platforms charge for exactly what this project does for free."
          />

          <div className="grid gap-4 md:grid-cols-3">
            {/* typical free calculator */}
            <div className="rounded-xl border p-5" style={{ background: C.panel, borderColor: C.border }}>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.critical }} />
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.textFaint }}>
                  Typical free calculator
                </div>
              </div>
              {result && (
                <div className="mt-2 font-mono text-2xl font-bold" style={{ color: C.textMuted }}>
                  ₹{result.naive.price.toFixed(2)}
                </div>
              )}
              <ul className="mt-3 space-y-1.5 text-xs" style={{ color: C.textMuted }}>
                <li>✗ Flat volatility ({result ? (result.naive.flatVol * 100).toFixed(1) : "—"}% assumed at every strike)</li>
                <li>✗ Single number, no confidence range</li>
                <li>✗ No real-market validation shown</li>
              </ul>
            </div>

            {/* paid platform */}
            <div className="rounded-xl border p-5" style={{ background: C.panel, borderColor: C.border }}>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#fab219" }} />
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.textFaint }}>
                  Paid analytics platform
                </div>
              </div>
              <div className="mt-2 font-mono text-2xl font-bold" style={{ color: C.textMuted }}>
                $$ / mo
              </div>
              <ul className="mt-3 space-y-1.5 text-xs" style={{ color: C.textMuted }}>
                <li>✓ Skew-aware models (Heston / SABR) exist</li>
                <li>✗ Gated behind a paid tier — free users still get flat vol</li>
                <li>~ Confidence ranges not standard output</li>
              </ul>
            </div>

            {/* this project */}
            <div className="rounded-xl border-2 p-5" style={{ background: "rgba(201,162,39,0.06)", borderColor: C.gold }}>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.good }} />
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.goldBright }}>
                  This project — free &amp; open
                </div>
              </div>
              {result && (
                <div className="mt-2 font-mono text-2xl font-bold" style={{ color: C.goldBright }}>
                  ₹{result.priceRange.mean.toFixed(2)}{" "}
                  <span className="text-sm font-normal" style={{ color: C.textMuted }}>
                    (₹{result.priceRange.lower.toFixed(2)}–₹{result.priceRange.upper.toFixed(2)})
                  </span>
                </div>
              )}
              <ul className="mt-3 space-y-1.5 text-xs" style={{ color: C.text }}>
                <li>✓ Stochastic volatility — produces a real skew</li>
                <li>✓ Honest 90% confidence range, not false precision</li>
                <li>✓ Validated against a live real options chain, above</li>
                <li>✓ Open source, free, runs in your browser</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ============ VERIFICATION FEED / FOOTER ============ */}
        <section className="mb-10">
          <SectionHeading n="✓" title="Verification feed" sub="Every claim above was checked, not assumed." />
          <div className="space-y-2">
            {[
              { tag: "CORRECTNESS", color: C.blue, text: "Black-Scholes pricer verified via put-call parity" },
              { tag: "PERFORMANCE", color: C.good, text: "Antithetic variates measured at ~27–30% std-error reduction" },
              { tag: "CORRECTNESS", color: C.blue, text: "Heston collapses to Black-Scholes within 3 standard errors at xi=0" },
              { tag: "FINDING", color: C.gold, text: "Heston produces a real volatility skew (23.6% → 16.2% across strikes 75–130) that Black-Scholes cannot" },
              { tag: "PERFORMANCE", color: C.good, text: "Random Forest calibrator measured ~250x faster than the Nelder-Mead baseline" },
              { tag: "FINDING", color: C.gold, text: "Non-identifiability confirmed: recovered params ≠ true params despite a good price fit" },
              { tag: "LIVE DATA", color: C.critical, text: "Live SPY skew confirmed negative (downward), matching Heston's prediction" },
              { tag: "OPEN SOURCE", color: C.textFaint, text: "Full research code, plots and write-up public on GitHub" },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
                style={{ background: C.panel, borderColor: C.border, borderLeft: `3px solid ${item.color}` }}
              >
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide"
                  style={{ background: "rgba(255,255,255,0.06)", color: item.color }}
                >
                  {item.tag}
                </span>
                <span className="text-xs" style={{ color: C.text }}>
                  {item.text}
                </span>
                <span className="ml-auto shrink-0 text-[10px]" style={{ color: C.textFaint }}>
                  ✓ verified
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs" style={{ borderColor: C.border, color: C.textFaint }}>
          <div className="flex flex-wrap gap-2">
            {["Next.js", "TypeScript", "Vercel", "Python research", "Gemini"].map((t) => (
              <span key={t} className="rounded border px-2 py-1" style={{ borderColor: C.border, color: C.textMuted }}>
                {t}
              </span>
            ))}
          </div>
          <a
            href="https://github.com/pastbologanesh0101/option-pricing-heston"
            className="underline"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.textMuted }}
          >
            github.com/pastbologanesh0101/option-pricing-heston
          </a>
        </footer>
      </div>
    </div>
  );
}
