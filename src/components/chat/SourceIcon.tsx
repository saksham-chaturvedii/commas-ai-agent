import { Mic, Video, CalendarDays, Filter } from "lucide-react";
import type { SourceId } from "../../lib/types";
import { CommaMark } from "../shell/CommaMark";

const ICONS: Record<SourceId, (size: number) => React.ReactNode> = {
  commas: (size) => <CommaMark size={size} />,
  fathom: (size) => <Mic size={size} strokeWidth={1.75} />,
  zoom: (size) => <Video size={size} strokeWidth={1.75} />,
  "google-meet": (size) => <CalendarDays size={size} strokeWidth={1.75} />,
  clickfunnels: (size) => <Filter size={size} strokeWidth={1.75} />,
};

export function SourceIcon({ sourceId, size = 14 }: { sourceId: SourceId; size?: number }) {
  return <span className="inline-flex items-center justify-center shrink-0">{ICONS[sourceId](size)}</span>;
}
