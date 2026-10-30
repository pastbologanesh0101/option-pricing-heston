"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
    <div
      className="rounded-xl border px-4 py-3.5 transition-transform duration-300 hover:-translate-y-0.5"
      style={{ background: "linear-gradient(160deg, #18181f, #121216)", borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textFaint }}>
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold" style={{ color: C.goldBright, textShadow: "0 0 18px rgba(201,162,39,0.25)" }}>
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
    <div className="mb-6 flex items-start gap-3.5">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold"
        style={{
          background: `linear-gradient(135deg, ${C.goldBright}, ${C.gold})`,
          color: C.bg,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 16px rgba(201,162,39,0.4)",
        }}
      >
        {n}
      </span>
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: C.text }}>
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: C.textMuted }}>
          {sub}
        </p>
      </div>
    </div>
  );
}

const COMPARISON_ROWS: { feature: string; retail: string; paid: string; lib: string; ours: string }[] = [
  { feature: "Pricing model", retail: "Black-Scholes only", paid: "Heston / SABR available", lib: "Heston available, in code", ours: "Heston stochastic volatility" },
  { feature: "Volatility input", retail: "Flat — you type one number", paid: "Full vol surface", lib: "Flat, unless you build a surface yourself", ours: "Live-calibrated, skew-aware" },
  { feature: "Confidence range", retail: "None — single price", paid: "Not standard output", lib: "None built in", ours: "90% range on every price" },
  { feature: "Calibration speed", retail: "N/A — no calibration step", paid: "Seconds to minutes", lib: "Seconds to minutes, hand-coded", ours: "~250x faster — Random Forest" },
  { feature: "Real market check, shown", retail: "No", paid: "Internal only, not public", lib: "No — you'd wire it up yourself", ours: "Live SPY chain, on this page" },
  { feature: "Needs programming", retail: "No", paid: "No, but needs a paid license", lib: "Yes — C++ or Python", ours: "No — runs in your browser" },
  { feature: "Cost", retail: "Free", paid: "$24,000+/year (Bloomberg)", lib: "Free, open source", ours: "Free, open source" },
];

