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
