-- =====================================================================
-- Capture agent: stop re-proposing decided reviews, stop duplicating patterns.
--
-- THE BUG. The capture function skipped inserting a rule_review only when a
-- matching one was still in state 'proposed':
--     .eq('dimension', rv.dimension).eq('state', 'proposed')
-- The moment a human accepted or declined, the row stopped matching, so the
-- next "Run capture" inserted a fresh duplicate. Every run after a decision
-- made another copy — and the standards-audit loop lost its meaning, because
-- declining a proposal simply produced it again, verbatim, with no memory that
-- a human had ruled on it.
--
-- knowledge_items had no dedupe at all; loadKnowledge() hid the duplicates
-- client-side while the table kept growing.
--
-- At the time of writing production held 5 identical foreign_matter/band A
-- reviews (accepted 09-06 14:56, accepted 09-07 00:57, rejected 09-07 00:57,
-- accepted 09-07 02:09, and one still proposed) and 14 knowledge_items that
-- were 7 copies each of 2 patterns.
-- =====================================================================

-- ---------- 1. Collapse duplicate rule_reviews ----------
-- Keep, per (dimension, band), the row carrying the most recent human decision;
-- if none was ever decided, keep the newest. The rejection of 09-07 00:57 is
-- superseded by the acceptance of 09-07 02:09, which is the standing decision.
delete from rule_reviews r using (
  select id, row_number() over (
    partition by dimension, coalesce(band, '*')
    order by (decided_at is null), decided_at desc, created_at desc
  ) as rn
  from rule_reviews
) d
where r.id = d.id and d.rn > 1;

-- ---------- 2. Collapse duplicate knowledge_items ----------
-- Keep the newest per pattern: its numbers reflect the latest evidence.
delete from knowledge_items k using (
  select id, row_number() over (
    partition by topic, coalesce(country_code, 'ALL')
    order by created_at desc
  ) as rn
  from knowledge_items
) d
where k.id = d.id and d.rn > 1;

-- ---------- 3. Make the duplication impossible ----------
-- NULL is never equal to NULL in a unique index, so the nullable columns have
-- to carry a real sentinel or the constraint would not bind these rows at all.
update knowledge_items set country_code = 'ALL' where country_code is null;
alter table knowledge_items alter column country_code set default 'ALL';
alter table knowledge_items alter column country_code set not null;

update rule_reviews set band = '*' where band is null;
alter table rule_reviews alter column band set default '*';
alter table rule_reviews alter column band set not null;

create unique index if not exists knowledge_items_topic_country_key
  on knowledge_items (topic, country_code);

create unique index if not exists rule_reviews_dimension_band_key
  on rule_reviews (dimension, band);

comment on index rule_reviews_dimension_band_key is
  'One standing review per grading dimension+band. The capture agent upserts '
  'evidence into it and must never overwrite state/decided_by/decided_at — a '
  'human decision survives every subsequent capture run.';