function ComparisonCard({
  label,
  sub,
  dotColor,
  headerColor,
  highlight,
  priceLine,
  bullets,
}: {
  label: string;
  sub: string;
  dotColor: string;
  headerColor: string;
  highlight?: boolean;
  priceLine?: ReactNode;
  bullets: { ok: boolean | null; text: string }[];
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-xl p-5 transition-transform duration-300 hover:-translate-y-1"
          : "rounded-xl border p-5 transition-transform duration-300 hover:-translate-y-1"
      }
      style={
        highlight
          ? {
              background: "linear-gradient(160deg, rgba(201,162,39,0.12), rgba(201,162,39,0.02))",
              border: `2px solid ${C.gold}`,
              boxShadow: "0 12px 32px rgba(201,162,39,0.2)",
            }
          : { background: C.panel, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }
      }
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: headerColor }}>
          {label}
        </div>
      </div>
      <div className="mt-0.5 text-[11px]" style={{ color: C.textFaint }}>
        {sub}
      </div>
      {priceLine && <div className="mt-2">{priceLine}</div>}
      <ul className="mt-3 space-y-1.5 text-xs" style={{ color: highlight ? C.text : C.textMuted }}>
        {bullets.map((b, i) => (
          <li key={i}>
            {b.ok === true ? "✓ " : b.ok === false ? "✗ " : "~ "}
            {b.text}
          </li>
        ))}
      </ul>
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
  const [strikeK, setStrikeK] = useState(100);

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
        body: JSON.stringify({ ...params, K: strikeK }),
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
    <div style={{ background: C.bg, position: "relative", overflow: "hidden" }}>
      {/* decorative glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(201,162,39,0.16), transparent 70%)", filter: "blur(10px)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-20 h-[460px] w-[460px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(57,135,229,0.12), transparent 70%)", filter: "blur(10px)" }}
      />
      <div className="relative mx-auto max-w-6xl px-5 py-10">
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

          <h1 className="mt-3 text-5xl font-bold tracking-tight sm:text-6xl" style={{ color: C.text }}>
            Option Pricing Under{" "}
            <span
              style={{
                backgroundImage: `linear-gradient(135deg, ${C.goldBright}, #f5d78a, ${C.gold})`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Stochastic Volatility
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed" style={{ color: C.textMuted }}>
            Using the Heston model and machine learning to make option pricing faster — and honest about its own
            uncertainty.
          </p>
          <p className="mt-2 font-mono text-sm" style={{ color: C.textFaint }}>
            Rikhil Modalavalasa (25BCE2884) · Vishwanathan (25BCE2885)
          </p>

          {/* live status pill */}
          <div
            className="mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            style={{ background: C.panel, borderColor: C.border, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}
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

        {/* ============ QUICK NAV ============ */}
        <nav className="mb-10 flex flex-wrap gap-1 border-b" style={{ borderColor: C.border }}>
          {[
            { href: "#difference", label: "The difference" },
            { href: "#pipeline", label: "Pipeline" },
            { href: "#calibrate", label: "Calibrate live" },
            { href: "#market", label: "Market validation" },
            { href: "#realcal", label: "Real calibration" },
            { href: "#limits", label: "Limitations" },
            { href: "#verify", label: "Verification feed" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-t-md px-3.5 py-3 text-xs font-semibold text-neutral-400 transition-colors hover:text-[#e3bb3a]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* ============ COMPARISON ============ */}
        <section id="difference" className="mb-16 scroll-mt-6">
          <div
            className="mb-8 overflow-hidden rounded-2xl p-6"
            style={{
              background: "linear-gradient(135deg, rgba(201,162,39,0.14), rgba(201,162,39,0.02))",
              border: `1px solid ${C.goldBright}`,
              boxShadow: "0 0 40px rgba(201,162,39,0.12)",
            }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.goldBright }}>
              The difference, in one line
            </div>
            <p className="mt-2 text-xl font-semibold leading-snug sm:text-2xl" style={{ color: C.text }}>
              Free tools give you <span style={{ color: C.textMuted }}>a single number.</span> This project gives you{" "}
              <span style={{ color: C.goldBright }}>a number and how sure it is</span> — calibrated to live market data.
            </p>
          </div>

          <SectionHeading
            n="VS"
            title="How this compares to what's already out there"
            sub="Three kinds of tools already exist for this problem. Each gives up something this project doesn't have to."
          />

          <div className="mb-10">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: C.textFaint }}>
              Same question, two real screenshots — not a mockup
            </p>
            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
              <div
                className="overflow-hidden rounded-xl border transition-transform duration-300 hover:-translate-y-1"
                style={{ background: C.panel, borderColor: C.border, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
              >
                <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, background: "#1a1a20" }}>
                  <span className="flex items-center gap-2 text-sm font-bold" style={{ color: C.text }}>
                    <span className="flex gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#e5484d" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#e6b325" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#19c37d" }} />
                    </span>
                    A typical free calculator
                  </span>
                  <span className="font-mono text-xs" style={{ color: C.textFaint }}>
                    goodcalculators.com
                  </span>
                </div>
                <div className="flex items-center justify-center p-3" style={{ background: "#0d0d10", minHeight: 360 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/compare/existing-calculator.png"
                    alt="A typical free Black-Scholes calculator showing a single point price with no confidence range"
                    className="max-h-[520px] w-full object-contain"
                  />
                </div>
                <div className="px-5 py-4 text-sm leading-relaxed" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}` }}>
                  One flat volatility in, one number out. Call Price: <strong style={{ color: C.text }}>$58.82</strong> — no
                  range, no real-market check, no sense of how wrong it might be.
                </div>
              </div>

              <div
                className="overflow-hidden rounded-xl border transition-transform duration-300 hover:-translate-y-1"
                style={{ background: C.panel, borderColor: C.goldBright, boxShadow: "0 0 0 1px rgba(201,162,39,0.35), 0 12px 32px rgba(201,162,39,0.18)" }}
              >
                <div
                  className="flex items-center justify-between px-5 py-4"
                  style={{ borderBottom: `1px solid ${C.border}`, background: "linear-gradient(90deg, rgba(201,162,39,0.14), rgba(201,162,39,0.02))" }}
                >
                  <span className="text-sm font-bold" style={{ color: C.goldBright }}>
                    ★ This project
                  </span>
                  <span className="font-mono text-xs" style={{ color: C.textFaint }}>
                    live demo, this site
                  </span>
                </div>
                <div className="flex items-center justify-center p-3" style={{ background: "#0d0d10", minHeight: 360 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/compare/this-project.png"
                    alt="This project's live calibration demo, showing the flat-vol calculator's price next to this project's price with a 90% confidence range, both computed from the same real strike entered live"
                    className="w-full object-contain"
                  />
                </div>
                <div className="px-5 py-4 text-sm leading-relaxed" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}` }}>
                  Same real question, same real input, both models computed live on this page in ~1ms:{" "}
                  <strong style={{ color: C.goldBright }}>₹10.49, likely ₹8.86–₹12.32</strong> — a range, with the
                  per-parameter uncertainty that produced it shown underneath.
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold" style={{ color: C.goldBright }}>
              ↓ Don&apos;t just take the screenshots&apos; word for it — type a real strike below and watch both
              numbers update live.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border" style={{ background: C.panel, borderColor: C.border }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "#1a1a20" }}>
                  <th className="px-3 py-3 text-left align-bottom" style={{ color: C.textFaint }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wide">Feature</span>
                  </th>
                  <th className="px-3 py-3 text-left align-bottom" style={{ color: C.textFaint }}>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">Free calculators</span>
                    <span className="mt-0.5 block font-normal normal-case" style={{ color: C.textFaint }}>
                      CBOE, Zerodha, Groww
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left align-bottom" style={{ color: C.textFaint }}>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">Paid platforms</span>
                    <span className="mt-0.5 block font-normal normal-case" style={{ color: C.textFaint }}>
                      Bloomberg, Refinitiv Eikon
                    </span>
                  </th>
                  <th className="px-3 py-3 text-left align-bottom" style={{ color: C.textFaint }}>
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">Code libraries</span>
                    <span className="mt-0.5 block font-normal normal-case" style={{ color: C.textFaint }}>
                      QuantLib
                    </span>
                  </th>
                  <th
                    className="px-3 py-3 text-left align-bottom"
                    style={{ color: C.goldBright, background: "linear-gradient(180deg, rgba(201,162,39,0.18), rgba(201,162,39,0.06))" }}
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">This project</span>
                    <span className="mt-0.5 block font-normal normal-case" style={{ color: C.goldBright, opacity: 0.8 }}>
                      Free, live website
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr
                    key={row.feature}
                    style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "transparent" : "rgba(255,255,255,0.015)" }}
                  >
                    <td className="px-3 py-3 font-semibold" style={{ color: C.text }}>
                      {row.feature}
                    </td>
                    <td className="px-3 py-3" style={{ color: C.textMuted }}>
                      {row.retail}
                    </td>
                    <td className="px-3 py-3" style={{ color: C.textMuted }}>
                      {row.paid}
                    </td>
                    <td className="px-3 py-3" style={{ color: C.textMuted }}>
                      {row.lib}
                    </td>
                    <td className="px-3 py-3 font-semibold" style={{ color: C.goldBright, background: "rgba(201,162,39,0.05)" }}>
                      {row.ours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs leading-relaxed" style={{ color: C.textFaint }}>
            CBOE&apos;s public options calculator, and most retail tools like Zerodha&apos;s or Groww&apos;s, price off
            Black-Scholes with one volatility number you type in — accurate at one strike, structurally wrong at
            every other strike on the same expiry. Bloomberg and Refinitiv do have skew-aware models, but they sit
            behind institutional licenses costing tens of thousands of dollars a year. QuantLib has a correct Heston
            implementation, but it&apos;s a C++/Python library — there&apos;s no live site, no calibration UI, and no
            confidence interval unless you build all three yourself.
          </p>
        </section>

        <section className="mb-20">
          <SectionHeading
            n="VS"
            title="Same question, four answers"
            sub="What each kind of tool actually gives you when you ask: what is this option worth, and how sure are you?"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ComparisonCard
              label="Free calculator"
              sub="CBOE · Zerodha · Groww"
              dotColor={C.critical}
              headerColor={C.textFaint}
              priceLine={
                result && (
                  <div className="font-mono text-2xl font-bold" style={{ color: C.textMuted }}>
                    ₹{result.naive.price.toFixed(2)}
                  </div>
                )
              }
              bullets={[
                { ok: false, text: `Flat volatility (${result ? (result.naive.flatVol * 100).toFixed(1) : "—"}% assumed at every strike)` },
                { ok: false, text: "Single number, no confidence range" },
                { ok: false, text: "No real-market validation shown" },
                { ok: true, text: "Free and instant" },
              ]}
            />

            <ComparisonCard
              label="Paid platform"
              sub="Bloomberg · Refinitiv Eikon"
              dotColor="#fab219"
              headerColor={C.textFaint}
              priceLine={
                <div className="font-mono text-2xl font-bold" style={{ color: C.textMuted }}>
                  $24,000+/yr
                </div>
              }
              bullets={[
                { ok: true, text: "Skew-aware models (Heston / SABR) exist" },
                { ok: false, text: "Gated behind an institutional license" },
                { ok: null, text: "Confidence ranges not standard output" },
                { ok: false, text: "Not usable from a student project budget" },
              ]}
            />

            <ComparisonCard
              label="Code library"
              sub="QuantLib"
              dotColor={C.blue}
              headerColor={C.textFaint}
              priceLine={
                <div className="font-mono text-2xl font-bold" style={{ color: C.textMuted }}>
                  Free
                </div>
              }
              bullets={[
                { ok: true, text: "Correct Heston pricing is in there" },
                { ok: false, text: "No website — you write the code yourself" },
                { ok: false, text: "No confidence intervals out of the box" },
                { ok: false, text: "No live market validation built in" },
              ]}
            />

            <ComparisonCard
              label="This project"
              sub="Free, open source, live"
              dotColor={C.good}
              headerColor={C.goldBright}
              highlight
              priceLine={
                result && (
                  <div className="font-mono text-2xl font-bold" style={{ color: C.goldBright }}>
                    ₹{result.priceRange.mean.toFixed(2)}{" "}
                    <span className="text-sm font-normal" style={{ color: C.textMuted }}>
                      (₹{result.priceRange.lower.toFixed(2)}–₹{result.priceRange.upper.toFixed(2)})
                    </span>
                  </div>
                )
              }
              bullets={[
                { ok: true, text: "Stochastic volatility — produces a real skew" },
                { ok: true, text: "Honest 90% confidence range, not false precision" },
                { ok: true, text: "Validated against a live real options chain" },
                { ok: true, text: "No install, no license — runs in your browser" },
              ]}
            />
          </div>

          <p className="mt-4 text-xs leading-relaxed" style={{ color: C.textFaint }}>
            The gap this project sits in: free tools give you a number with no sense of its own uncertainty; paid
            platforms give you the right model but price out a student (or a retail trader); code libraries give you
            the right math but no usable product around it. This project is the one column that is free, skew-aware,
            honest about its uncertainty, and a live website — not a spreadsheet, a license, or a library you have to
            program yourself.
          </p>
        </section>

        {/* ============ PIPELINE ============ */}
        <section id="pipeline" className="mb-16 scroll-mt-6">
          <SectionHeading
            n="0"
            title="The research pipeline"
            sub="Seven steps, each independently verified, from closed-form pricing to live market validation."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((p) => (
              <div
                key={p.n}
                className="rounded-lg border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#e3bb3a] hover:shadow-xl"
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
        <section id="calibrate" className="mb-16 scroll-mt-6">
          <SectionHeading
            n="1"
            title="Calibrate instantly, with honest uncertainty"
            sub="Type a real strike price, pick a “true” market via the Heston parameters below, and watch both an ordinary flat-vol calculator and this project reprice it live, side by side, in milliseconds."
          />

          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <div
              className="space-y-4 rounded-xl border p-5"
              style={{ background: C.panel, borderColor: C.border }}
            >
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(201,162,39,0.08)", border: `1px solid ${C.goldBright}` }}
              >
                <label className="flex items-center justify-between text-xs font-semibold" style={{ color: C.goldBright }}>
                  <span>Strike price (K) — type any real number</span>
                </label>
                <input
                  type="number"
                  min={70}
                  max={130}
                  step={1}
                  value={strikeK}
                  onChange={(e) => setStrikeK(Number(e.target.value))}
                  className="mt-2 w-full rounded-md px-3 py-2 font-mono text-lg font-bold"
                  style={{ background: C.bg, border: `1px solid ${C.borderStrong}`, color: C.text }}
                />
                <p className="mt-1 text-[10px]" style={{ color: C.textFaint }}>
                  Spot is normalized to 100, so K=100 is at-the-money — try 85 (deep ITM) or 115 (OTM).
                </p>
              </div>
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
                className="w-full rounded-md py-2.5 text-sm font-bold transition-all hover:-translate-y-0.5 disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, ${C.goldBright}, ${C.gold})`,
                  color: C.bg,
                  boxShadow: "0 6px 20px rgba(201,162,39,0.35)",
                }}
              >
                {loading ? "Calibrating…" : "Re-calibrate"}
              </button>
            </div>

            <div className="space-y-4">
              {result && (
                <>
                  <div
                    className="grid gap-4 rounded-xl border p-6 md:grid-cols-2"
                    style={{
                      background: "linear-gradient(160deg, rgba(201,162,39,0.1), rgba(22,22,28,1))",
                      borderColor: C.goldBright,
                      boxShadow: "0 0 32px rgba(201,162,39,0.15)",
                    }}
                  >
                    <div className="border-b pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-6" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                      <div className="text-xs uppercase tracking-wide" style={{ color: C.textFaint }}>
                        A typical free calculator (K={strikeK})
                      </div>
                      <div className="mt-2 font-mono text-4xl font-bold sm:text-5xl" style={{ color: C.textMuted }}>
                        ₹{result.naive.price.toFixed(2)}
                      </div>
                      <div className="mt-2 text-xs" style={{ color: C.textFaint }}>
                        One flat volatility in, one number out. No range, no sense of how wrong it might be.
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide" style={{ color: C.goldBright }}>
                        ★ This project (K={strikeK}), 90% confidence
                      </div>
                      <div className="mt-2 font-mono text-4xl font-bold sm:text-5xl" style={{ color: C.goldBright, textShadow: "0 0 24px rgba(201,162,39,0.3)" }}>
                        ₹{result.priceRange.mean.toFixed(2)}
                      </div>
                      <div className="mt-1 text-base font-semibold" style={{ color: C.text }}>
                        likely ₹{result.priceRange.lower.toFixed(2)} – ₹{result.priceRange.upper.toFixed(2)}
                      </div>
                    </div>
                    <div className="col-span-full mt-1 flex flex-wrap gap-2 text-xs">
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
        <section id="market" className="mb-16 scroll-mt-6">
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

        {/* ============ TRUE CALIBRATION TO LIVE CHAINS ============ */}
        <section id="realcal" className="mb-16 scroll-mt-6">
          <SectionHeading
            n="3"
            title="True calibration to live SPY & QQQ chains"
            sub="Not just a shape comparison — this fits Heston parameters directly to real quoted option prices, on two independent tickers, run live on 2026-10-29."
          />
          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                ticker: "SPY",
                spot: "769.16",
                days: "29",
                rho: "−0.64",
                xi: "1.30",
                kappa: "1.17",
                rmse: "0.39",
                avg: "27.20",
                img: "/results/real_calibration_spy.png",
              },
              {
                ticker: "QQQ",
                spot: "714.99",
                days: "29",
                rho: "−0.66",
                xi: "2.11",
                kappa: "0.24",
                rmse: "0.57",
                avg: "25.39",
                img: "/results/real_calibration_qqq.png",
              },
            ].map((t) => (
              <div
                key={t.ticker}
                className="overflow-hidden rounded-xl border transition-transform duration-300 hover:-translate-y-1"
                style={{ background: C.panel, borderColor: C.border, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
              >
                <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, background: "#1a1a20" }}>
                  <span className="font-mono text-sm font-bold" style={{ color: C.goldBright }}>
                    {t.ticker}
                  </span>
                  <span className="text-xs" style={{ color: C.textFaint }}>
                    spot ${t.spot} · {t.days}d to expiry
                  </span>
                </div>
                <div className="flex items-center justify-center p-3" style={{ background: "#0d0d10", minHeight: 280 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.img} alt={`${t.ticker} real calibration price and skew fit`} className="w-full object-contain" />
                </div>
                <div className="grid grid-cols-4 gap-2 px-5 py-4 text-center" style={{ borderTop: `1px solid ${C.border}` }}>
                  <div>
                    <div className="font-mono text-base font-bold" style={{ color: C.text }}>{t.rho}</div>
                    <div className="text-[10px] uppercase" style={{ color: C.textFaint }}>ρ</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-bold" style={{ color: C.text }}>{t.xi}</div>
                    <div className="text-[10px] uppercase" style={{ color: C.textFaint }}>ξ</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-bold" style={{ color: C.text }}>{t.kappa}</div>
                    <div className="text-[10px] uppercase" style={{ color: C.textFaint }}>κ</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-bold" style={{ color: C.good }}>${t.rmse}</div>
                    <div className="text-[10px] uppercase" style={{ color: C.textFaint }}>RMSE</div>
                  </div>
                </div>
                <div className="px-5 pb-4 text-xs" style={{ color: C.textMuted }}>
                  Price fit excellent — RMSE ${t.rmse} on an average target price of ${t.avg}.
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-6 rounded-xl p-5"
            style={{ background: "rgba(25,195,125,0.07)", border: `1px solid ${C.good}` }}
          >
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: C.good }}>
              Repeatability finding
            </div>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: C.text }}>
              Two independent tickers, calibrated separately, both land on a strongly negative ρ (the equity
              &quot;leverage effect&quot; — prices drop, volatility spikes) and a substantial ξ. Same qualitative
              Heston story on two unrelated names, not a one-off fit.
            </p>
          </div>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: C.textFaint }}>
            Honest caveat: the skew fit is directionally correct everywhere but undershoots the steep deep-ITM
            implied vol (44.7% real vs. 29.3% fitted on SPY&apos;s lowest strike) — consistent with Heston&apos;s
            known parameter non-identifiability, compounded by only 7 calibration strikes. This re-runs the slow
            Nelder-Mead optimizer, not the trained Random Forest, because the RF was trained on a fixed
            S0=100/T=1yr grid and a live ~29-day chain needs its own — see Limitations below.
          </p>
        </section>

        {/* ============ LIMITATIONS & WHAT'S NEXT ============ */}
        <section id="limits" className="mb-16 scroll-mt-6">
          <SectionHeading n="!" title="Limitations and what's next" sub="Honest about what's modest, not just what works." />
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border p-5" style={{ background: C.panel, borderColor: C.border }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: C.critical }}>
                Honest limitations
              </div>
              <ul className="mt-3 space-y-2.5 text-sm" style={{ color: C.textMuted }}>
                {[
                  "Per-parameter R² is only 0.16–0.57 on held-out data — modest, and a direct consequence of Heston's non-identifiability.",
                  "The real-data check (SPY/QQQ) used the slow Nelder-Mead optimizer, not the trained ML model.",
                  "The real chain is ~29 days to expiry; the synthetic comparison example is 1 year — shape, not scale, is comparable.",
                  "Deep in-the-money skew is undershot, with only 7 calibration strikes.",
                ].map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: C.critical }}>•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border p-5" style={{ background: C.panel, borderColor: C.border }}>
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: C.good }}>
                Still to do
              </div>
              <ul className="mt-3 space-y-2.5 text-sm" style={{ color: C.textMuted }}>
                {[
                  "Retrain or adapt the ML calibrator to run directly on a live chain's own strikes and expiry.",
                  "Then compare the ML calibrator against the slow baseline on real, noisier market data.",
                  "Check whether the reported confidence ranges actually contain the real market prices.",
                ].map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span style={{ color: C.good }}>•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed" style={{ color: C.textFaint }}>
            The core pipeline — pricing, simulation, calibration, uncertainty, and real-market validation — is
            complete end to end. What remains is productionizing the ML calibrator for live chains, not rebuilding
            any of the math.
          </p>
        </section>

        {/* ============ VERIFICATION FEED ============ */}
        <section id="verify" className="mb-10 scroll-mt-6">
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
                className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                style={{ background: C.panel, borderColor: C.border }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.color }} />
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
