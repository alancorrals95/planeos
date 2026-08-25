-- =====================================================================
-- PlanEOS · full_schema.sql — ALL migrations concatenated, in order.
-- Paste this whole file into Supabase → SQL Editor and Run once.
-- Idempotent: safe to re-run.
-- =====================================================================


-- ####################### 0001_core.sql #######################

-- =====================================================================
-- PlanEOS · 0001_core.sql
-- Tenancy foundation: profiles, organizations, members, invites, teams
-- + security-definer helper functions + new-user trigger + RPCs
-- =====================================================================

-- Extensions -----------------------------------------------------------
-- On Supabase pgcrypto lives in the `extensions` schema.
create extension if not exists "pgcrypto" with schema extensions;   -- gen_random_bytes/uuid

-- Enums ----------------------------------------------------------------
do $$ begin
  create type org_role   as enum ('owner','admin','manager','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('active','invited','suspended');
exception when duplicate_object then null; end $$;

-- Helper: touch updated_at --------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- profiles (1:1 with auth.users) --------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  title       text,
  phone       text,
  timezone    text default 'America/Mexico_City',
  locale      text default 'es',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- organizations -------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  logo_url    text,
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_org_updated on public.organizations;
create trigger trg_org_updated before update on public.organizations
  for each row execute function public.set_updated_at();

-- org_members ---------------------------------------------------------
create table if not exists public.org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        org_role not null default 'member',
  status      member_status not null default 'active',
  invited_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, profile_id)
);
create index if not exists idx_org_members_profile on public.org_members(profile_id);
create index if not exists idx_org_members_org     on public.org_members(org_id);
drop trigger if exists trg_org_members_updated on public.org_members;
create trigger trg_org_members_updated before update on public.org_members
  for each row execute function public.set_updated_at();

-- org_invites ---------------------------------------------------------
create table if not exists public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  role        org_role not null default 'member',
  token       text not null unique default encode(extensions.gen_random_bytes(18),'hex'),
  invited_by  uuid references public.profiles(id),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_org_invites_email on public.org_invites(lower(email));

-- teams ---------------------------------------------------------------
create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  name          text not null,
  description   text,
  lead_id       uuid references public.profiles(id),
  is_leadership boolean not null default false,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_teams_org on public.teams(org_id);

create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role_in_team text,
  created_at   timestamptz not null default now(),
  unique (team_id, profile_id)
);

-- =====================================================================
-- Security-definer helpers (bypass RLS to avoid recursive policies)
-- =====================================================================
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and profile_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.org_role(p_org uuid)
returns org_role language sql stable security definer set search_path = public as $$
  select role from public.org_members
  where org_id = p_org and profile_id = auth.uid() and status = 'active'
  limit 1;
$$;

-- ordinal rank: owner=4, admin=3, manager=2, member=1, null=0
create or replace function public.role_rank(r org_role)
returns int language sql immutable as $$
  select case r
    when 'owner' then 4 when 'admin' then 3
    when 'manager' then 2 when 'member' then 1 else 0 end;
$$;

