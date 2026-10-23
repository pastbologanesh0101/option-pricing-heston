"use client";

// Intraday price sparkline, colored by day direction — same visual grammar
// as TradingView's hero chart (red when down on the day, green when up),
// filled gradient under the line.
export function Sparkline({
  points,
  width = 760,
  height = 220,
  positive,
}: {
  points: { t: number; price: number }[];
  width?: number;
  height?: number;
  positive: boolean;
}) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: "#6b6b76" }}
      >
        Waiting for intraday data…
      </div>
    );
  }

  const color = positive ? "#19c37d" : "#e5484d";
  const margin = { top: 12, right: 8, bottom: 24, left: 8 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const prices = points.map((p) => p.price);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const pad = (pMax - pMin) * 0.1 || 1;

  const xScale = (i: number) => (i / (points.length - 1)) * innerW;
  const yScale = (v: number) => innerH - ((v - (pMin - pad)) / (pMax - pMin + 2 * pad || 1)) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(p.price)}`).join(" ");
  const areaPath = `${linePath} L ${xScale(points.length - 1)} ${innerH} L 0 ${innerH} Z`;

  const firstT = new Date(points[0].t * 1000);
  const lastT = new Date(points[points.length - 1].t * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Intraday price chart">
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={innerW} y1={innerH * f} y2={innerH * f} stroke="#1f1f27" strokeWidth={1} />
        ))}
        <path d={areaPath} fill="url(#sparkFill)" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={xScale(points.length - 1)}
          cy={yScale(points[points.length - 1].price)}
          r={3.5}
          fill={color}
        />
        <text x={0} y={innerH + 18} fontSize={11} fill="#6b6b76">
          {fmt(firstT)}
        </text>
        <text x={innerW} y={innerH + 18} fontSize={11} fill="#6b6b76" textAnchor="end">
          {fmt(lastT)}
        </text>
      </g>
    </svg>
  );
}
