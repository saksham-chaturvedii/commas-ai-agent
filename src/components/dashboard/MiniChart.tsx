/**
 * Hand-rolled SVG sparkline — no charting library, matches production's minimal empty/near-flat
 * line style (docs/references/Screenshot 2026-08-21 at 4.27.2*.png): faint horizontal gridlines,
 * a single stroked line, and a filled dot at the last point.
 */
export function MiniChart({
  points,
  height = 96,
  xLabels,
  dashed = false,
}: {
  /** 0–1 normalized values, left to right. */
  points: number[];
  height?: number;
  xLabels: [string, string];
  /** Flat/near-zero series render as a dashed muted line, matching production's empty state. */
  dashed?: boolean;
}) {
  const width = 600;
  const gridLines = 5;
  const pad = 4;
  const usableH = height - pad * 2;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => [i * step, pad + usableH * (1 - p)] as const);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {Array.from({ length: gridLines }).map((_, i) => {
          const y = pad + (usableH / (gridLines - 1)) * i;
          return <line key={i} x1={0} y1={y} x2={width} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth={1} />;
        })}
        <path
          d={path}
          fill="none"
          stroke={dashed ? "#93a3b8" : "var(--color-primary)"}
          strokeWidth={2}
          strokeDasharray={dashed ? "4 4" : undefined}
        />
        <circle cx={lastX} cy={lastY} r={4} fill={dashed ? "#93a3b8" : "var(--color-primary)"} />
      </svg>
      <div className="flex items-center justify-between text-[12px] text-[#9ca3af] mt-1">
        <span>{xLabels[0]}</span>
        <span>{xLabels[1]}</span>
      </div>
    </div>
  );
}
