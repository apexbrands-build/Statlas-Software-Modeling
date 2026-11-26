/** `marketing_events` rows to and from the app's events. Kept apart from the repository so the send time rules can be tested. */
import { normalizeSendTime, type MarketingEvent } from "../planning/events";

type Row = Record<string, unknown>;

export function eventFromRow(r: Row): MarketingEvent {
  const sendTime = normalizeSendTime(r.send_time);
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    date: r.date as string,
    endDate: ((r.end_date as string | null) ?? (r.date as string)) as string,
    type: r.category as string,
    name: (r.title as string) ?? "",
    ...(r.promo ? { promo: r.promo as string } : {}),
    ...(r.product ? { product: r.product as string } : {}),
    ...(r.audience ? { audience: r.audience as string } : {}),
    segmentSize: r.segment_size == null ? null : Number(r.segment_size),
    ...(r.notes ? { notes: r.notes as string } : {}),
    ...(sendTime ? { sendTime } : {}),
    source: ((r.source as string) ?? "manual") as MarketingEvent["source"],
  };
}

/**
 * The row to save. The send time column (migration 0023) is named only when the event carries one: a typed time is saved, an empty
 * string clears a stored time, and an event that never had one leaves the column out, so saving keeps working on a database
 * where the migration is not applied yet.
 */
export function eventToRow(clientId: string, e: Omit<MarketingEvent, "id" | "clientId"> & { id?: string }): Row {
  const time = normalizeSendTime(e.sendTime);
  return {
    ...(e.id ? { id: e.id } : {}),
    client_id: clientId,
    date: e.date,
    end_date: e.endDate || e.date,
    category: e.type,
    title: e.name || e.type,
    source: e.source === "klaviyo" || e.source === "sms" || e.source === "import" ? e.source : "manual",
    promo: e.promo ?? null,
    product: e.product ?? null,
    audience: e.audience ?? null,
    segment_size: e.segmentSize ?? null,
    notes: e.notes ?? null,
    ...(time ? { send_time: time } : e.sendTime === "" ? { send_time: null } : {}),
  };
}

/** What to tell the user when the database refuses an event. */
export function eventSaveError(message: string): string {
  if (/send_time/i.test(message)) return `Could not save the time of this event: database migration 0023 has not been applied yet (supabase/migrations/0023_hourly_report.sql). Save the event without a time, or apply the migration. ${message}`;
  if (/column|policy|permission|row-level/i.test(message)) return `Could not save events: database migration 0008 has not been applied yet (supabase/migrations/0008_marketing_calendar.sql). ${message}`;
  return message;
}
