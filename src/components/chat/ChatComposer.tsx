import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { Chat } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";
import { SourcesMenu } from "./SourcesMenu";
import { AddCreditsModal } from "./AddCreditsModal";

/**
 * Chat composer — shared between the empty state ("hero") and the bottom bar of an
 * in-progress conversation ("bar"). Spec §2.9: Sources selector lives in the controls menu.
 */
export function ChatComposer({
  chat,
  variant = "bar",
  placeholder = "Ask about your business…",
}: {
  chat: Chat;
  variant?: "hero" | "bar";
  placeholder?: string;
}) {
  const { sendMessage, cancelRun, runChatId, runPhase, credits } = useChatStore();
  const [value, setValue] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isRunningHere = runChatId === chat.id && runPhase === "running";
  const exhausted = credits.totalCredits - credits.usedCredits <= 0;
  const disabled = exhausted || (runChatId !== null && !isRunningHere);

  const handlePurchased = (amount: number) => {
    setToast(`${amount} credits added`);
    window.setTimeout(() => setToast(null), 2500);
  };

  const submit = () => {
    if (!value.trim() || disabled || isRunningHere) return;
    sendMessage(chat.id, value);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={variant === "hero" ? "w-full max-w-[560px] mx-auto" : "w-full max-w-[720px] mx-auto"}>
      <div className="composer-shell flex flex-col">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={exhausted ? "You're out of AI credits" : placeholder}
          disabled={disabled}
          rows={variant === "hero" ? 2 : 1}
          className="w-full resize-none bg-transparent border-none outline-none px-4 pt-3.5 pb-2 text-[14px] leading-[21px] text-[var(--color-text-primary)] placeholder:text-[#9ca3af] disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <SourcesMenu chat={chat} />
          {isRunningHere ? (
            <button
              type="button"
              onClick={cancelRun}
              aria-label="Stop"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-text-primary)] text-white hover:opacity-85"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              aria-label="Send"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-text-primary)] text-white disabled:bg-[#d1d5db] disabled:cursor-not-allowed hover:enabled:opacity-85"
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
      {exhausted && (
        <div className="mt-2 text-center">
          <p className="text-[12px] text-[var(--color-danger-text)]">
            Your workspace has run out of AI credits.{" "}
            <button
              type="button"
              onClick={() => setBuyOpen(true)}
              className="font-semibold text-[var(--color-primary)] hover:underline"
            >
              Buy Credits
            </button>{" "}
            to keep chatting.
          </p>
        </div>
      )}
      {toast && (
        <p className="text-[12px] font-medium text-[var(--color-success-text)] mt-2 text-center">{toast}</p>
      )}
      {buyOpen && <AddCreditsModal onClose={() => setBuyOpen(false)} onPurchased={handlePurchased} />}
    </div>
  );
}
