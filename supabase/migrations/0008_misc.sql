-- =====================================================================
-- PlanEOS · 0008_misc.sql — headlines, vision (VTO), knowledge, notifications + RLS
-- Run after 0001_core. Idempotent.
-- =====================================================================

create table if not exists public.headlines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  author_id uuid references public.profiles(id),
  type text default 'general',   -- customer | employee | general
  title text not null, body text, archived_at timestamptz,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index if not exists idx_headlines_org on public.headlines(org_id);

create table if not exists public.vision (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  core_values jsonb default '[]', core_focus jsonb default '{}',
  ten_year_target text, marketing_strategy jsonb default '{}',
  three_year_picture text, one_year_plan text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (org_id, team_id)
);

create table if not exists public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null, body text, is_published boolean default true,
  author_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_knowledge_org on public.knowledge_docs(org_id);
do $$ begin create trigger trg_knowledge_u before update on public.knowledge_docs for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  type text, title text, body text,
  entity_table text, entity_id uuid, read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_recipient on public.notifications(recipient_id, read_at);

-- RLS: member read/write for shared modules
do $$
declare tbl text;
begin
  foreach tbl in array array['headlines','vision','knowledge_docs'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I_sel on public.%I', tbl, tbl);
    execute format('create policy %I_sel on public.%I for select using (public.is_org_member(org_id))', tbl, tbl);
    execute format('drop policy if exists %I_wr on public.%I', tbl, tbl);
    execute format('create policy %I_wr on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', tbl, tbl);
  end loop;
end $$;

-- notifications: only the recipient can read/update
alter table public.notifications enable row level security;
drop policy if exists notif_sel on public.notifications;
create policy notif_sel on public.notifications for select using ( recipient_id = auth.uid() );
drop policy if exists notif_upd on public.notifications;
create policy notif_upd on public.notifications for update using ( recipient_id = auth.uid() );
drop policy if exists notif_ins on public.notifications;
create policy notif_ins on public.notifications for insert with check ( public.is_org_member(org_id) );

do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.headlines; exception when duplicate_object then null; end $$;
