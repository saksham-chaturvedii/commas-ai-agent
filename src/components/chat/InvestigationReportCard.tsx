import { useState, type ReactNode } from "react";
import { AlertTriangle, Search } from "lucide-react";
import type { InvestigationReport } from "../../lib/types";
import { Badge } from "../shell/Badge";
import { SourceIcon } from "./SourceIcon";
import { EvidenceInspectorModal, type InspectableEvidence } from "./EvidenceInspectorModal";

const STRENGTH_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  Strong: "success",
  Moderate: "warning",
  Weak: "danger",
  Resolved: "info",
};

/**
 * The structured result of a full multi-source dispute investigation
 * (server/llm/stubClient.ts's `synthesizeDisputeInvestigation`) — CASE SUMMARY / EVIDENCE FOUND
 * / MISSING INFORMATION / POTENTIAL CONTRADICTIONS / RECOMMENDED NEXT ACTION / CASE STRENGTH,
 * rendered as real sections instead of parsed out of markdown prose. Every evidence row is
 * read-only here ("AI found" — inspectable, but not yet in the case); approving one into the
 * case still goes through the existing ProposedActionCard rendered alongside this, which is
 * where "approve"/"reject" actually live.
 */
export function InvestigationReportCard({ report }: { report: InvestigationReport }) {
  const [inspecting, setInspecting] = useState<InspectableEvidence | null>(null);

  return (
    <div className="content-card max-w-[560px]" style={{ padding: 20, gap: 16 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-agent-accent)]">
          Case report — Dispute #{report.disputeId}
        </div>
        <Badge variant={STRENGTH_VARIANT[report.caseStrength.label] ?? "neutral"}>{report.caseStrength.label}</Badge>
      </div>

      <Section title="Case summary">
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{report.caseSummary}</p>
      </Section>

      <Section title={`Evidence found (${report.evidenceFound.length})`}>
        {report.evidenceFound.length === 0 ? (
          <p className="text-[12.5px] text-[#9ca3af]">Nothing concrete turned up from the sources checked this turn.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.evidenceFound.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 py-2 px-2.5 rounded-lg bg-[#fafafa] border border-[#ebebeb]">
                <SourceIcon sourceId={item.sourceId} size={15} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="info">AI found</Badge>
                    <span className="text-[12.5px] font-medium text-[#1a1a1a]">{item.title}</span>
                  </div>
                  <div className="text-[11px] text-[#9ca3af] mt-0.5">{item.category}</div>
                  <p className="text-[12px] leading-[17px] text-[#6b7280] mt-1">{item.record}</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 mt-1.5 text-[12px] font-medium text-[var(--color-agent-accent)] cursor-pointer"
                    onClick={() =>
                      setInspecting({
                        title: item.title,
                        category: item.category,
                        record: item.record,
                        sourceLabel: item.sourceLabel,
                        sourceId: item.sourceId,
                        raw: item.raw,
                      })
                    }
                  >
                    <Search size={12} strokeWidth={2} />
                    Inspect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {report.potentialContradictions.length > 0 && (
        <Section title="Potential contradictions">
          <ul className="flex flex-col gap-1.5">
            {report.potentialContradictions.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[18px] text-[#1a1a1a]">
                <AlertTriangle size={13} strokeWidth={2} className="text-[#cb6301] mt-0.5 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.missingInformation.length > 0 && (
        <Section title="Missing information">
          <ul className="flex flex-col gap-1 list-disc pl-4">
            {report.missingInformation.map((line, i) => (
              <li key={i} className="text-[12.5px] leading-[18px] text-[#6b7280]">
                {line}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recommended next action">
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{report.recommendedNextAction}</p>
      </Section>

      <div className="pt-2 border-t border-[#ebebeb]">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-0.5">Case strength</div>
        <p className="text-[12.5px] leading-[18px] text-[#6b7280]">{report.caseStrength.explanation}</p>
      </div>

      {inspecting && <EvidenceInspectorModal evidence={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1.5">{title}</div>
      {children}
    </div>
  );
}
