-- BluberryKisses wedding village — Supabase schema
-- Run this whole file once in Supabase > SQL Editor.
-- Then set the host password with the last statement (edit it first).

create extension if not exists pgcrypto with schema extensions;

-- One table holds every game document, addressed by a slash path:
--   guests/<uid>                one row per guest (character, position, quests)
--   event/draw, event/moderation, event/recording   host-controlled state
--   replay/<timestamp>          timelapse snapshots (host only)
--   data/users/<uid>/<doc>      each guest's private photos
create table if not exists public.docs (
  path       text primary key,
  col        text not null,
  data       jsonb not null default '{}'::jsonb,
  owner      uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists docs_col_idx on public.docs (col);
alter table public.docs replica identity full;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

-- Hosts (bride, groom) are guests who entered the host password once.
create table if not exists public.hosts (uid uuid primary key, added_at timestamptz not null default now());
create table if not exists public.app_secret (k text primary key, v text not null);
alter table public.hosts enable row level security;
alter table public.app_secret enable row level security;   -- no policies: unreadable from the browser

create or replace function public.is_host() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hosts where uid = auth.uid());
$$;

create or replace function public.claim_host(pw text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if auth.uid() is null then return false; end if;
  select v into h from public.app_secret where k = 'host_pw';
  if h is null or extensions.crypt(pw, h) <> h then
    perform pg_sleep(0.6);   -- slow down guessing
    return false;
  end if;
  insert into public.hosts(uid) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.leave_host() returns void
language sql security definer set search_path = public as $$
  delete from public.hosts where uid = auth.uid();
$$;

revoke all on function public.claim_host(text) from public;
grant execute on function public.claim_host(text) to anon, authenticated;
grant execute on function public.is_host() to anon, authenticated;
grant execute on function public.leave_host() to anon, authenticated;

-- Row level security for game documents
alter table public.docs enable row level security;

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select using (
  case
    when path like 'data/users/%' then path like 'data/users/' || auth.uid()::text || '/%'
    when col = 'replay' then public.is_host()
    else true
  end
);

drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert with check (
  auth.uid() is not null and (
       path = 'guests/' || auth.uid()::text
    or path like 'data/users/' || auth.uid()::text || '/%'
    or ((path like 'event/%' or path like 'replay/%') and public.is_host())
  )
);

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update using (
       path = 'guests/' || auth.uid()::text
    or path like 'data/users/' || auth.uid()::text || '/%'
    or ((path like 'event/%' or path like 'replay/%') and public.is_host())
) with check (
       path = 'guests/' || auth.uid()::text
    or path like 'data/users/' || auth.uid()::text || '/%'
    or ((path like 'event/%' or path like 'replay/%') and public.is_host())
);

drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete using (
       path like 'data/users/' || auth.uid()::text || '/%'
    or public.is_host()
);

grant select, insert, update, delete on public.docs to anon, authenticated;

-- Realtime: broadcast row changes to connected guests
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Set the host password (change 'blueberry-1234' before running).
-- Run again any time to change it.
insert into public.app_secret(k, v)
values ('host_pw', extensions.crypt('blueberry-1234', extensions.gen_salt('bf')))
on conflict (k) do update set v = excluded.v;
-- =====================================================================

-- After the wedding, to clear test data before the real day:
--   delete from public.docs; delete from public.hosts;
