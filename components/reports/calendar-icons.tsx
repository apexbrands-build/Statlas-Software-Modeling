import type { ActionType } from "@/lib/reports/calendar-actions";

export const ACTION_META: Record<ActionType, { label: string; color: string }> = {
  event: { label: "Calendar event", color: "#fbbf24" },
  email: { label: "Email", color: "#60a5fa" },
  sms: { label: "SMS", color: "#2dd4bf" },
  meta: { label: "Meta campaign", color: "#3b82f6" },
};

/** Marker icon for one action type: flag (event), envelope (email), speech bubble (SMS), Meta "f" disc. */
export function ActionIcon({ type, size = 14, x, y }: { type: ActionType; size?: number; x?: number; y?: number }) {
  const color = ACTION_META[type].color;
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, x, y };
  if (type === "event") return <svg {...common}><path fill={color} d="M6 3h1.8v18H6V3Zm3 1h9.2l-2 4 2 4H9V4Z" /></svg>;
  if (type === "email") return <svg {...common}><path fill={color} d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Zm2.2.5 6.8 5.1L18.8 7H5.2Z" /></svg>;
  if (type === "sms") return <svg {...common}><path fill={color} d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /></svg>;
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" fill={color} />
      <path fill="#000" d="M13.2 20v-6.3h2.1l.4-2.5h-2.5V9.7c0-.7.3-1.3 1.4-1.3h1.2V6.2c-.2 0-1-.1-1.8-.1-1.9 0-3.1 1.1-3.1 3.2v1.9H8.8v2.5h2.1V20h2.3Z" />
    </svg>
  );
}