create or replace function public.has_min_role(p_org uuid, p_min org_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.role_rank(public.org_role(p_org)) >= public.role_rank(p_min);
$$;

-- =====================================================================
-- New auth user -> profile row
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- RPC: create_organization  (atomic org + owner membership)
-- =====================================================================
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_slug := regexp_replace(lower(coalesce(p_name,'org')), '[^a-z0-9]+', '-', 'g')
            || '-' || substr(encode(gen_random_bytes(3),'hex'),1,6);

  insert into public.organizations (name, slug, created_by)
  values (coalesce(nullif(trim(p_name),''),'My Organization'), v_slug, auth.uid())
  returning id into v_org;

  insert into public.org_members (org_id, profile_id, role, status)
  values (v_org, auth.uid(), 'owner', 'active');

  -- default leadership team
  insert into public.teams (org_id, name, is_leadership, created_by)
  values (v_org, 'Leadership', true, auth.uid());

  return v_org;
end $$;

-- =====================================================================
-- RPC: accept_invite
-- =====================================================================
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inv public.org_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_inv from public.org_invites
  where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'invalid or expired invite'; end if;

  insert into public.org_members (org_id, profile_id, role, status, invited_by)
  values (v_inv.org_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  on conflict (org_id, profile_id)
    do update set status = 'active';

  update public.org_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end $$;

-- =====================================================================
-- Guard: never remove/demote the last owner
-- =====================================================================
create or replace function public.protect_last_owner()
returns trigger language plpgsql as $$
declare v_owners int;
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*) into v_owners from public.org_members
      where org_id = old.org_id and role = 'owner' and status = 'active';
    if v_owners <= 1 then
      raise exception 'cannot remove the last owner of the organization';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_protect_last_owner on public.org_members;
create trigger trg_protect_last_owner
  before update or delete on public.org_members
  for each row execute function public.protect_last_owner();

-- ####################### 0002_eos.sql #######################

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

-- ####################### 0003_meetings.sql #######################

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

-- ####################### 0004_crm.sql #######################

-- =====================================================================
-- PlanEOS · 0004_crm.sql — CRM (companies, contacts, pipelines, deals, activities) + RLS
-- Run after 0001_core. Idempotent.
-- =====================================================================

do $$ begin create type deal_status as enum ('open','won','lost'); exception when duplicate_object then null; end $$;

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, domain text, industry text, size text, phone text,
  address jsonb, owner_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_crm_companies_org on public.crm_companies(org_id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete set null,
  first_name text, last_name text, email text, phone text, title text,
  owner_id uuid references public.profiles(id), tags text[] default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_crm_contacts_org on public.crm_contacts(org_id);

create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, position int not null default 0,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  name text not null, position int not null default 0, probability int default 0
);
create index if not exists idx_crm_stages_pipeline on public.crm_stages(pipeline_id, position);

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  stage_id uuid references public.crm_stages(id) on delete set null,
  name text not null, amount numeric default 0, currency text default 'USD',
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  owner_id uuid references public.profiles(id), status deal_status not null default 'open',
  close_date date, position int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_crm_deals_org on public.crm_deals(org_id);
create index if not exists idx_crm_deals_stage on public.crm_deals(stage_id, position);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null default 'note',   -- call|email|meeting|note|task
  subject text, body text, due_at timestamptz, done boolean default false,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  owner_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

-- touch triggers
do $$ begin
  create trigger trg_crm_companies_u before update on public.crm_companies for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_crm_contacts_u before update on public.crm_contacts for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger trg_crm_deals_u before update on public.crm_deals for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- RLS: member reads; member writes (managers can delete) ----
do $$
declare tbl text;
begin
  foreach tbl in array array['crm_companies','crm_contacts','crm_pipelines','crm_stages','crm_deals','crm_activities'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I_sel on public.%I', tbl, tbl);
    execute format('create policy %I_sel on public.%I for select using (public.is_org_member(org_id))', tbl, tbl);
    execute format('drop policy if exists %I_wr on public.%I', tbl, tbl);
    execute format('create policy %I_wr on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', tbl, tbl);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table public.crm_deals; exception when duplicate_object then null; end $$;

-- default pipeline + stages helper (call once per org from the app if none)
create or replace function public.ensure_default_pipeline(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pipe uuid;
begin
  if not public.is_org_member(p_org) then raise exception 'not a member'; end if;
  select id into v_pipe from public.crm_pipelines where org_id = p_org order by position limit 1;
  if v_pipe is not null then return v_pipe; end if;
  insert into public.crm_pipelines (org_id, name, created_by) values (p_org, 'Sales', auth.uid()) returning id into v_pipe;
  insert into public.crm_stages (org_id, pipeline_id, name, position, probability) values
    (p_org, v_pipe, 'Lead', 0, 10), (p_org, v_pipe, 'Qualified', 1, 30),
    (p_org, v_pipe, 'Proposal', 2, 60), (p_org, v_pipe, 'Won', 3, 100);
  return v_pipe;
end $$;

-- ####################### 0005_chat.sql #######################

-- =====================================================================
-- PlanEOS · 0005_chat.sql
-- Slack-style chat: channels, members, messages, reactions
-- =====================================================================

do $$ begin
  create type channel_kind as enum ('public','private','dm','group_dm');
exception when duplicate_object then null; end $$;

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text,
  topic       text,
  kind        channel_kind not null default 'public',
  team_id     uuid references public.teams(id) on delete set null,
  dm_key      text,                          -- deterministic key for DMs to prevent dupes
  archived_at timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_channels_org on public.channels(org_id);
create unique index if not exists uq_channels_dm on public.channels(org_id, dm_key)
  where dm_key is not null;
drop trigger if exists trg_channels_updated on public.channels;
create trigger trg_channels_updated before update on public.channels
  for each row execute function public.set_updated_at();

create table if not exists public.channel_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  channel_id   uuid not null references public.channels(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member',   -- 'admin' | 'member'
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (channel_id, profile_id)
);
create index if not exists idx_channel_members_profile on public.channel_members(profile_id);
create index if not exists idx_channel_members_channel on public.channel_members(channel_id);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  author_id   uuid references public.profiles(id),
  body        text,
  parent_id   uuid references public.messages(id) on delete cascade,  -- thread root
  attachments jsonb not null default '[]'::jsonb,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_channel on public.messages(channel_id, created_at);
create index if not exists idx_messages_parent  on public.messages(parent_id);

create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  message_id  uuid not null references public.messages(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (message_id, profile_id, emoji)
);
create index if not exists idx_reactions_message on public.message_reactions(message_id);

-- Channel membership helper (security definer to avoid recursion) -----
create or replace function public.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = p_channel and profile_id = auth.uid()
  );
$$;

-- RPC: get-or-create a DM channel between current user and another -----
create or replace function public.get_or_create_dm(p_org uuid, p_other uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_channel uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_org_member(p_org) then raise exception 'not a member'; end if;

  -- deterministic key: sorted uuid pair
  v_key := (select string_agg(x::text, ':' order by x)
            from (values (auth.uid()), (p_other)) as t(x));

  select id into v_channel from public.channels
    where org_id = p_org and dm_key = v_key limit 1;
  if v_channel is not null then return v_channel; end if;

  insert into public.channels (org_id, kind, dm_key, created_by)
  values (p_org, 'dm', v_key, auth.uid())
  returning id into v_channel;

  insert into public.channel_members (org_id, channel_id, profile_id)
  values (p_org, v_channel, auth.uid()), (p_org, v_channel, p_other)
  on conflict do nothing;

  return v_channel;
end $$;

-- Auto-add creator as channel admin on channel insert -----------------
create or replace function public.channel_add_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.channel_members (org_id, channel_id, profile_id, role)
    values (new.org_id, new.id, new.created_by, 'admin')
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_channel_add_creator on public.channels;
create trigger trg_channel_add_creator after insert on public.channels
  for each row execute function public.channel_add_creator();

-- ####################### 0006_time.sql #######################

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

-- ####################### 0008_misc.sql #######################

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

-- ####################### 0100_rls.sql #######################

-- =====================================================================
-- PlanEOS · 0100_rls.sql
-- Row Level Security for all tenant tables.
-- Run AFTER 0001_core, 0002_eos, 0005_chat.
-- Security model: the publishable/anon key is public; RLS is the boundary.
-- =====================================================================

-- Helper: do I share any org with this profile? -----------------------
create or replace function public.shares_org(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on them.org_id = me.org_id
    where me.profile_id = auth.uid() and me.status = 'active'
      and them.profile_id = p_profile
  );
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using ( id = auth.uid() or public.shares_org(id) );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check ( id = auth.uid() );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using ( id = auth.uid() ) with check ( id = auth.uid() );

-- ---------------------------------------------------------------------
-- organizations  (insert handled by create_organization RPC)
-- ---------------------------------------------------------------------
alter table public.organizations enable row level security;

drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select
  using ( public.is_org_member(id) );

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update
  using ( public.has_min_role(id,'admin') )
  with check ( public.has_min_role(id,'admin') );

-- ---------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------
alter table public.org_members enable row level security;

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select
  using ( public.is_org_member(org_id) );

-- admins manage members; RPCs (security definer) cover self-join/invite
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members for insert
  with check ( public.has_min_role(org_id,'admin') );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members for update
  using ( public.has_min_role(org_id,'admin') )
  with check ( public.has_min_role(org_id,'admin') );

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members for delete
  using ( public.has_min_role(org_id,'admin') or profile_id = auth.uid() );

-- ---------------------------------------------------------------------
-- org_invites
-- ---------------------------------------------------------------------
alter table public.org_invites enable row level security;

drop policy if exists org_invites_all on public.org_invites;
create policy org_invites_all on public.org_invites for all
  using ( public.has_min_role(org_id,'admin') )
  with check ( public.has_min_role(org_id,'admin') );

-- ---------------------------------------------------------------------
-- teams / team_members
-- ---------------------------------------------------------------------
alter table public.teams enable row level security;
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select using ( public.is_org_member(org_id) );
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all
  using ( public.has_min_role(org_id,'manager') )
  with check ( public.has_min_role(org_id,'manager') );

alter table public.team_members enable row level security;
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select using ( public.is_org_member(org_id) );
drop policy if exists team_members_write on public.team_members;
create policy team_members_write on public.team_members for all
  using ( public.has_min_role(org_id,'manager') )
  with check ( public.has_min_role(org_id,'manager') );

-- ---------------------------------------------------------------------
-- Generic tenant tables: member can read; member can write own rows;
-- managers can write any. Applied per-table below.
-- ---------------------------------------------------------------------

-- rocks
alter table public.rocks enable row level security;
drop policy if exists rocks_select on public.rocks;
create policy rocks_select on public.rocks for select using ( public.is_org_member(org_id) );
drop policy if exists rocks_insert on public.rocks;
create policy rocks_insert on public.rocks for insert
  with check ( public.is_org_member(org_id) and created_by = auth.uid() );
drop policy if exists rocks_update on public.rocks;
create policy rocks_update on public.rocks for update
  using ( public.is_org_member(org_id) and (owner_id = auth.uid() or created_by = auth.uid() or public.has_min_role(org_id,'manager')) );
drop policy if exists rocks_delete on public.rocks;
create policy rocks_delete on public.rocks for delete
  using ( created_by = auth.uid() or public.has_min_role(org_id,'manager') );

-- milestones
alter table public.milestones enable row level security;
drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select using ( public.is_org_member(org_id) );
drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones for all
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );

-- todos  (private todos only visible to owner)
alter table public.todos enable row level security;
drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos for select
  using ( public.is_org_member(org_id) and (is_private = false or owner_id = auth.uid() or created_by = auth.uid()) );
drop policy if exists todos_insert on public.todos;
create policy todos_insert on public.todos for insert
  with check ( public.is_org_member(org_id) and created_by = auth.uid() );
drop policy if exists todos_update on public.todos;
create policy todos_update on public.todos for update
  using ( public.is_org_member(org_id) and (owner_id = auth.uid() or created_by = auth.uid() or public.has_min_role(org_id,'manager')) );
drop policy if exists todos_delete on public.todos;
create policy todos_delete on public.todos for delete
  using ( created_by = auth.uid() or owner_id = auth.uid() or public.has_min_role(org_id,'manager') );

-- kpis
alter table public.kpis enable row level security;
drop policy if exists kpis_select on public.kpis;
create policy kpis_select on public.kpis for select using ( public.is_org_member(org_id) );
drop policy if exists kpis_write on public.kpis;
create policy kpis_write on public.kpis for all
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );

-- kpi_scores
alter table public.kpi_scores enable row level security;
drop policy if exists kpi_scores_select on public.kpi_scores;
create policy kpi_scores_select on public.kpi_scores for select using ( public.is_org_member(org_id) );
drop policy if exists kpi_scores_write on public.kpi_scores;
create policy kpi_scores_write on public.kpi_scores for all
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );

