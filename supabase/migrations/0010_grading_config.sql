-- =====================================================================
-- CIIN — Stage 2 (0010): grading rules-config table
-- The decision note flagged this as "specified but does not exist in schema."
-- Each rule carries value, unit, citation, and draft/verified status so the
-- engine reads config (not hard-coded numbers) and the UI can show whether a
-- grade rests on a verified or draft ruleset. Editable after launch.
-- =====================================================================

create type rule_status as enum ('draft', 'verified');

create table grading_rules (
  id          uuid primary key default gen_random_uuid(),
  dimension   text not null,          -- 'arsenic_inorganic','arsenic_total','foreign_matter','age_hours'
  band        text not null,          -- 'A','B','C'
  op          text not null,          -- '<=','>','between'
  low         numeric,                -- lower bound (for 'between'/'>')
  high        numeric,                -- upper bound (for '<='/'between')
  unit        text not null,          -- 'mg/kg','%','h'
  citation    text,                   -- standard / basis
  status      rule_status not null default 'draft',
  updated_at  timestamptz not null default now(),
  unique (dimension, band)
);

-- Global grading policy knobs (also config).
create table grading_policy (
  id                    int primary key default 1,
  compounding_b_to_c    int not null default 3,      -- 3+ simultaneous B-breaches -> C
  arsenic_breaks_ties   boolean not null default true,
  closure_conforming    numeric not null default 15, -- |err| <= this = conforming
  closure_conditional   numeric not null default 30, -- <= this = conditional
  status                rule_status not null default 'draft',
  check (id = 1)
);

-- Only platform admin edits the ruleset; everyone authenticated may read it.
alter table grading_rules  enable row level security;
alter table grading_policy enable row level security;
create policy grules_read  on grading_rules  for select using (auth.uid() is not null);
create policy grules_write on grading_rules  for all using (is_platform_admin()) with check (is_platform_admin());
create policy gpol_read    on grading_policy for select using (auth.uid() is not null);
create policy gpol_write   on grading_policy for all using (is_platform_admin()) with check (is_platform_admin());

-- ---------- seed the recommended DRAFT bands (standards-grounded) ----------
-- Arsenic: EU 2002/32/EC — inorganic <=2 is the feed gate, total <=40 the seaweed ceiling.
insert into grading_rules (dimension, band, op, low, high, unit, citation, status) values
  ('arsenic_inorganic','A','<=', null, 2,  'mg/kg','EU 2002/32/EC feed gate (inorganic As <=2)','draft'),
  ('arsenic_inorganic','B','between', 2, 40,'mg/kg','Above feed gate, below total ceiling','draft'),
  ('arsenic_total','C','>', 40, null,'mg/kg','EU 2002/32/EC seaweed ceiling (total As >40)','draft'),
  ('foreign_matter','A','<=', null, 2, '%','EN 16202 method; compost schemes ~0.5-3%','draft'),
  ('foreign_matter','B','between', 2, 5, '%','Above A, below C','draft'),
  ('foreign_matter','C','>', 5, null, '%','Exceeds typical compost/fertiliser limits','draft'),
  ('age_hours','A','<=', null, 48, 'h','CIIN operational window (decomposition literature)','draft'),
  ('age_hours','B','between', 48, 72, 'h','Decomposition begins; value falls','draft'),
  ('age_hours','C','>', 72, null, 'h','Beyond window; restricted use / disposal','draft')
on conflict (dimension, band) do nothing;

insert into grading_policy (id) values (1) on conflict (id) do nothing;
