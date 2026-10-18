import type { Block, Theme } from "@carddeck/core";
import { blockStyle } from "./shared";

type Chart = Extract<Block, { type: "chart" }>;

/**
 * A chart block rendered with plain DOM (no charting library): an accessible
 * legend naming each series plus a lightweight SVG/CSS plot colored entirely
 * from theme tokens.
 */
export function ChartBlock({ block, theme }: { block: Chart; theme?: Theme }) {
  const { labels, series } = block.data;
  const max = Math.max(1, ...series.flatMap((s) => s.values));

  return (
    <figure data-block="chart" className={`chart chart-${block.kind}`} style={blockStyle(theme)}>
      <figcaption className="chart-legend">
        {series.map((s) => (
          <span className="chart-legend-item" key={s.name}>
            <span className="chart-swatch" aria-hidden="true" />
            <span className="chart-series-name">{s.name}</span>
            <span className="chart-values">{s.values.join(" · ")}</span>
          </span>
        ))}
      </figcaption>
      <div
        className="chart-plot"
        role="img"
        aria-label={`${block.kind} chart: ${series.map((s) => s.name).join(", ")}`}
      >
        {block.kind === "bar" ? (
          <div className="chart-bars">
            {labels.map((label, i) => (
              <div className="chart-bar-col" key={`${label}-${i}`} title={label}>
                <div
                  className="chart-bar"
                  style={{ height: `${Math.round(((series[0]?.values[i] ?? 0) / max) * 100)}%` }}
                />
                <span className="chart-x">{label}</span>
              </div>
            ))}
          </div>
        ) : null}

        {block.kind === "line" ? (
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="chart-svg" aria-hidden="true">
            <polyline
              className="chart-line"
              fill="none"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              points={linePoints(series[0]?.values ?? [], max)}
            />
          </svg>
        ) : null}

        {block.kind === "donut" ? <DonutSvg series={series} /> : null}
      </div>
    </figure>
  );
}

/** Scale values into a 0..100 x 0..40 polyline. */
function linePoints(values: number[], max: number): string {
  if (values.length === 0) return "";
  const step = values.length === 1 ? 0 : 100 / (values.length - 1);
  return values.map((v, i) => `${(i * step).toFixed(2)},${(40 - (v / max) * 40).toFixed(2)}`).join(" ");
}

function DonutSvg({ series }: { series: Chart["data"]["series"] }) {
  const values = series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 40 40" className="chart-donut" aria-hidden="true">
      <circle cx="20" cy="20" r={radius} className="chart-donut-track" />
      {values.map((v, i) => {
        const length = (v / total) * circumference;
        const dash = `${length} ${circumference - length}`;
        const rotate = `rotate(${-90 + (offset / circumference) * 360} 20 20)`;
        offset += length;
        return (
          <circle
            key={i}
            cx="20"
            cy="20"
            r={radius}
            className="chart-donut-slice"
            strokeDasharray={dash}
            transform={rotate}
          />
        );
      })}
    </svg>
  );
}