-- issues
alter table public.issues enable row level security;
drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues for select using ( public.is_org_member(org_id) );
drop policy if exists issues_write on public.issues;
create policy issues_write on public.issues for all
  using ( public.is_org_member(org_id) )
  with check ( public.is_org_member(org_id) );

-- ---------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------
alter table public.channels enable row level security;
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select
  using ( public.is_org_member(org_id) and (kind = 'public' or public.is_channel_member(id)) );
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert
  with check ( public.is_org_member(org_id) and created_by = auth.uid() );
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update
  using ( created_by = auth.uid() or public.has_min_role(org_id,'admin') );

alter table public.channel_members enable row level security;
drop policy if exists channel_members_select on public.channel_members;
create policy channel_members_select on public.channel_members for select
  using ( public.is_org_member(org_id) );
-- self-join (public channels) or you're already an admin of the channel
drop policy if exists channel_members_insert on public.channel_members;
create policy channel_members_insert on public.channel_members for insert
  with check ( public.is_org_member(org_id) and profile_id = auth.uid() );
drop policy if exists channel_members_update on public.channel_members;
create policy channel_members_update on public.channel_members for update
  using ( profile_id = auth.uid() ) with check ( profile_id = auth.uid() );
drop policy if exists channel_members_delete on public.channel_members;
create policy channel_members_delete on public.channel_members for delete
  using ( profile_id = auth.uid() );

