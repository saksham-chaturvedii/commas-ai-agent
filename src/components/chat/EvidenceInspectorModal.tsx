import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import type { SourceId } from "../../lib/types";
import { SourceIcon } from "./SourceIcon";

export interface InspectableEvidence {
  title: string;
  category: string;
  record: string;
  sourceLabel: string;
  sourceId: SourceId;
  /** The underlying source record (a Fathom call, a Gmail thread, …), when the caller has it —
   * absent for evidence already sitting in the Resolution Center checklist, which only ever
   * stored the summarized text. Rendered as a small source-shaped detail view below the
   * evidence's own fields, not a full separate connected-app UI. */
  raw?: Record<string, unknown>;
}

function fmt(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A small, source-shaped rendering of `raw` — "open the underlying source/demo view" without
 * a full separate app per connector, which is out of scope for this prototype. Falls back to a
 * plain field list for a source this doesn't specifically know how to render. */
function SourceDetail({ sourceLabel, raw }: { sourceLabel: string; raw: Record<string, unknown> }) {
  if (sourceLabel === "Fathom") {
    return (
      <div className="flex flex-col gap-2">
        <Field label="Call" value={String(raw.title ?? "")} />
        <Field label="Occurred" value={fmt(raw.occurredAt)} />
        <Field label="Duration" value={`${raw.durationMinutes ?? "?"} minutes`} />
        {typeof raw.transcriptExcerpt === "string" && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Transcript excerpt</div>
            <p className="text-[13px] leading-[19px] text-[#1a1a1a] italic bg-[#fafafa] border border-[#ebebeb] rounded-lg p-2.5">
              {raw.transcriptExcerpt}
            </p>
          </div>
        )}
        {typeof raw.recordingUrl === "string" && (
          <div className="flex items-center gap-1.5 text-[12px] text-[#9ca3af]">
            <ExternalLink size={12} />
            Recording reference: {raw.recordingUrl} (simulated — no real file)
          </div>
        )}
      </div>
    );
  }

  if (sourceLabel === "Zoom") {
    return (
      <div className="flex flex-col gap-2">
        <Field label="Meeting" value={String(raw.topic ?? "")} />
        <Field label="Joined" value={fmt(raw.joinedAt)} />
        <Field label="Left" value={fmt(raw.leftAt)} />
        <Field label="Duration" value={`${raw.durationMinutes ?? "?"} minutes`} />
      </div>
    );
  }

  if (sourceLabel === "Google Calendar") {
    return (
      <div className="flex flex-col gap-2">
        <Field label="Event" value={String(raw.title ?? "")} />
        <Field label="Scheduled" value={fmt(raw.startAt)} />
        <Field label="Booked for" value={`${raw.durationMinutes ?? "?"} minutes`} />
        <Field label="Status" value={String(raw.status ?? "").replace(/_/g, " ")} />
      </div>
    );
  }

  if (sourceLabel === "Gmail") {
    const messages = Array.isArray(raw.messages) ? (raw.messages as { from: string; sentAt: string; snippet: string }[]) : [];
    return (
      <div className="flex flex-col gap-2">
        <Field label="Subject" value={String(raw.subject ?? "")} />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">
            Messages ({messages.length})
          </div>
          <ul className="flex flex-col gap-2">
            {messages.map((m, i) => (
              <li key={i} className="bg-[#fafafa] border border-[#ebebeb] rounded-lg p-2.5">
                <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                  <span>{m.from}</span>
                  <span>{fmt(m.sentAt)}</span>
                </div>
                <p className="text-[13px] leading-[18px] text-[#1a1a1a] mt-1">{m.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (sourceLabel === "GoHighLevel") {
    const activityLog = Array.isArray(raw.activityLog) ? (raw.activityLog as { date: string; type: string; detail: string }[]) : [];
    return (
      <div className="flex flex-col gap-2">
        <Field label="Contact" value={String(raw.name ?? "")} />
        <Field label="Status" value={String(raw.status ?? "").replace(/_/g, " ")} />
        <Field label="Pipeline stage" value={String(raw.pipelineStage ?? "")} />
        {activityLog.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Activity log</div>
            <ul className="flex flex-col gap-1.5">
              {activityLog.map((entry, i) => (
                <li key={i} className="text-[13px] text-[#1a1a1a]">
                  <span className="text-[#9ca3af]">{fmt(entry.date)} — </span>
                  {entry.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {Object.entries(raw).map(([key, value]) => (
        <li key={key} className="text-[13px] text-[#1a1a1a]">
          <span className="text-[#9ca3af]">{key}: </span>
          {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </li>
      ))}
    </ul>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">{label}</div>
      <div className="text-[13.5px] text-[#1a1a1a] mt-0.5">{value}</div>
    </div>
  );
}

/** "Inspect evidence" — shows what the evidence record actually is, and (when the caller has
 * it) a source-shaped view of the underlying record, standing in for "open the underlying
 * source/demo view" without a full separate app per connector. Read-only: this modal never
 * approves, rejects, or otherwise mutates anything — those actions live on the card that opened
 * it (ProposedActionCard / InvestigationReportCard / the evidence checklist). */
export function EvidenceInspectorModal({ evidence, onClose }: { evidence: InspectableEvidence; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-[480px] max-w-[92vw] max-h-[88vh] flex flex-col" style={{ borderRadius: 16, boxShadow: "0 0 25px rgba(0,0,0,0.15)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#ebebeb] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SourceIcon sourceId={evidence.sourceId} size={16} />
            <h2 className="text-[16px] leading-[22px] font-semibold tracking-[-0.2px] text-[#1a1a1a] truncate">{evidence.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-full text-[#9ca3af] hover:bg-[#fafafa] cursor-pointer shrink-0"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-[12px] text-[#9ca3af]">
            {evidence.category} · {evidence.sourceLabel}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Record</div>
            <p className="text-[13.5px] leading-[19px] text-[#1a1a1a]">{evidence.record}</p>
          </div>

          {evidence.raw && (
            <div className="content-card" style={{ padding: 16, gap: 10 }}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-agent-accent)]">
                {evidence.sourceLabel} source view
              </div>
              <SourceDetail sourceLabel={evidence.sourceLabel} raw={evidence.raw} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5 shrink-0">
          <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
