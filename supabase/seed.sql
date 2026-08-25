-- =====================================================================
-- PlanEOS · seed.sql (OPTIONAL demo data)
-- Run AFTER you have signed up and created an organization in the app.
-- Replace :ORG with your org id and :ME with your profile/user id.
--   select id, name from public.organizations;          -- get :ORG
--   select id, full_name from public.profiles;           -- get :ME
-- Then set the two variables below.
-- =====================================================================
\set ORG '00000000-0000-0000-0000-000000000000'
\set ME  '00000000-0000-0000-0000-000000000000'

-- KPIs -----------------------------------------------------------------
insert into public.kpis (org_id, owner_id, name, unit, goal_operator, goal, period, position, created_by) values
  (:'ORG', :'ME', 'Sales Meetings Generated', '#', 'gte', 31, 'weekly', 1, :'ME'),
  (:'ORG', :'ME', 'Revenue', '$', 'gte', 40000, 'weekly', 2, :'ME'),
  (:'ORG', :'ME', 'Churn Rate', '%', 'lte', 2.5, 'weekly', 3, :'ME');

-- Rocks + milestones ---------------------------------------------------
with r as (
  insert into public.rocks (org_id, owner_id, title, quarter, status, progress, is_company_rock, created_by)
  values (:'ORG', :'ME', 'Launch onboarding v2', to_char(now(),'YYYY')||'-Q'||to_char(extract(quarter from now()),'FM9'), 'on_track', 60, true, :'ME')
  returning id)
insert into public.milestones (org_id, rock_id, title, position, done)
select :'ORG', r.id, m.t, m.p, m.d from r, (values ('Spec',0,true),('Build',1,true),('Ship',2,false)) as m(t,p,d);

-- To-Dos ---------------------------------------------------------------
insert into public.todos (org_id, owner_id, title, due_date, created_by) values
  (:'ORG', :'ME', 'Review website process', current_date + 2, :'ME'),
  (:'ORG', :'ME', 'Follow up with clients', current_date - 1, :'ME'),
  (:'ORG', :'ME', 'Update marketing calendar', current_date + 4, :'ME');

-- Channel --------------------------------------------------------------
insert into public.channels (org_id, name, kind, topic, created_by)
values (:'ORG', 'random', 'public', 'Off-topic', :'ME')
on conflict do nothing;