alter table public.messages enable row level security;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using ( public.is_channel_member(channel_id) );
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check ( public.is_channel_member(channel_id) and author_id = auth.uid() );
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update
  using ( author_id = auth.uid() ) with check ( author_id = auth.uid() );
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete
  using ( author_id = auth.uid() or public.has_min_role(org_id,'admin') );

alter table public.message_reactions enable row level security;
drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions for select
  using ( public.is_org_member(org_id) );
drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions for insert
  with check ( public.is_org_member(org_id) and profile_id = auth.uid() );
drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions for delete
  using ( profile_id = auth.uid() );

-- ---------------------------------------------------------------------
-- Realtime publication (safe to re-run)
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.todos;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.rocks;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.kpi_scores;
exception when duplicate_object then null; end $$;

-- ####################### 0101_fix_pgcrypto.sql #######################

-- =====================================================================
-- PlanEOS · 0101_fix_pgcrypto.sql
-- Fix: "function gen_random_bytes(integer) does not exist"
-- On Supabase, pgcrypto lives in the `extensions` schema, but our
-- SECURITY DEFINER functions pinned search_path=public. Add `extensions`.
-- Safe to run standalone (recreates the affected functions/defaults).
-- =====================================================================

-- make sure pgcrypto is available (Supabase installs it in `extensions`)
create extension if not exists pgcrypto with schema extensions;

