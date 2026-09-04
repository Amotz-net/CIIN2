# CIIN — Caribbean Sargassum Intelligence, Response & Recovery Network

Production application — **Stage 1: authentication, organizations, invitations, and
row-level security.** This is the multi-tenant foundation defined in the CIIN Master
Build Specification; later stages (role dashboards, alert engine, reporting,
economics, regional network) build on this spine.

## Stack
- **Frontend:** React + Vite, deployed on Vercel
- **Backend:** Supabase (Postgres + Auth + Row-Level Security)
- **Access model:** invite-only; no open sign-up; public verification needs no login

## What Stage 1 delivers
- Email/password authentication (Supabase Auth)
- **Organizations** — each a hotel, hub, processor, ministry, etc.; every user belongs to one
- **Two-level admin:** CIIN Platform Admin (super-user) → Organization Admin (invites their own team)
- **Invitation flow:** CIIN admin invites org-admins → org-admins invite members
- **Row-Level Security:** each org sees only its own data; platform admin sees all
- **Public verification** route (no login)

## Getting it running
See **[RUNBOOK.md](./RUNBOOK.md)** — a step-by-step, first-timer walk-through from
zero to live on the internet (Supabase → local dev → GitHub → Vercel).

Quick version for the experienced:
```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + anon key
npm run dev
```
Run the three SQL files in `supabase/migrations/` in order (0001 → 0002 → 0003) in
the Supabase SQL editor, then promote your first user to platform admin (see RUNBOOK Part 5).

## Repo structure
```
supabase/migrations/   0001 schema · 0002 row-level security · 0003 seed
src/lib/               supabase client · auth context
src/pages/             Login · AcceptInvite · Dashboard · AdminOrgs · Members · PublicVerify
src/components/        TopBar
```

## Security notes
- The Supabase **anon key** is safe in the browser because RLS enforces all access server-side.
- `.env.local` is git-ignored — real keys never reach GitHub. Set them in Vercel's env vars instead.
- A database trigger prevents non-admins from granting themselves platform-admin.
- Before real launch: re-enable email confirmation in Supabase Auth.

## Roadmap (from the Master Build Specification)
2. Grading engine (config-driven) + tests
3. Scoring + Dynamic Alert Engine
4. Eight role dashboards (scores, feed, use suggestions)
5. Reporting layer
6. Economic forecasting layer
7. Regional network (early warning + standards)
8. Push channels + live feeds

---
Water Solutions Technology · CIIN
