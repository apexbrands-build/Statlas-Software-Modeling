/* Marketing calendar (planning layer): events per client, used by the Event Effect Model.
   marketing_events already exists from 0001 (client_id, date, end_date, category, title, source). This adds the Statlas-style fields
   and the write policies so the browser can add, edit, delete and import events.
   category = event type id (promotion, mothers_day, black_friday, email, initiative ...), title = event name. */

alter table marketing_events add column if not exists promo text;
alter table marketing_events add column if not exists product text;
alter table marketing_events add column if not exists audience text;
alter table marketing_events add column if not exists segment_size int;
alter table marketing_events add column if not exists notes text;

create index if not exists marketing_events_client_date on marketing_events (client_id, date);

create policy marketing_events_insert on marketing_events for insert to authenticated with check (public.has_client_access(client_id));
create policy marketing_events_update on marketing_events for update to authenticated using (public.has_client_access(client_id)) with check (public.has_client_access(client_id));
create policy marketing_events_delete on marketing_events for delete to authenticated using (public.has_client_access(client_id));
