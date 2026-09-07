-- =====================================================================
-- CIIN Phase 3 — invoicing and cost.
--
-- Two billing relationships, one issuer: the hub bills the HOTEL for recovery,
-- and bills the PROCESSOR for transport and pre-processing. The issuer/payer
-- pair carries both without special-casing. Everything settles in USD.
--
-- The notable change here is not a table, it's a policy. Every existing RLS
-- policy scopes rows to a single org. An invoice is the first record in CIIN
-- that two different organisations must both see.
-- =====================================================================

-- ---------- Rate card ----------
-- Versioned, never edited in place, so a historical invoice can be recomputed
-- against the rate that applied on the day rather than today's.
create table cost_rates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id) on delete cascade,
  unit           text not null check (unit in ('tonne', 'truck', 'hour', 'segment_visit')),
  amount         numeric(12,2) not null check (amount >= 0),   -- USD
  label          text,
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now()
);
create index cost_rates_org_idx on cost_rates (org_id, unit, effective_from desc);

comment on table cost_rates is
  'A hub''s published rate card, in USD. Superseded by inserting a new row and '
  'closing the old one with effective_to — never by editing an applied rate.';

-- ---------- Invoices ----------
-- Hub -> Hotel      (purpose 'recovery')
-- Hub -> Processor  (purpose 'transport_preprocessing')
create table invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_ref    text not null unique,
  issuer_org_id  uuid not null references organizations (id) on delete restrict,
  payer_org_id   uuid not null references organizations (id) on delete restrict,
  mission_id     uuid references missions (id) on delete set null,
  purpose        text not null check (purpose in ('recovery', 'transport_preprocessing')),
  status         text not null default 'draft'
                 check (status in ('draft', 'sent', 'paid', 'void')),
  subtotal       numeric(12,2) not null default 0,
  tax            numeric(12,2) not null default 0,   -- GCT/IVU deferred; column kept
  total          numeric(12,2) not null default 0,
  issued_at      timestamptz,
  due_at         timestamptz,
  paid_at        timestamptz,
  source         data_source not null default 'representative',
  created_at     timestamptz not null default now(),
  constraint invoice_parties_differ check (issuer_org_id <> payer_org_id)
);
create index invoices_issuer_idx on invoices (issuer_org_id, status);
create index invoices_payer_idx  on invoices (payer_org_id, status);

comment on column invoices.tax is
  'Jamaica GCT / Puerto Rico IVU are not modelled yet and this stays 0. The '
  'column exists because adding it to a live ledger later is far more painful '
  'than carrying an unused one.';

create table invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices (id) on delete cascade,
  rate_id     uuid references cost_rates (id) on delete set null,
  description text not null,
  qty         numeric(12,2) not null,
  unit        text not null,
  unit_rate   numeric(12,2) not null,
  amount      numeric(12,2) not null
);
create index invoice_lines_invoice_idx on invoice_lines (invoice_id);

-- ---------- Row-level security ----------
alter table cost_rates    enable row level security;
alter table invoices      enable row level security;
alter table invoice_lines enable row level security;

-- A rate card is PUBLISHED within the network: a hotel cannot judge an
-- estimated removal cost without seeing the rate it is estimated from. Scoped
-- to the country so it is a regional rate book, not a global one.
create policy rate_select on cost_rates for select
  using (
    is_platform_admin()
    or org_id = current_org_id()
    or exists (
      select 1 from organizations mine, organizations theirs
      where mine.id = current_org_id()
        and theirs.id = cost_rates.org_id
        and mine.country_code = theirs.country_code
    )
  );
create policy rate_write on cost_rates for all
  using (org_id = current_org_id() and my_org_approved())
  with check (org_id = current_org_id() and my_org_approved());

-- BOTH parties see the invoice. This is the first two-org record in CIIN.
create policy invoice_select on invoices for select
  using (
    is_platform_admin()
    or issuer_org_id = current_org_id()
    or payer_org_id = current_org_id()
  );
-- Only the issuer writes it. A payer marking its own invoice paid would be
-- self-certification; settlement confirmation belongs to whoever raised it.
create policy invoice_write on invoices for all
  using (issuer_org_id = current_org_id() and my_org_approved())
  with check (issuer_org_id = current_org_id() and my_org_approved());

create policy line_select on invoice_lines for select
  using (exists (
    select 1 from invoices i
    where i.id = invoice_lines.invoice_id
      and (is_platform_admin() or i.issuer_org_id = current_org_id() or i.payer_org_id = current_org_id())
  ));
create policy line_write on invoice_lines for all
  using (exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.issuer_org_id = current_org_id()))
  with check (exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.issuer_org_id = current_org_id()));

-- ---------- Representative rate card for the seeded hub ----------
insert into cost_rates (org_id, unit, amount, label)
select id, 'truck', 480.00, 'Per truck load, beach to hub' from organizations where role = 'recovery_hub'
on conflict do nothing;
insert into cost_rates (org_id, unit, amount, label)
select id, 'tonne', 62.00, 'Per tonne, pre-processing' from organizations where role = 'recovery_hub'
on conflict do nothing;
