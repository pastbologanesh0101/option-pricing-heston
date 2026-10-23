"use client";

import { useId, useState } from "react";

export interface SkewSeriesPoint {
  x: number;
  y: number | null;
}

export interface SkewSeries {
  label: string;
  color: string;
  points: SkewSeriesPoint[];
}

// Validated categorical pair (dataviz skill, slots 1 & 2), dark-surface
// steps: blue #3987e5, orange #d95926 — passes CVD/contrast checks against
// the dark surface #1a1a19 used below.
export const SERIES_COLORS = { real: "#3987e5", synthetic: "#d95926" };
const SURFACE = "#141419";
const GRID = "#2a2a33";
const AXIS_TEXT = "#8a8a94";
const LABEL_TEXT = "#c7c7ce";

export function SkewChart({
  series,
  width = 640,
  height = 340,
  xLabel,
  yLabel,
}: {
  series: SkewSeries[];
  width?: number;
  height?: number;
  xLabel: string;
  yLabel: string;
}) {
  const gradId = useId();
  const [hover, setHover] = useState<{ sIdx: number; pIdx: number } | null>(null);

  const margin = { top: 20, right: 20, bottom: 40, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const allPoints = series.flatMap((s) => s.points.filter((p) => p.y !== null));
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y as number);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) * 0.95;
  const yMax = Math.max(...ys) * 1.05;

  const xScale = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const yScale = (y: number) => innerH - ((y - yMin) / (yMax - yMin || 1)) * innerH;

  const yTicks = 5;
  const xTicks = 5;

  return (
    <div className="w-full rounded-xl border p-4" style={{ background: SURFACE, borderColor: GRID }}>
      <div className="mb-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-sm" style={{ color: LABEL_TEXT }}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${yLabel} vs ${xLabel}`}
      >
        <defs>
          <clipPath id={gradId}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* gridlines */}
          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const v = yMin + (i / yTicks) * (yMax - yMin);
            const y = yScale(v);
            return (
              <g key={i}>
                <line x1={0} x2={innerW} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={-8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={AXIS_TEXT}>
                  {v.toFixed(1)}
                </text>
              </g>
            );
          })}
          {Array.from({ length: xTicks + 1 }).map((_, i) => {
            const v = xMin + (i / xTicks) * (xMax - xMin);
            const x = xScale(v);
            return (
              <text key={i} x={x} y={innerH + 20} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                {v.toFixed(0)}
              </text>
            );
          })}

          {/* series lines */}
          <g clipPath={`url(#${gradId})`}>
            {series.map((s, sIdx) => {
              const pts = s.points.filter((p) => p.y !== null) as { x: number; y: number }[];
              const d = pts
                .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.y)}`)
                .join(" ");
              return (
                <g key={s.label}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" />
                  {pts.map((p, pIdx) => (
                    <circle
                      key={pIdx}
                      cx={xScale(p.x)}
                      cy={yScale(p.y)}
                      r={hover?.sIdx === sIdx && hover?.pIdx === pIdx ? 5 : 3}
                      fill={s.color}
                      stroke={SURFACE}
                      strokeWidth={1.5}
                      onMouseEnter={() => setHover({ sIdx, pIdx })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{`${s.label}: x=${p.x}, y=${p.y.toFixed(2)}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </g>

          {/* axis labels */}
          <text
            x={-innerH / 2}
            y={-38}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize={12}
            fill={LABEL_TEXT}
          >
            {yLabel}
          </text>
          <text x={innerW / 2} y={innerH + 36} textAnchor="middle" fontSize={12} fill={LABEL_TEXT}>
            {xLabel}
          </text>
        </g>
      </svg>
    </div>
  );
}
