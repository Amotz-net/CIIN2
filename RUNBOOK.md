# CIIN — Stage 1 Deployment Runbook (walk-through)

This walks you through getting the app **live on the internet** with working
sign-in, organizations, and invitations. It assumes you have **not** done this
before. Follow it top to bottom. Each step says what to do and *why*.

You will use three free services:
- **GitHub** — stores your code.
- **Supabase** — your database + authentication (the "backend").
- **Vercel** — hosts the website (the "frontend").

Rough time: 60–90 minutes the first time. Nothing here costs money at this scale.

> Legend: 🔵 = do this in a browser dashboard · 💻 = do this on your computer

---

## Part 0 — Install two tools on your computer (once)

You need **Node.js** (to run the app locally) and **Git** (to push code to GitHub).

1. 💻 Install Node.js LTS from https://nodejs.org (the big green button). Accept defaults.
2. 💻 Install Git from https://git-scm.com/downloads. Accept defaults.
3. 💻 Confirm both work — open a terminal (Mac: Terminal app · Windows: "Git Bash" that just installed) and run:
   ```
   node -v
   git --version
   ```
   Each should print a version number. If they do, you're set.

---

## Part 1 — Create the Supabase project 🔵

1. Go to https://supabase.com and sign up (free).
2. Click **New project**. Give it a name (e.g. `ciin`), set a strong **database password** (save it somewhere safe), pick the region closest to the Caribbean (e.g. US East). Create it. Wait ~2 minutes for it to provision.
3. When it's ready, go to **Project Settings → API**. You'll see two values you need shortly:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)
   Keep this tab open.

> Why the anon key is safe to put in the website: your data is protected by
> Row-Level Security *inside* the database (Part 3). The anon key can only do
> what those rules allow.

---

## Part 2 — Create the database tables 🔵

1. In Supabase, open the **SQL Editor** (left sidebar).
2. Open the file `supabase/migrations/0001_init.sql` from this repo, copy **all** of it, paste into the SQL editor, click **Run**. You should see "Success."
3. Do the same with `0002_rls.sql` (this turns on the security rules). Run it.
4. Do the same with `0003_seed.sql` (creates the CIIN org). Run it.
4. Do the same with `0004_approval.sql` (approval audit + live-approval gating). Run it.

If any step errors, read the message — usually it means a previous step didn't run. Re-run them in order 0001 → 0002 → 0003.

---

## Part 3 — Turn on email/password sign-in 🔵

