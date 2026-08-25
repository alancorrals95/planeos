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
