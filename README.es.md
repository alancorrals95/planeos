# PlanEOS

**El sistema operativo para tu empresa** — EOS (estilo ninety.io) + CRM + Chat (Slack) + Reuniones en vivo + Time Tracking, en una sola app minimalista, responsiva y bilingüe (ES/EN).

[English](README.md) · [Español](README.es.md)

Stack: **HTML + CSS + JavaScript vanilla** (sin framework, sin build) + **Supabase** (Postgres, Auth, Realtime, RLS).

## Estructura

```
planeos/
├── site/          → planeos.io   · sitio marketing (hero, features, pricing)
├── app/           → app.planeos.io · la aplicación
│   ├── config/env.js          · URL + key de Supabase (públicas; seguridad = RLS)
│   ├── assets/css/            · tokens, base, layout, components, modules
│   ├── assets/icons/sprite.svg· iconos (Lucide, sprite inline)
│   ├── js/core/               · supabaseClient, auth, orgContext, api, realtime, i18n, plan, dom…
│   ├── js/components/         · appShell, sidebar, modal, avatar
│   ├── js/pages/              · un controlador por módulo
│   ├── js/i18n/               · es.json, en.json
│   └── pages/                 · un HTML por módulo (auth, dashboard, todos, rocks, scorecard, chat, directory, settings…)
└── supabase/
    ├── migrations/  0001_core · 0002_eos · 0005_chat · 0100_rls
    ├── README.md    · pasos para aplicar el schema
    └── seed.sql     · datos demo opcionales
```

## Puesta en marcha (3 pasos)

1. **Base de datos** — aplica las migraciones en tu proyecto Supabase. Ver [`supabase/README.md`](supabase/README.md). En dev, desactiva "Confirm email" en Auth para un signup fluido.
2. **Servir** — la carpeta ya vive en MAMP (`htdocs/planeos`). Abre:
   - App:  `http://localhost:8888/planeos/app/`
   - Sitio: `http://localhost:8888/planeos/site/`
   (ajusta el puerto al de tu MAMP; el código resuelve rutas automáticamente).
3. **Usa** — crea cuenta → crea tu organización → dashboard. Invita miembros desde **Ajustes → Miembros** (genera enlace de invitación).

## Qué funciona hoy (Fase 1 · slice vertical funcional)

- **Auth + multi‑tenant + roles** (owner/admin/manager/member) con RLS estricto.
- **Dashboard "My 90"** — mis rocas, mis tareas, snapshot de scorecard, tareas de equipo.
- **Tareas** — equipo + privadas, responsables, fechas, tiempo real.
- **Rocas** — metas trimestrales con hitos, progreso y estados; drawer de detalle.
- **Scorecard** — grid de KPIs semanal editable con celdas verde/rojo.
- **Chat** — canales públicos + DMs, mensajes en tiempo real.
- **Directorio** y **Ajustes** (org, miembros/invitaciones/roles, perfil, billing preview).
- **i18n ES/EN**, tema claro/oscuro, totalmente responsivo (drawer + bottom tabs en móvil).
- **Sitio marketing** con pricing mensual/anual.

## Siguientes fases (planeadas)

- **Fase 2** — Stripe (Free + Pro $19/usuario, mensual/anual) vía Edge Functions + webhooks; gating por plan en DB.
- **Fase 3** — Time Tracking (Toggl): proyectos, cronómetro global, reportes facturables.
- **Fase 4** — Issues/Ideas (IDS) + Meetings en vivo (agenda colaborativa por presence).
- **Fase 5** — CRM (contactos, empresas, deals kanban, actividades).
- **Fase 6** — Vision/VTO, Org Chart, 1‑a‑1, Knowledge Base, Notificaciones.

Ver el plan completo en el archivo de plan de la sesión.
