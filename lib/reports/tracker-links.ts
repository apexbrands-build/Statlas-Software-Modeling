import { TRACKER_PLATFORMS } from "../trackers/spend-tracker";
import { getReport } from "./registry";

export interface TrackerLink {
  /** The platform's id (meta, google...). */
  id: string;
  /** The platform's name. */
  label: string;
  /** The tracker's name in the report library. */
  title: string;
  href: string;
}

/** The spend trackers that are built (their report is ready), in the platforms' order. */
export function trackerLinks(): TrackerLink[] {
  return TRACKER_PLATFORMS.flatMap((p) => {
    const def = getReport(p.slug);
    return def?.status === "ready" ? [{ id: p.id, label: p.label, title: def.title, href: `/reporting/${p.slug}` }] : [];
  });
}
