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
