import type { SourceId } from "../../lib/types";
import { CommaMark } from "../shell/CommaMark";

/**
 * Recognizable, brand-colored app marks for the connector/source UI (PRODUCT_READINESS_AUDIT
 * follow-up: "no generic placeholder icons where a recognizable app icon is available").
 * Hand-drawn simplified SVGs in each product's brand colors — close enough to read instantly
 * as Google Calendar / Zoom / Fathom / Gmail / GoHighLevel at 12–17px, without shipping any
 * third-party image assets. All share a 24×24 viewBox so sizing/alignment stays consistent
 * everywhere they appear (sources menu, connected-apps modal, progress lines, tool summaries).
 */

function GoogleCalendarIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#1967D2" />
      <rect x="5" y="6.5" width="14" height="12.5" rx="1" fill="#ffffff" />
      <rect x="5" y="2" width="14" height="3" fill="#1967D2" />
      <text x="12" y="16.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9" fontWeight="700" fill="#1967D2">
        31
      </text>
    </svg>
  );
}

function ZoomIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#2D8CFF" />
      <rect x="5" y="8.2" width="9.5" height="7.6" rx="1.8" fill="#ffffff" />
      <path d="M15.5 10.6l3.5-2.1v7l-3.5-2.1v-2.8z" fill="#ffffff" />
    </svg>
  );
}

function FathomIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#6C5CE7" />
      <g fill="#ffffff">
        <rect x="5.5" y="10" width="2" height="4" rx="1" />
        <rect x="9" y="7" width="2" height="10" rx="1" />
        <rect x="12.5" y="4.5" width="2" height="15" rx="1" />
        <rect x="16" y="8.5" width="2" height="7" rx="1" />
      </g>
    </svg>
  );
}

function GmailIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="3.5" width="21" height="17" rx="2.5" fill="#ffffff" stroke="#e5e7eb" strokeWidth="0.5" />
      <path d="M3.5 7v11h3V9.8L12 14l5.5-4.2V18h3V7l-8.5 6.4L3.5 7z" fill="none" />
      <path d="M3.5 18V7.2L12 13.6 20.5 7.2V18h-3V10.9L12 15 6.5 10.9V18h-3z" fill="#EA4335" />
      <rect x="3.5" y="9.5" width="3" height="8.5" fill="#4285F4" />
      <rect x="17.5" y="9.5" width="3" height="8.5" fill="#34A853" />
      <path d="M3.5 7.2L12 13.6 20.5 7.2 12 5 3.5 7.2z" fill="#EA4335" opacity="0" />
    </svg>
  );
}

function GoHighLevelIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#0F3D8A" />
      <g fill="none" stroke="#4FC3F7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 15.5L12 10l5.5 5.5" />
      </g>
      <g fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 11L12 5.5 17.5 11" opacity="0.95" />
      </g>
    </svg>
  );
}

const ICONS: Record<SourceId, (size: number) => React.ReactNode> = {
  commas: (size) => <CommaMark size={size} />,
  "google-calendar": (size) => <GoogleCalendarIcon size={size} />,
  zoom: (size) => <ZoomIcon size={size} />,
  fathom: (size) => <FathomIcon size={size} />,
  gmail: (size) => <GmailIcon size={size} />,
  crm: (size) => <GoHighLevelIcon size={size} />,
};

export function SourceIcon({ sourceId, size = 14 }: { sourceId: SourceId; size?: number }) {
  return <span className="inline-flex items-center justify-center shrink-0">{ICONS[sourceId](size)}</span>;
}