-- token default for invites -> schema-qualify so it never depends on search_path
alter table public.org_invites
  alter column token set default encode(extensions.gen_random_bytes(18), 'hex');

-- create_organization: add extensions to search_path
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_slug := regexp_replace(lower(coalesce(p_name,'org')), '[^a-z0-9]+', '-', 'g')
            || '-' || substr(encode(gen_random_bytes(3),'hex'),1,6);

  insert into public.organizations (name, slug, created_by)
  values (coalesce(nullif(trim(p_name),''),'My Organization'), v_slug, auth.uid())
  returning id into v_org;

  insert into public.org_members (org_id, profile_id, role, status)
  values (v_org, auth.uid(), 'owner', 'active');

  insert into public.teams (org_id, name, is_leadership, created_by)
  values (v_org, 'Leadership', true, auth.uid());

  return v_org;
end $$;

-- accept_invite: add extensions to search_path (defensive)
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inv public.org_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_inv from public.org_invites
  where token = p_token and accepted_at is null and expires_at > now();
  if not found then raise exception 'invalid or expired invite'; end if;

  insert into public.org_members (org_id, profile_id, role, status, invited_by)
  values (v_inv.org_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by)
  on conflict (org_id, profile_id) do update set status = 'active';

  update public.org_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end $$;

-- get_or_create_dm: add extensions to search_path (defensive)
create or replace function public.get_or_create_dm(p_org uuid, p_other uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_channel uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_org_member(p_org) then raise exception 'not a member'; end if;

  v_key := (select string_agg(x::text, ':' order by x)
            from (values (auth.uid()), (p_other)) as t(x));

  select id into v_channel from public.channels
    where org_id = p_org and dm_key = v_key limit 1;
  if v_channel is not null then return v_channel; end if;

  insert into public.channels (org_id, kind, dm_key, created_by)
  values (p_org, 'dm', v_key, auth.uid())
  returning id into v_channel;

  insert into public.channel_members (org_id, channel_id, profile_id)
  values (p_org, v_channel, auth.uid()), (p_org, v_channel, p_other)
  on conflict do nothing;

  return v_channel;
end $$;

-- ####################### 0009_boards.sql #######################

-- =====================================================================
-- PlanEOS · 0009_boards.sql
-- ClickUp/HubSpot-style Boards + generic interconnection (entity_links)
-- Evolves `todos` into the universal task/board-item. Keeps CRM separate.
-- Run after 0001_core + 0002_eos. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- boards + columns
-- ---------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  icon        text,
  color       text default '#5A5AF0',
  type        text not null default 'task' check (type in ('task')),
  scope       text not null default 'org'  check (scope in ('org','team','private')),
  team_id     uuid references public.teams(id) on delete cascade,
  owner_id    uuid references public.profiles(id),
  position    double precision not null default 1024,
  archived_at timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint boards_team_scope    check ((scope = 'team')    = (team_id  is not null)),
  constraint boards_private_scope check ((scope = 'private') = (owner_id is not null))
);
create index if not exists idx_boards_org on public.boards(org_id, scope);
drop trigger if exists trg_boards_updated on public.boards;
create trigger trg_boards_updated before update on public.boards
  for each row execute function public.set_updated_at();

