"use client";

import type { FillSource } from "@/lib/planning/history";
import { inputClass } from "./ui";

/** "Fill from…" dropdown for one month. Returns an error text via onResult when nothing could be filled. */
export function FillMenu({ month, disabled, growthPct, fill, onResult, label = "Fill…" }: { month: string; disabled?: boolean; growthPct?: number; fill: (month: string, s: FillSource | "clear" | "blank", g?: number) => string | null; onResult: (msg: string | null) => void; label?: string }) {
  return (
    <select
      aria-label={`Fill ${month}`}
      className={`${inputClass} w-full text-xs`}
      disabled={disabled}
      value=""
      onChange={(e) => {
        const v = e.target.value as FillSource | "clear" | "blank";
        if (v) onResult(fill(month, v, growthPct));
      }}
    >
      <option value="">{label}</option>
      <option value="last_year">From last year</option>
      <option value="recent">From last 3 months</option>
      <option value="actuals">From actuals</option>
      <option value="blank">Blank (type everything)</option>
      <option value="clear">Clear month</option>
    </select>
  );
}
