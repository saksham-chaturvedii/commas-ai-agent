import { Mic, Video, CalendarDays, Mail, Users } from "lucide-react";
import type { SourceId } from "../../lib/types";
import { CommaMark } from "../shell/CommaMark";

const ICONS: Record<SourceId, (size: number) => React.ReactNode> = {
  commas: (size) => <CommaMark size={size} />,
  "google-calendar": (size) => <CalendarDays size={size} strokeWidth={1.75} />,
  zoom: (size) => <Video size={size} strokeWidth={1.75} />,
  fathom: (size) => <Mic size={size} strokeWidth={1.75} />,
  gmail: (size) => <Mail size={size} strokeWidth={1.75} />,
  crm: (size) => <Users size={size} strokeWidth={1.75} />,
};

export function SourceIcon({ sourceId, size = 14 }: { sourceId: SourceId; size?: number }) {
  return <span className="inline-flex items-center justify-center shrink-0">{ICONS[sourceId](size)}</span>;
}
