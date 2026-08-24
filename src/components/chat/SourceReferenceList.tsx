import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SOURCES } from "../../lib/mockData";
import { SourceIcon } from "./SourceIcon";
import { EvidenceInspectorModal, type InspectableEvidence } from "./EvidenceInspectorModal";
import type { EvidenceSourceRef } from "../../lib/types";

/**
 * Compact, citation-style references to the connector(s) that contributed to a piece of
 * evidence — the one reusable pattern for evidence provenance across the product (the Evidence
 * Detail modal, the investigation report card, and anywhere else a finding needs to show where
 * it came from). Replaces the old plain-text "Inspect underlying source" link.
 *
 * Entirely data-driven: every chip's icon and display name come from the shared connector
 * registry (`SOURCES` in mockData.ts + `SourceIcon.tsx`), looked up by `sourceId` alone — there
 * is no per-connector branch here, so a new connector added to that registry gets this UI for
 * free. Deliberately styled as a reference (small pill, subtle border, muted text), not a
 * primary button, and self-contains its own click-to-open behavior so callers only need to
 * supply the source data and the evidence context around it.
 */
export function SourceReferenceList({
  sources,
  title,
  category,
  record,
}: {
  sources: EvidenceSourceRef[];
  /** Context for the detail view a click opens — the evidence entry's own fields, not the
   * source's. Each chip's own `raw` (when present) becomes that view's per-connector detail. */
  title: string;
  category: string;
  record: string;
}) {
  const [inspecting, setInspecting] = useState<InspectableEvidence | null>(null);

  if (sources.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((source, i) => {
          const connector = SOURCES.find((s) => s.id === source.sourceId);
          const name = connector?.name ?? source.sourceId;
          return (
            <button
              key={`${source.sourceId}-${i}`}
              type="button"
              title={`Open ${name} source`}
              onClick={(e) => {
                e.stopPropagation();
                setInspecting({ title, category, record, sourceLabel: name, sourceId: source.sourceId, raw: source.raw });
              }}
              className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2 rounded-full border border-[var(--color-border-card)] bg-white hover:bg-[#fafafa] hover:border-[#d0d0d0] text-[11.5px] font-medium text-[#525252] cursor-pointer transition-colors"
            >
              <SourceIcon sourceId={source.sourceId} size={12} />
              <span>{name}</span>
              <ExternalLink size={10} strokeWidth={2} className="text-[#9ca3af]" />
            </button>
          );
        })}
      </div>
      {inspecting && <EvidenceInspectorModal evidence={inspecting} onClose={() => setInspecting(null)} />}
    </>
  );
}
