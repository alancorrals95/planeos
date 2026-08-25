-- =====================================================================
-- PlanEOS · 0006_time.sql — Time Tracking (Toggl-style) + RLS
-- Run after 0001_core. Idempotent.
-- =====================================================================

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  client_name text,
  color       text default '#5A5AF0',
  is_billable boolean not null default true,
  hourly_rate numeric,
  status      text not null default 'active',   -- active | archived
  owner_id    uuid references public.profiles(id),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_projects_org on public.projects(org_id);
drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table if not exists public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  description  text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,                       -- null = timer running
  is_billable  boolean not null default true,
  tags         text[] default '{}',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_time_entries_org on public.time_entries(org_id);
create index if not exists idx_time_entries_profile on public.time_entries(profile_id, started_at);
-- at most one running timer per user
create unique index if not exists uq_running_timer on public.time_entries(profile_id) where ended_at is null;

-- computed duration (seconds) helper view is optional; compute client-side.

-- ---- RLS ----
alter table public.projects enable row level security;
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select using ( public.is_org_member(org_id) );
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all
  using ( public.is_org_member(org_id) ) with check ( public.is_org_member(org_id) );

alter table public.time_entries enable row level security;
drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select
  using ( public.is_org_member(org_id) and (profile_id = auth.uid() or public.has_min_role(org_id,'manager')) );
drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert
  with check ( public.is_org_member(org_id) and profile_id = auth.uid() );
drop policy if exists time_update on public.time_entries;
create policy time_update on public.time_entries for update
  using ( profile_id = auth.uid() ) with check ( profile_id = auth.uid() );
drop policy if exists time_delete on public.time_entries;
create policy time_delete on public.time_entries for delete
  using ( profile_id = auth.uid() or public.has_min_role(org_id,'manager') );

-- realtime
do $$ begin alter publication supabase_realtime add table public.time_entries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.issues; exception when duplicate_object then null; end $$;