1. In Supabase go to **Authentication → Providers → Email**. Make sure **Email** is enabled.
2. For first-time setup, turn **"Confirm email" OFF** (Authentication → Providers → Email → toggle off "Confirm email"). This lets you and your first testers sign in immediately without clicking a confirmation link. *(Turn it back on before real launch.)*
3. Go to **Authentication → URL Configuration**. Set **Site URL** to `http://localhost:5173` for now (you'll change it to your live URL in Part 7).

---

## Part 4 — Run the app on your own computer 💻

1. Download this repo to your computer (if you're reading this inside it, you already have it). In a terminal, `cd` into the project folder (the one with `package.json`).
2. Install the app's dependencies:
   ```
   npm install
   ```
3. Create your local settings file. Copy `.env.example` to `.env.local`:
   ```
   cp .env.example .env.local
   ```
   Open `.env.local` in any text editor and paste in the two values from Part 1:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   ```
4. Start it:
   ```
   npm run dev
   ```
   It prints a local address, usually `http://localhost:5173`. Open that in your browser. You should see the CIIN sign-in screen.

---

## Part 5 — Make yourself the platform admin 🔵💻

The very first account has to be created, then promoted by hand (there's no one to invite you yet).

1. Create your account: the app is invite-only, so use Supabase to make the first user. Go to **Authentication → Users → Add user → Create new user**. Enter your email and a password. Create it.
2. Copy that user's **UUID** (the long id shown in the Users list).
3. That user needs a profile row. Easiest path: in the SQL Editor, run (replace both placeholders):
   ```sql
   insert into profiles (id, full_name, org_id, level, is_platform_admin)
   values (
     'PASTE-USER-UUID-HERE',
     'CIIN Administrator',
     (select id from organizations where name = 'CIIN Platform' limit 1),
     'org_admin',
     true
   );
   ```
4. Now go back to the app at `http://localhost:5173`, sign in with that email/password. You should land on the dashboard and see a **platform admin** badge, with a "Platform admin — organizations" button.

---

## Part 6 — Test the whole invite chain 💻

This proves the multi-tenant spine works end to end.

1. As platform admin, click **Platform admin — organizations**.
2. Create an organization (e.g. "Long Bay Beach Resort", role `hotel`, country `JM`) and enter an **org-admin email** (use a second email you can access, or a `+test` alias like `you+hotel@gmail.com`). Click **Create & generate invite**.
3. Copy the invite link it shows. Open it in a **private/incognito window** (so you're not logged in as admin).
4. Fill in the name + a password → **Create account & enter**. You're now signed in as the hotel's org-admin, seeing only that org.
5. Go to **Invite & manage team**, invite a `member`, copy that link, open in another incognito window, accept it. That member sees only the hotel org too.

If all of that worked, Stage 1 is proven: invite-only access, organizations, and data isolation are live.

---

## Part 7 — Put it on the internet (GitHub + Vercel) 🔵💻

1. 🔵 Create a new **empty** repository on GitHub (github.com → New repository). Don't add a README (this repo has one). Copy its URL.
2. 💻 In your project folder:
   ```
   git init
   git add .
   git commit -m "CIIN Stage 1: auth, organizations, invites, RLS"
   git branch -M main
   git remote add origin YOUR-GITHUB-REPO-URL
   git push -u origin main
   ```
   Refresh GitHub — your code is there. (`.env.local` is NOT uploaded — `.gitignore` protects it. Good.)
3. 🔵 Go to https://vercel.com, sign up **with your GitHub account**. Click **Add New → Project**, pick your `ciin` repo, click **Import**.
4. 🔵 Before deploying, open **Environment Variables** and add the same two values from your `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Then click **Deploy**. In ~1 minute you get a live URL like `https://ciin.vercel.app`.
5. 🔵 Back in **Supabase → Authentication → URL Configuration**, change **Site URL** to your new Vercel URL, and add it to **Redirect URLs**. This makes invite links point at the live site.

Done — CIIN Stage 1 is live on the internet.

---

## When you'll want a hand

These are the spots first-timers most often get stuck. Not scary, just flag them:
- **A migration errors and you're not sure why** — copy the exact red message; it usually names the line.
- **Sign-in "works" but the dashboard is blank** — almost always a missing profile row (Part 5) or the env vars not set in Vercel (Part 7.4).
- **Invite link says "not valid"** — the token expired (14 days) or was already used; generate a fresh one.
- **Before real launch** — turn email confirmation back ON (Part 3.2), and consider automated invite emails (a later stage).

If any of these blocks you for more than a few minutes, that's a reasonable moment to bring in a developer for an hour — you'll have done 95% of it.

---

## What this Stage does and doesn't do

**Does:** real accounts, invite-only onboarding, organizations, the two-level admin
model, and row-level security so each org sees only its own data. This is the
production-grade foundation everything else builds on.

**Doesn't yet:** role dashboards (risk scores, alerts, missions), reporting,
economics, the regional network, and automated emails. Those are Stages 2–7 in
the Master Build Specification, and they sit on top of exactly this spine.

---

## Troubleshooting: 404 on an invite link (or any page refresh) after deploying

If a link like `your-app.vercel.app/accept?token=…` shows a **404** on Vercel,
that's the single-page-app routing issue, not a code bug. The repo includes
`vercel.json` which tells Vercel to serve `index.html` for every path and let
the app handle routing. If you deployed *before* that file existed, just push
again (`git add vercel.json && git commit -m "SPA rewrites" && git push`) —
Vercel redeploys and the 404 clears. No database or code change needed.

---

## Stage 2 — Hotel dashboard (run after Stage 1 is working)

Stage 2 adds the Hotel operational data layer and wires the hotel dashboard,
plus a live NOAA weather panel.

1. In the Supabase **SQL Editor**, run these new migrations in order:
   - `0005_hotel_ops.sql` (operational tables: beach segments, arrivals, missions, hub pools, load summaries)
   - `0006_hotel_rls.sql` (row-level security — org-scoped, approval-gated)
   - `0007_hotel_seed.sql` (representative data for your hotel org — it auto-finds the first hotel org; edit the lookup if you have several)
2. Sign in as a member of an **approved hotel org**. The dashboard now shows:
   - **Incoming sargassum** (labelled *representative*)
   - **Weather** — a genuinely **live** NOAA `api.weather.gov` forecast for your beach segment's coordinates (US/territory coasts; other Caribbean coasts may show "unavailable")
   - **Missions** against the property with the responding hub pool
   - **Grade & closure**, and **avoided cost**
3. Every data point is tagged **live / representative / computed** so nothing fixture is mistaken for a live feed.

Notes:
- NOAA coverage is strongest for US/US-territory coasts. For a non-US Caribbean beach the weather panel honestly shows "unavailable for this location" rather than faking it.
- To point weather at a real covered coast for a demo, set a beach segment's lat/lng to a US/territory coordinate (e.g. San Juan PR: 18.47, -66.10).

---

## Stage 2+ — security fix, grading engine, satellite feed

Three additions. Run the new migrations in the Supabase SQL Editor in order:

1. `0009_fix_profile_insert.sql` — **security fix**: closes a privilege-escalation
   gap where a user accepting an invite could self-grant platform-admin or attach
   to an org they weren't invited to. A BEFORE INSERT trigger now enforces both.
2. `0010_grading_config.sql` — the **rules-config table** (grading_rules +
   grading_policy) with the recommended DRAFT bands seeded, each carrying value,
   unit, citation, and draft/verified status. The grading engine reads from here,
   so bands are editable without a code change. Flip status to 'verified' once
   Kimberly signs off the A/B/C cutoffs.
3. (code) The **grading engine** (`src/lib/grading.js`) reads that config;
   grades computed on draft rules are labelled "computed (draft)". The
   **satellite feed** (`src/lib/satellite.js`) pulls live NOAA CoastWatch AFAI —
   free, no key — showing sargassum detection, with honest coverage gaps.

After running 0009–0010, push the code (git add/commit/push) so Vercel rebuilds
with the grading engine and the satellite panel.

Notes:
- Satellite AFAI is a reflectance index, not ground truth; it saturates under
  cloud/glint/dust, so the panel shows an honest "no clear read" gap rather than
  interpolating. Attribution (USF/NOAA) renders on the panel as required.
- To edit grading bands later: update rows in the grading_rules table (platform
  admin only) and set status='verified' when confirmed.
