type Props = {
  size?: number;
};

/**
 * Distinct mark for AI/agent surfaces — deliberately different from CommaMark so the
 * agent reads as "a capability inside Commas" rather than the Commas brand itself,
 * echoing how Notion AI's mark differs from the Notion logo.
 */
export function AgentMark({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5c.35 0 .66.22.77.55l1.6 4.63a5.6 5.6 0 0 0 3.45 3.45l4.63 1.6a.82.82 0 0 1 0 1.54l-4.63 1.6a5.6 5.6 0 0 0-3.45 3.45l-1.6 4.63a.82.82 0 0 1-1.54 0l-1.6-4.63a5.6 5.6 0 0 0-3.45-3.45l-4.63-1.6a.82.82 0 0 1 0-1.54l4.63-1.6a5.6 5.6 0 0 0 3.45-3.45l1.6-4.63A.82.82 0 0 1 12 2.5Z"
        fill="url(#agent-mark-gradient)"
      />
      <defs>
        <linearGradient id="agent-mark-gradient" x1="2" y1="2.5" x2="22" y2="21.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9E86FF" />
          <stop offset="1" stopColor="#5B9BF7" />
        </linearGradient>
      </defs>
    </svg>
  );
}
