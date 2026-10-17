import {
  Bot,
  CalendarDays,
  ChartNoAxesCombined,
  Clapperboard,
  FileSearch,
  Flame,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  Radar,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import type { ModuleKey } from "@/lib/navigation";

export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  radar: Radar,
  trends: Flame,
  opportunities: Lightbulb,
  research: FileSearch,
  rights: ShieldCheck,
  content: KanbanSquare,
  studio: Clapperboard,
  calendar: CalendarDays,
  analytics: ChartNoAxesCombined,
  agents: Bot,
  settings: Settings,
};
