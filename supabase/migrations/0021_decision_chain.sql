-- =====================================================================
-- CIIN Phase 2 — the decision chain.
--
-- A mission originates from the satellite measurements: the forecasting agent
-- reads AFAI/SIR + drift, raises a mission, and the alert reaches BOTH the
-- hotel whose frontage is affected and the agent-ranked recovery hubs that
-- could respond. A named human then approves, modifies or rejects it, and
-- nothing dispatches before that.
--
-- Three things this migration establishes:
--   1. What the approver saw, frozen at decision time (agent_proposals).
--   2. What the human ruled, and who they were (mission_decisions).
--   3. One mission visible to two parties, replacing the duplicate-per-org
--      pattern the seeds currently use.
-- =====================================================================

-- ---------- 1. The proposal, frozen ----------
-- Immutable by design: there is no update or delete policy, and a revised
-- proposal is a NEW row. The recommendation is recomputed from live feeds on
-- every dashboard load, so without this snapshot an approval would point at
-- nothing durable — and if the AFAI read shifts an hour later there would be no
-- record of what was actually put in front of the approver.
create table agent_proposals (
  id             uuid primary key default gen_random_uuid(),
  country_code   text not null,
  org_id         uuid references organizations (id) on delete set null,  -- coastal asset owner
  segment_id     uuid references beach_segments (id) on delete set null,
  mission_id     uuid references missions (id) on delete set null,
  agents         jsonb not null,          -- the six grounded contributions, verbatim
  recommendation text not null,
  confidence     text not null,
  narration      text,                    -- LLM text; null when rules-only
  ai_model       text,                    -- e.g. openai/gpt-oss-120b
  feed_as_of     jsonb not null,          -- {afai: ts, drift: ts} — provenance of the facts
  created_at     timestamptz not null default now()
);
create index agent_proposals_mission_idx on agent_proposals (mission_id);
create index agent_proposals_country_idx on agent_proposals (country_code, created_at desc);

comment on table agent_proposals is
  'Immutable snapshot of what an approver saw. Never updated; a revision is a new row.';

-- ---------- 2. The human ruling ----------
create table mission_decisions (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references agent_proposals (id) on delete cascade,
  mission_id    uuid references missions (id) on delete set null,
  decision      text not null check (decision in ('approved', 'modified', 'rejected')),
  modifications jsonb,                    -- what Modify changed: {field: {from, to}}
  note          text,
  decided_by    uuid not null references profiles (id),
  decided_at    timestamptz not null default now()
);
create index mission_decisions_proposal_idx on mission_decisions (proposal_id);

-- ---------- 3. One mission, two parties ----------
-- missions.org_id is singular and RLS scoped on it, so a mission could belong
-- to the hotel or the hub but not both. 0007_hotel_seed and 0014_hub_seed
-- therefore create the same Long Bay clearance TWICE, as two rows that never
-- reconcile. org_id now means the coastal asset owner; participating hubs are
-- mission_hubs rows, which the agent writes as candidates (accepted = false)
-- and which the hub sets true when it acknowledges the alert.
drop policy if exists mission_select on missions;
create policy mission_select on missions for select
  using (
    (org_id = current_org_id() and my_org_approved())
    or (my_org_approved() and exists (
      select 1 from mission_hubs mh
      where mh.mission_id = missions.id
        and mh.org_id = current_org_id()
    ))
    or is_platform_admin()
  );

-- A participating hub must also see its own pool row to acknowledge it; the
-- existing mhub policies already scope on org_id, which covers this.

-- ---------- Read policies for the new tables ----------
-- A proposal is visible to the org it concerns, to government in that country,
-- and to platform admin. Writes come from the agent (service role), never RLS.
alter table agent_proposals   enable row level security;
alter table mission_decisions enable row level security;

create policy proposal_select on agent_proposals for select
  using (
    is_platform_admin()
    or org_id = current_org_id()
    or exists (
      select 1 from organizations o
      where o.id = current_org_id()
        and o.role = 'government'
        and o.country_code = agent_proposals.country_code
    )
  );

create policy decision_select on mission_decisions for select
  using (
    is_platform_admin()
    or exists (
      select 1 from agent_proposals p
      where p.id = mission_decisions.proposal_id
        and (p.org_id = current_org_id()
             or exists (select 1 from organizations o
                        where o.id = current_org_id()
                          and o.role = 'government'
                          and o.country_code = p.country_code))
    )
  );

-- ---------- The authority gate ----------
-- A ministry approving a hotel-owned mission is a CROSS-ORG write, and
-- mission_write requires org_id = current_org_id(). Rather than loosen that
-- policy for every caller, the privilege lives here: one function, one place to
-- audit, which checks the caller really is government for that country.
create or replace function authority_decide(
  p_proposal uuid,
  p_decision text,
  p_note     text  default null,
  p_mods     jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_country text;
  v_mission uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated.';
  end if;
  if p_decision not in ('approved', 'modified', 'rejected') then
    raise exception 'Decision must be approved, modified or rejected (got %).', p_decision;
  end if;

  select country_code, mission_id into v_country, v_mission
  from agent_proposals where id = p_proposal;
  if not found then
    raise exception 'No such proposal.';
  end if;

  -- Authority: platform admin, or a member of an APPROVED government org in the
  -- same country as the proposal. Approval is jurisdictional, not global.
  if not (
    is_platform_admin()
    or exists (
      select 1 from profiles pr
      join organizations o on o.id = pr.org_id
      where pr.id = v_actor
        and o.role = 'government'
        and o.approved
        and o.country_code = v_country
    )
  ) then
    raise exception 'Not authorised to decide missions for %.', v_country;
  end if;

  if v_mission is not null then
    if p_decision = 'rejected' then
      update missions set status = 'rejected' where id = v_mission;
    else
      -- 'modified' carries edits the human made before approving; both end in
      -- authority_approved, and mission_decisions records which it was.
      if p_decision = 'modified' and p_mods is not null then
        update missions
          set tonnes = coalesce((p_mods->>'tonnes')::numeric, tonnes),
              eta_at = coalesce((p_mods->>'eta_at')::timestamptz, eta_at),
              title  = coalesce(p_mods->>'title', title)
        where id = v_mission;
      end if;
      update missions set status = 'authority_approved' where id = v_mission;
    end if;
  end if;

  insert into mission_decisions (proposal_id, mission_id, decision, modifications, note, decided_by)
  values (p_proposal, v_mission, p_decision, p_mods, p_note, v_actor);

  return v_mission;
end;
$$;

revoke all on function authority_decide(uuid, text, text, jsonb) from public;
grant execute on function authority_decide(uuid, text, text, jsonb) to authenticated;

comment on function authority_decide is
  'The dispatch gate. Records a named human decision against a frozen proposal '
  'and moves the mission. security definer because approval crosses the org '
  'boundary; the jurisdiction check inside is what makes that safe.';
