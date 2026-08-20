type Props = {
  size?: number;
  color?: string;
};

/** Stylized comma glyph used for the Commas logo tile and org avatar. Ported from commas-ai-copilot. */
export function CommaMark({ size = 20, color = "#5B9BF7" }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M20.2 9.2c3 0 5 2.3 5 5.6 0 5.3-3.6 9.4-8.7 10.6l-1-2.4c3.2-.9 5.1-2.8 5.6-5.2-.4.1-.8.2-1.3.2-2.7 0-4.7-2-4.7-4.6 0-2.6 2-4.2 5.1-4.2Z"
        fill={color}
      />
    </svg>
  );
}
