# PlanEOS

**An operating system for a small company: EOS-style goal tracking, CRM, chat,
live meetings and time tracking — in one bilingual app with no build step.**

[English](README.md) · [Español](README.es.md)

[![CI](https://github.com/alancorrals95/planeos/actions/workflows/ci.yml/badge.svg)](https://github.com/alancorrals95/planeos/actions/workflows/ci.yml)
![vanilla](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)
![build](https://img.shields.io/badge/build%20step-none-lightgrey)

---

## What it does

| Module | What it covers |
|---|---|
| **EOS** | Rocks, to-dos, scorecard, VTO, headlines |
| **CRM** | Companies, contacts, pipelines, deals, activities |
| **Chat** | Slack-style channels and DMs, realtime |
| **Meetings** | Live agenda, shared notes, attendees |
| **Time** | Toggl-style projects and time entries |
| **Boards** | Kanban, scoped per organisation or team |

Bilingual (Spanish/English) throughout, light and dark themes, responsive.

## Architecture

**No framework and no build step.** ES modules served directly, a Supabase project
behind them. You clone it, point it at a database, and open the folder.

```
site/                marketing site
app/
  config/env.js      Supabase URL + publishable key
  js/core/           supabaseClient, auth, orgContext, api, realtime, i18n
  js/components/     appShell, sidebar, modal, kanban, taskDrawer
  js/pages/          one controller per module
  js/i18n/           es.json, en.json
  pages/             one HTML file per module
supabase/
  migrations/        0001_core → 0100_rls
  full_schema.sql    everything in one file
  seed.sql           optional demo data
```

### Why no framework

The app is a set of largely independent screens over a REST/realtime API. A build
step would add a toolchain, a lockfile and a deploy artefact without changing what
any screen does. Native ES modules cover the actual need: real imports, real code
splitting by page, and a file you can edit and reload.

The trade-off is real — no JSX, no reactive rendering, and DOM updates are written by
hand in `js/core/dom.js`. For an app of this size that was a worthwhile trade; for a
larger one it would not be.

## Security model

**Every table has Row Level Security enabled — 34 of 34.** Authorisation lives in
Postgres policies, not in the client.

```sql
create policy crm_contacts_sel on public.crm_contacts
  for select using (public.is_org_member(org_id));

create policy crm_contacts_wr on public.crm_contacts
  for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
```

This is why the Supabase key in `env.js` is publishable and safe to ship to the
browser: it identifies the project, it doesn't grant access. Access is decided per
row, per request, by `is_org_member(org_id)`.

`is_org_member` is a `security definer` helper so that membership lookups don't
re-enter the policies that call them — without that, org-membership checks recurse.

### Verify tenant isolation yourself

Create two organisations with two different users, then confirm user A cannot see
organisation B's data through the API, not just through the UI:

```bash
curl "$SUPABASE_URL/rest/v1/crm_contacts?select=*" \
  -H "apikey: $KEY" -H "Authorization: Bearer $USER_A_JWT"
```

Only org A's rows should come back. If a table ever returns everything, its policy is
missing — that's the check that matters.

## Setup

```bash
git clone https://github.com/alancorrals95/planeos.git
cd planeos

cp app/config/env.example.js app/config/env.js
$EDITOR app/config/env.js          # your Supabase URL + publishable key
```

Then, in the Supabase SQL editor, run `supabase/full_schema.sql` (or the migrations
in order). Full walkthrough in [SETUP.md](SETUP.md) and
[supabase/README.md](supabase/README.md).

Serve the folder with any static server:

```bash
python3 -m http.server 8888
# app  → http://localhost:8888/app/
# site → http://localhost:8888/site/
```

For development, turn **Confirm email** off under Authentication → Providers, and add
your local URL to Authentication → URL Configuration → Redirect URLs.

## Status

Functionally complete across all modules listed above. Billing (Stripe) is the
remaining piece, and there is no UI yet for creating teams beyond the leadership team
created automatically at signup.

## License

MIT — see [LICENSE](LICENSE).
