import type { DayHeat } from "@/lib/planning/calendar-grid";
import type { EventGroup } from "@/lib/planning/events";

/** One colour per event group, used by the legend, the chips and the tint of a day. Full class names so Tailwind keeps them. */
export const GROUP_STYLE: Record<EventGroup, { chip: string; dot: string; cell: string; text: string }> = {
  offer: { chip: "bg-orange-500/35 text-orange-100 ring-1 ring-orange-400/50", dot: "bg-orange-400", cell: "border-orange-400/70 bg-orange-500/20", text: "text-orange-300" },
  launch: { chip: "bg-sky-500/35 text-sky-100 ring-1 ring-sky-400/50", dot: "bg-sky-400", cell: "border-sky-400/70 bg-sky-500/20", text: "text-sky-300" },
  holiday: { chip: "bg-pink-500/35 text-pink-100 ring-1 ring-pink-400/50", dot: "bg-pink-400", cell: "border-pink-400/70 bg-pink-500/20", text: "text-pink-300" },
  comms: { chip: "bg-emerald-500/35 text-emerald-100 ring-1 ring-emerald-400/50", dot: "bg-emerald-400", cell: "border-emerald-400/70 bg-emerald-500/20", text: "text-emerald-300" },
  bfcm: { chip: "bg-yellow-500/35 text-yellow-100 ring-1 ring-yellow-400/50", dot: "bg-yellow-400", cell: "border-yellow-400/70 bg-yellow-500/20", text: "text-yellow-300" },
  initiative: { chip: "bg-violet-500/35 text-violet-100 ring-1 ring-violet-400/50", dot: "bg-violet-400", cell: "border-violet-400/70 bg-violet-500/20", text: "text-violet-300" },
};

/** The small badge on a day the event model reshapes. */
export const HEAT_STYLE: Record<Exclude<DayHeat, "flat">, { badge: string; label: string }> = {
  hot: { badge: "bg-orange-500 text-black", label: "Big lift" },
  warm: { badge: "bg-amber-400 text-black", label: "Lift" },
  cool: { badge: "bg-sky-500/40 text-sky-100", label: "Quieter" },
};

/** Events people add most often: one click picks the type in the add dialog. */
export const QUICK_TYPES = ["promotion", "sitewide", "product_launch", "email", "sms", "influencer", "black_friday", "other"];
