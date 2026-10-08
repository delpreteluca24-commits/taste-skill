import {
  Bot,
  CalendarDays,
  ChartNoAxesCombined,
  Clapperboard,
  FileSearch,
  Flame,
  Image as ImageIcon,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  Radar,
  Scissors,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { ModuleKey } from "@/lib/navigation";

export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  radar: Radar,
  trends: Flame,
  opportunities: Lightbulb,
  research: FileSearch,
  content: KanbanSquare,
  clips: Scissors,
  editor: Clapperboard,
  thumbnails: ImageIcon,
  calendar: CalendarDays,
  analytics: ChartNoAxesCombined,
  agents: Bot,
  settings: Settings,
};
