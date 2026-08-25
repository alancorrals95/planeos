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
