# PlanEOS · Supabase setup

Your project: `YOUR-PROJECT` — https://YOUR-PROJECT.supabase.co

## 1. Apply the schema

Open the **Supabase dashboard → SQL Editor** and run these files **in order** (copy‑paste each, run, then the next):

1. `migrations/0001_core.sql` — profiles, organizations, members, invites, teams, helpers, RPCs, new‑user trigger
2. `migrations/0002_eos.sql` — rocks, milestones, todos, kpis, kpi_scores, issues
3. `migrations/0003_meetings.sql` — meetings, agendas, notes (+RLS)
4. `migrations/0004_crm.sql` — companies, contacts, pipelines, stages, deals, activities (+RLS)
5. `migrations/0005_chat.sql` — channels, channel_members, messages, reactions + DM RPC
6. `migrations/0006_time.sql` — projects, time_entries (Toggl) (+RLS)
7. `migrations/0008_misc.sql` — headlines, vision (VTO), knowledge, notifications (+RLS)
8. `migrations/0100_rls.sql` — **Row Level Security** for core/eos/chat tables
9. `migrations/0101_fix_pgcrypto.sql` — pgcrypto search_path fix (safe, run last)

> Tables in 0003/0004/0006/0008 include their own RLS. If you already ran the earlier set, just run the new files (0003, 0004, 0006, 0008) plus 0101.

> All files are idempotent (safe to re‑run). `0100_rls.sql` also adds the chat/todos/rocks/kpi tables to the `supabase_realtime` publication so live updates work.

## 2. Auth settings (for smooth testing)

**Authentication → Providers → Email**: during development, turn **"Confirm email" OFF** so `signUp` returns a session immediately and the app goes straight to onboarding. (In production, leave it ON — the signup screen already handles the "check your email" case.)

**Authentication → URL Configuration**: add your local app origin to **Redirect URLs**, e.g.
`http://localhost:8888/planeos/app/**` (adjust host/port to your MAMP setup).

## 3. Verify

Supabase dashboard → **Table Editor** should show all tables. **Advisors → Security** should report RLS enabled on every table.

## What each RPC does
- `create_organization(p_name)` → creates the org + your `owner` membership + a Leadership team (atomic; bypasses RLS safely).
- `accept_invite(p_token)` → joins the org for an invite link.
- `get_or_create_dm(p_org, p_other)` → returns (or creates) a 1:1 DM channel.

## Optional: seed sample data
After you've signed up and created an org, you can load demo rows — see `seed.sql` (replace the placeholder org id).
