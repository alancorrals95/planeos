-- =====================================================================
-- PlanEOS · 0002_eos.sql
-- EOS core: rocks, milestones, todos, kpis, kpi_scores, issues
-- =====================================================================

do $$ begin
  create type rock_status  as enum ('on_track','off_track','complete','incomplete');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kpi_period   as enum ('weekly','monthly','quarterly','annual');
exception when duplicate_object then null; end $$;
do $$ begin
  create type kpi_operator as enum ('gte','lte','eq','between');
exception when duplicate_object then null; end $$;
do $$ begin
  create type issue_list   as enum ('short_term','long_term');
exception when duplicate_object then null; end $$;
do $$ begin
  create type issue_status as enum ('open','solved','dropped');
exception when duplicate_object then null; end $$;

-- rocks ---------------------------------------------------------------
create table if not exists public.rocks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  owner_id       uuid references public.profiles(id),
  title          text not null,
  description    text,
  quarter        text,                       -- e.g. '2026-Q3'
  status         rock_status not null default 'on_track',
  progress       int not null default 0 check (progress between 0 and 100),
  due_date       date,
  is_company_rock boolean not null default false,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_rocks_org on public.rocks(org_id);
drop trigger if exists trg_rocks_updated on public.rocks;
create trigger trg_rocks_updated before update on public.rocks
  for each row execute function public.set_updated_at();

create table if not exists public.milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  rock_id     uuid not null references public.rocks(id) on delete cascade,
  title       text not null,
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  position    int not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_milestones_rock on public.milestones(rock_id);

-- todos ---------------------------------------------------------------
create table if not exists public.todos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  owner_id       uuid references public.profiles(id),
  title          text not null,
  notes          text,
  due_date       date,
  done           boolean not null default false,
  done_at        timestamptz,
  is_private     boolean not null default false,
  archived_at    timestamptz,
  meeting_id     uuid,
  source_issue_id uuid,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_todos_org   on public.todos(org_id);
create index if not exists idx_todos_owner on public.todos(owner_id);
drop trigger if exists trg_todos_updated on public.todos;
create trigger trg_todos_updated before update on public.todos
  for each row execute function public.set_updated_at();

-- kpis + scores -------------------------------------------------------
create table if not exists public.kpis (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete set null,
  owner_id      uuid references public.profiles(id),
  name          text not null,
  unit          text,
  goal_operator kpi_operator not null default 'gte',
  goal          numeric,
  goal_max      numeric,
  period        kpi_period not null default 'weekly',
  is_average    boolean not null default false,
  position      int not null default 0,
  archived_at   timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_kpis_org on public.kpis(org_id);
drop trigger if exists trg_kpis_updated on public.kpis;
create trigger trg_kpis_updated before update on public.kpis
  for each row execute function public.set_updated_at();

create table if not exists public.kpi_scores (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  kpi_id       uuid not null references public.kpis(id) on delete cascade,
  period_start date not null,
  value        numeric,
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kpi_id, period_start)
);
create index if not exists idx_kpi_scores_kpi on public.kpi_scores(kpi_id, period_start);
drop trigger if exists trg_kpi_scores_updated on public.kpi_scores;
create trigger trg_kpi_scores_updated before update on public.kpi_scores
  for each row execute function public.set_updated_at();

-- issues (IDS) --------------------------------------------------------
create table if not exists public.issues (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  team_id        uuid references public.teams(id) on delete set null,
  raised_by      uuid references public.profiles(id),
  owner_id       uuid references public.profiles(id),
  title          text not null,
  description    text,
  list           issue_list not null default 'short_term',
  rank           int not null default 0,
  status         issue_status not null default 'open',
  solved_at      timestamptz,
  sent_to_team_id uuid references public.teams(id) on delete set null,
  origin_team_id  uuid references public.teams(id) on delete set null,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_issues_org on public.issues(org_id);
drop trigger if exists trg_issues_updated on public.issues;
create trigger trg_issues_updated before update on public.issues
  for each row execute function public.set_updated_at();
