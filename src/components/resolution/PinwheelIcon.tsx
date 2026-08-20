type Props = { size?: number; className?: string; strokeWidth?: number };

/** Approximates the Commas "in review" processing glyph — a radiating-dash burst. Ported from commas-ai-copilot. */
export function PinwheelIcon({ size = 16, className }: Props) {
  const dashes = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <g stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
        {dashes.map((deg) => (
          <line key={deg} x1="8" y1="2" x2="8" y2="4.4" transform={`rotate(${deg} 8 8)`} />
        ))}
      </g>
    </svg>
  );
}
