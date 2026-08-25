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