create table if not exists public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null,
  color      text,
  position   double precision not null default 1024,
  is_done    boolean not null default false,
  wip_limit  int,
  created_at timestamptz not null default now(),
  unique (board_id, id)                              -- enables the composite FK from todos
);
create index if not exists idx_board_columns_board on public.board_columns(board_id, position);

-- ---------------------------------------------------------------------
-- todos: additive columns only (universal task engine)
-- ---------------------------------------------------------------------
alter table public.todos
  add column if not exists board_id    uuid references public.boards(id) on delete restrict,
  add column if not exists column_id   uuid,
  add column if not exists parent_id   uuid references public.todos(id) on delete cascade,
  add column if not exists priority    text not null default 'none'
      check (priority in ('none','low','medium','high','urgent')),
  add column if not exists position    double precision not null default 1024,
  add column if not exists start_date  date,
  add column if not exists rock_id     uuid references public.rocks(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id   uuid;

-- composite FK: a column always belongs to its board (invariant M)
do $$ begin
  alter table public.todos
    add constraint todos_board_col_fk
    foreign key (board_id, column_id) references public.board_columns(board_id, id);
exception when duplicate_object then null; end $$;

create index if not exists idx_todos_board  on public.todos(board_id, column_id, position);
create index if not exists idx_todos_rock   on public.todos(rock_id);
create index if not exists idx_todos_parent on public.todos(parent_id);

-- ---------------------------------------------------------------------
-- entity_links: generic interconnection graph (Related panel)
-- ---------------------------------------------------------------------
create table if not exists public.entity_links (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  from_type  text not null, from_id uuid not null,
  to_type    text not null, to_id   uuid not null,
  relation   text not null default 'relates_to'
    check (relation in ('relates_to','blocks','duplicate','converted_from')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, relation)
);
create index if not exists idx_entity_links_from on public.entity_links(org_id, from_type, from_id);
create index if not exists idx_entity_links_to   on public.entity_links(org_id, to_type, to_id);

-- =====================================================================
-- RPCs (security definer, is_org_member-guarded)
-- =====================================================================

-- Default task board per org (idempotent) -----------------------------
create or replace function public.ensure_default_task_board(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_board uuid;
begin
  if not public.is_org_member(p_org) then raise exception 'not a member'; end if;
  select id into v_board from public.boards
    where org_id = p_org and scope = 'org' and type = 'task' order by position limit 1;
  if v_board is not null then return v_board; end if;

  insert into public.boards (org_id, name, scope, type, created_by)
  values (p_org, 'Tasks', 'org', 'task', auth.uid())
  returning id into v_board;

  insert into public.board_columns (org_id, board_id, name, position, is_done, color) values
    (p_org, v_board, 'To Do',       1024, false, '#8A8A90'),
    (p_org, v_board, 'In Progress', 2048, false, '#5A5AF0'),
    (p_org, v_board, 'In Review',   3072, false, '#C77D0A'),
    (p_org, v_board, 'Done',        4096, true,  '#1F9E6E');
  return v_board;
end $$;

-- Board-scoped default column (first non-done) ------------------------
create or replace function public.default_column(p_board uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.board_columns
  where board_id = p_board order by is_done asc, position asc limit 1;
$$;

-- =====================================================================
-- Triggers — single source of truth
-- =====================================================================

-- (D + B0) reconcile done <-> column.is_done; fill defaults. BEFORE, no recursion.
create or replace function public.sync_todo_done()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_is_done boolean; v_first_done uuid; v_first_todo uuid;
begin
  -- B0: ensure a board + column always exist
  if new.board_id is null then
    new.board_id := public.ensure_default_task_board(new.org_id);
  end if;
  if new.column_id is null then
    new.column_id := public.default_column(new.board_id);
  end if;

  if tg_op = 'INSERT' or new.column_id is distinct from old.column_id then
    -- column-driven: done follows the (possibly new) column
    select is_done into v_is_done from public.board_columns where id = new.column_id;
    new.done := coalesce(v_is_done, false);
  elsif new.done is distinct from old.done then
    -- checkbox-driven: move to a matching column
    if new.done then
      select id into v_first_done from public.board_columns
        where board_id = new.board_id and is_done order by position limit 1;
      if v_first_done is null then
        new.done := old.done;                 -- B3: no done column -> refuse (no drift)
      else
        new.column_id := v_first_done;
      end if;
    else
      select id into v_first_todo from public.board_columns
        where board_id = new.board_id and not is_done order by position limit 1;
      new.column_id := coalesce(v_first_todo, new.column_id);
    end if;
  end if;

  if new.done and (tg_op = 'INSERT' or old.done is distinct from true) then
    new.done_at := coalesce(new.done_at, now());
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_todo_done on public.todos;
create trigger trg_sync_todo_done before insert or update on public.todos
  for each row execute function public.sync_todo_done();

-- (R) recompute rock progress/status from milestones -------------------
create or replace function public.recompute_rock_progress(p_rock uuid)
returns void language sql security definer set search_path = public as $$
  update public.rocks r set
    progress = coalesce((
      select round(100.0 * count(*) filter (where m.done) / nullif(count(*),0))::int
      from public.milestones m where m.rock_id = r.id), r.progress),
    status = case
      when (select count(*) > 0 and count(*) filter (where m.done) = count(*)
            from public.milestones m where m.rock_id = r.id) then 'complete'::rock_status
      when r.status = 'complete' then 'on_track'::rock_status   -- fell below 100 -> un-complete
      else r.status end
  where r.id = p_rock;
$$;

create or replace function public.milestone_recompute_rock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_rock_progress(coalesce(new.rock_id, old.rock_id));
  return coalesce(new, old);
end $$;
drop trigger if exists trg_milestone_recompute on public.milestones;
create trigger trg_milestone_recompute after insert or update or delete on public.milestones
  for each row execute function public.milestone_recompute_rock();

-- (milestone<-task) completing a converted task marks its milestone done
create or replace function public.todo_completes_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source_type = 'milestone' and new.source_id is not null
     and new.done is distinct from old.done then
    update public.milestones set done = new.done,
           done_at = case when new.done then now() else null end
    where id = new.source_id and done is distinct from new.done;
  end if;
  return new;
end $$;
drop trigger if exists trg_todo_completes_milestone on public.todos;
create trigger trg_todo_completes_milestone after update on public.todos
  for each row execute function public.todo_completes_milestone();

-- (B1 + B2) protect columns on delete: keep >=1, reassign tasks --------
create or replace function public.protect_board_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sibling uuid;
begin
  if (select count(*) from public.board_columns where board_id = old.board_id) <= 1 then
    raise exception 'a board must keep at least one column';
  end if;
  select id into v_sibling from public.board_columns
    where board_id = old.board_id and id <> old.id order by position limit 1;
  update public.todos set column_id = v_sibling where column_id = old.id;
  return old;
end $$;
drop trigger if exists trg_protect_board_columns on public.board_columns;
create trigger trg_protect_board_columns before delete on public.board_columns
  for each row execute function public.protect_board_columns();

-- =====================================================================
-- convert_entity: atomic conversion (task + denormalized cols + link)
-- =====================================================================
create or replace function public.convert_entity(
  p_from_type text, p_from_id uuid, p_to_board uuid default null, p_column uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_board uuid; v_col uuid; v_title text; v_owner uuid; v_task uuid; v_rock uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if p_from_type = 'issue' then
    select org_id, title, owner_id into v_org, v_title, v_owner from public.issues where id = p_from_id;
  elsif p_from_type = 'milestone' then
    select org_id, title, rock_id into v_org, v_title, v_rock from public.milestones where id = p_from_id;
  else
    raise exception 'unsupported from_type %', p_from_type;
  end if;
  if v_org is null then raise exception 'source not found'; end if;
  if not public.is_org_member(v_org) then raise exception 'not a member'; end if;

  v_board := coalesce(p_to_board, public.ensure_default_task_board(v_org));
  v_col   := coalesce(p_column, public.default_column(v_board));

  insert into public.todos (org_id, board_id, column_id, title, owner_id, created_by,
                            rock_id, source_type, source_id)
  values (v_org, v_board, v_col, v_title, coalesce(v_owner, auth.uid()), auth.uid(),
          v_rock, p_from_type, p_from_id)
  returning id into v_task;

  insert into public.entity_links (org_id, from_type, from_id, to_type, to_id, relation, created_by)
  values (v_org, 'task', v_task, p_from_type, p_from_id, 'converted_from', auth.uid())
  on conflict do nothing;

  return v_task;   -- NOTE: issues intentionally stay 'open' (user decision)
end $$;

-- manual relate helper -------------------------------------------------
create or replace function public.link_entities(
  p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_relation text default 'relates_to')
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.org_id_of(p_from_type, p_from_id);
  if v_org is null or not public.is_org_member(v_org) then raise exception 'not allowed'; end if;
  insert into public.entity_links (org_id, from_type, from_id, to_type, to_id, relation, created_by)
  values (v_org, p_from_type, p_from_id, p_to_type, p_to_id, p_relation, auth.uid())
  on conflict do nothing;
end $$;

-- resolve org_id for a polymorphic entity (used by link helpers) -------
create or replace function public.org_id_of(p_type text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_type
    when 'task'      then select org_id into v from public.todos     where id = p_id;
    when 'issue'     then select org_id into v from public.issues    where id = p_id;
    when 'milestone' then select org_id into v from public.milestones where id = p_id;
    when 'rock'      then select org_id into v from public.rocks     where id = p_id;
    else v := null;
  end case;
  return v;
end $$;

-- =====================================================================
-- Backfill existing todos onto the org default board
-- =====================================================================
do $$
declare o record; v_board uuid; v_done uuid; v_todo uuid;
begin
  for o in select distinct org_id from public.todos where board_id is null loop
    -- create default board directly (can't use auth.uid() here)
    select id into v_board from public.boards
      where org_id = o.org_id and scope='org' and type='task' order by position limit 1;
    if v_board is null then
      insert into public.boards (org_id, name, scope, type) values (o.org_id,'Tasks','org','task')
        returning id into v_board;
      insert into public.board_columns (org_id, board_id, name, position, is_done, color) values
        (o.org_id, v_board, 'To Do',1024,false,'#8A8A90'),
        (o.org_id, v_board, 'In Progress',2048,false,'#5A5AF0'),
        (o.org_id, v_board, 'In Review',3072,false,'#C77D0A'),
        (o.org_id, v_board, 'Done',4096,true,'#1F9E6E');
    end if;
    select id into v_done from public.board_columns where board_id=v_board and is_done order by position limit 1;
    select id into v_todo from public.board_columns where board_id=v_board and not is_done order by position limit 1;
    update public.todos set board_id = v_board,
           column_id = case when done then v_done else v_todo end
      where org_id = o.org_id and board_id is null;
  end loop;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.boards enable row level security;
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select using (
  public.is_org_member(org_id) and (
    scope = 'org'
    or (scope = 'team'    and team_id in (select tm.team_id from public.team_members tm where tm.profile_id = auth.uid()))
    or (scope = 'private' and owner_id = auth.uid())
  ));
drop policy if exists boards_write on public.boards;
create policy boards_write on public.boards for all using (
  public.is_org_member(org_id) and (owner_id = auth.uid() or created_by = auth.uid() or public.has_min_role(org_id,'manager'))
) with check ( public.is_org_member(org_id) );

alter table public.board_columns enable row level security;
drop policy if exists board_columns_rw on public.board_columns;
create policy board_columns_rw on public.board_columns for all using (
  exists (select 1 from public.boards b where b.id = board_id and (
    b.scope = 'org'
    or (b.scope = 'team'    and b.team_id in (select tm.team_id from public.team_members tm where tm.profile_id = auth.uid()))
    or (b.scope = 'private' and b.owner_id = auth.uid())))
) with check ( public.is_org_member(org_id) );

-- todos: replace select policy so board scope drives visibility (P)
drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos for select using (
  public.is_org_member(org_id) and (
    owner_id = auth.uid() or created_by = auth.uid()
    or exists (select 1 from public.boards b where b.id = todos.board_id and (
        b.scope = 'org'
        or (b.scope = 'team' and b.team_id in (select tm.team_id from public.team_members tm where tm.profile_id = auth.uid()))))
  ));

alter table public.entity_links enable row level security;
drop policy if exists entity_links_sel on public.entity_links;
create policy entity_links_sel on public.entity_links for select using ( public.is_org_member(org_id) );
drop policy if exists entity_links_wr on public.entity_links;
create policy entity_links_wr on public.entity_links for all
  using ( public.is_org_member(org_id) ) with check ( public.is_org_member(org_id) );

-- team_members index for the scope subqueries
create index if not exists idx_team_members_profile on public.team_members(profile_id);

-- realtime
do $$ begin alter publication supabase_realtime add table public.boards; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.board_columns; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.entity_links; exception when duplicate_object then null; end $$;
