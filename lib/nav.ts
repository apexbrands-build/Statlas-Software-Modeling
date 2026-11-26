/** A tracker page: a report whose slug ends in "-tracker". The trackers have their own sidebar entry. */
export const isTrackerPath = (path: string): boolean => /^\/reporting\/[a-z0-9-]+-tracker(\/|$)/.test(path);

/** Whether a sidebar entry is the lit one on a page. Tracker pages light "Trackers", not "Reporting". */
export function isNavActive(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  if (isTrackerPath(href)) return isTrackerPath(path);
  if (href === "/reporting") return path.startsWith(href) && !isTrackerPath(path);
  return path.startsWith(href);
}
