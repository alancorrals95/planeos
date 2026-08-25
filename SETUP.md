# PlanEOS · Setup rápido

## 1) Base de datos (una vez)
En **Supabase → SQL Editor**, ejecuta en orden:
`supabase/migrations/0001_core.sql` → `0002_eos.sql` → `0005_chat.sql` → `0100_rls.sql`
Detalle: [`supabase/README.md`](supabase/README.md).

**Auth (dev):** Authentication → Providers → Email → **Confirm email = OFF**.
**Auth → URL Configuration → Redirect URLs:** agrega `http://localhost:8888/planeos/app/**` (ajusta el puerto de tu MAMP).

## 2) Configuración
Copia `app/config/env.example.js` a `app/config/env.js` y pon tu proyecto:
```
SUPABASE_URL = https://YOUR-PROJECT.supabase.co
SUPABASE_KEY = sb_publishable_...   (clave pública; la seguridad la da RLS)
```

## 3) Abrir
Con MAMP corriendo:
- **App:**   `http://localhost:8888/planeos/app/`
- **Sitio:** `http://localhost:8888/planeos/site/`

## 4) Primer uso
1. Crear cuenta (signup) → onboarding → nombra tu organización.
2. Entra al Dashboard. Crea tareas, rocas, KPIs.
3. **Ajustes → Miembros** → invita (copia el enlace `?token=` y ábrelo con otra cuenta).
4. Prueba el **Chat** con dos usuarios/pestañas para ver el tiempo real.

## Prueba de aislamiento multi-tenant
Crea dos organizaciones con dos usuarios distintos; verifica que el usuario A **no** ve datos de la org B (lo garantiza RLS + `is_org_member`).
