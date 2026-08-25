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
