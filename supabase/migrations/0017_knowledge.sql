-- =====================================================================
-- CIIN — Capture agent: knowledge items + rule reviews
-- The capture agent (Edge Function, SERVICE ROLE) mines batch/mission evidence
-- ACROSS orgs — the one thing no human can do, because RLS scopes humans to
-- their own org. It writes:
--   knowledge_items  — patterns/insights, each with PROVENANCE and a k-anonymity
--                      floor (org_count >= K); never identifies a single org.
--   rule_reviews     — agent-PROPOSED grading-rule reviews; Kimberly decides.
--                      The agent NEVER writes grading_rules directly.
-- =====================================================================

create type provenance_tier as enum ('measured', 'operator_stated', 'agent_inferred');
create type review_state as enum ('proposed', 'accepted', 'rejected');

-- Aggregate knowledge — readable by any authenticated user (it's the public
-- good), but rows only ever hold aggregates above the k floor (enforced by the
-- agent on write; see K in the Edge Function).
create table knowledge_items (
  id           uuid primary key default gen_random_uuid(),
  country_code text,                         -- scope of the pattern (may be null = regional)
  topic        text not null,                -- e.g. 'foreign_matter_high_energy_beach'
  headline     text not null,                -- the pattern, in words
  provenance   provenance_tier not null default 'agent_inferred',
  org_count    int not null,                 -- how many orgs the pattern draws on (k-anon)
  sample_n     int not null,                 -- number of records behind it
  detail       jsonb,                        -- structured supporting numbers (aggregate only)
  created_at   timestamptz not null default now()
);

-- Agent-proposed rule reviews (the standards-audit loop). Kimberly/platform
-- admin accepts or rejects; acceptance does NOT auto-edit grading_rules — a human
-- makes that change, versioned, separately.
create table rule_reviews (
  id            uuid primary key default gen_random_uuid(),
  dimension     text not null,               -- which grading dimension
  band          text,                        -- which band, if specific
  finding       text not null,               -- what the evidence shows
  proposal      text not null,               -- suggested review action
  evidence_n    int not null,                -- sample behind the finding
  org_count     int not null,                -- k-anon
  state         review_state not null default 'proposed',
  decided_by    uuid references profiles (id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

alter table knowledge_items enable row level security;
alter table rule_reviews    enable row level security;

-- Read: any authenticated user sees the aggregate knowledge + reviews (public good).
create policy know_read   on knowledge_items for select using (auth.uid() is not null);
create policy review_read on rule_reviews    for select using (auth.uid() is not null);

-- Write to knowledge_items / rule_reviews.state: NONE via normal RLS.
-- The capture agent writes with the service role (bypasses RLS). Platform admin
-- may update a review's decision (accept/reject).
create policy review_decide on rule_reviews for update
  using (is_platform_admin()) with check (is_platform_admin());
