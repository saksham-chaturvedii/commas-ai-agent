import { AgentMark } from "../shell/AgentMark";

/** Floating trigger for the right-side AI panel (spec §2.6). Hidden while the panel is open. */
export function FloatingAIButton({ onClick, hidden }: { onClick: () => void; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open AI panel"
      className="fixed bottom-6 right-6 z-30 flex items-center justify-center w-14 h-14 rounded-full bg-[var(--color-text-primary)] shadow-[0_4px_14px_rgba(0,0,0,0.25)] hover:opacity-90 transition-opacity"
    >
      <AgentMark size={24} />
    </button>
  );
}
