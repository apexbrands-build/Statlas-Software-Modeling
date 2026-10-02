/** Meta attribution windows from the store settings ("7 Day" click, view "Disabled" -> ["7d_click"]). */
export function metaWindows(click: string | undefined, view: string | undefined): string[] {
  const day = (v: string | undefined) => (v ?? "").match(/^(\d+)\s*Day/i)?.[1];
  const c = day(click) ?? "7";
  const v = day(view);
  return [`${c}d_click`, ...(v ? [`${v}d_view`] : [])];
}

