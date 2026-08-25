-- =====================================================================
-- PlanEOS · 0003_meetings.sql — Meetings + live agenda + attendees + notes + RLS
-- Run after 0001_core. Idempotent.
-- =====================================================================
do $$ begin create type meeting_status as enum ('scheduled','live','ended'); exception when duplicate_object then null; end $$;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  title text not null, type text default 'l10',
  status meeting_status not null default 'scheduled',
  scheduled_at timestamptz, started_at timestamptz, ended_at timestamptz,
  facilitator_id uuid references public.profiles(id), rating numeric,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_meetings_org on public.meetings(org_id);
do $$ begin create trigger trg_meetings_u before update on public.meetings for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;

create table if not exists public.meeting_agendas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null, allotted_minutes int default 5, position int not null default 0,
  is_active boolean not null default false, started_at timestamptz
);
create index if not exists idx_agenda_meeting on public.meeting_agendas(meeting_id, position);

create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  author_id uuid references public.profiles(id), body text,
  created_at timestamptz not null default now()
);

-- RLS
do $$
declare tbl text;
begin
  foreach tbl in array array['meetings','meeting_agendas','meeting_notes'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I_sel on public.%I', tbl, tbl);
    execute format('create policy %I_sel on public.%I for select using (public.is_org_member(org_id))', tbl, tbl);
    execute format('drop policy if exists %I_wr on public.%I', tbl, tbl);
    execute format('create policy %I_wr on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', tbl, tbl);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table public.meeting_agendas; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.meetings; exception when duplicate_object then null; end $$;
