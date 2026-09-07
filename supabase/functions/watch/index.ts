// =====================================================================
// CIIN Watch — the scheduled origin of a mission.
//
// A mission starts from the satellite measurements, not from someone opening a
// dashboard. Until now runAgent() was called from exactly one place —
// GovernmentView.jsx, in the browser — so the agent only ran while a government
// user happened to be looking at the Overview. Sargassum does not wait for that.
//
// This runs on a schedule with the SERVICE ROLE:
//   1. read every coast segment that has coordinates
//   2. pull live AFAI/SIR + drift for each
//   3. rank the country's approved hubs by DERIVED spare capacity (0022)
//   4. ask the agent orchestrator to reason over those grounded facts
//   5. where a segment is at medium/high inundation risk, raise a mission
//      (status 'proposed'), freeze the proposal, and write agent-ranked hub
//      candidates — this is the alert reaching hotel and hubs
//
// It NEVER approves. missions stay 'proposed' until a named human calls
// authority_decide(); the dispatch gate is unchanged by putting the origin on a
// timer.
//
// Deploy: supabase functions deploy watch --no-verify-jwt
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Only these two warrant raising a mission. 'low' is monitored, not actioned.
const ACTIONABLE = new Set(['high', 'medium'])
// A mission is still open — and must not be raised again — until it is decided
// and finished. Re-raising a segment that already has live work is the same
// duplication bug the capture agent had before 0020.
const OPEN_STATES = ['proposed', 'authority_approved', 'access_granted', 'in_progress']
const MAX_HUBS = 2   // how many ranked candidates get alerted per mission

async function feed(base: string, key: string, name: string, lat: number, lng: number) {
  try {
    const r = await fetch(`${base}/functions/v1/feeds?feed=${name}&lat=${lat}&lng=${lng}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ feed: name, lat, lng }),
    })
    if (!r.ok) return { ok: false, reason: `feeds ${r.status}` }
    return await r.json()
  } catch (_) {
    return { ok: false, reason: 'feeds unreachable' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const base = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(base, key)

    const { data: segments } = await admin.from('beach_segments').select('id, org_id, name, lat, lng, length_m')
    const withCoords = (segments ?? []).filter(s => s.lat && s.lng)
    if (!withCoords.length) return json({ ok: true, checked: 0, raised: 0, note: 'No geo-located segments.' })

    const { data: orgs } = await admin.from('organizations').select('id, name, role, country_code, approved, capacity_t')
    const orgById = new Map((orgs ?? []).map(o => [o.id, o]))

    const raised: any[] = []
    const skipped: any[] = []

    for (const seg of withCoords) {
      const [afai, drift] = await Promise.all([
        feed(base, key, 'afai', seg.lat, seg.lng),
        feed(base, key, 'drift', seg.lat, seg.lng),
      ])

      // No clear read is not a quiet coast — it is an absence of evidence, and
      // raising a mission on it would invent an observation.
      if (!afai?.ok || afai.gap || !ACTIONABLE.has(afai.sir)) {
        skipped.push({ segment: seg.name, why: !afai?.ok ? (afai?.reason ?? 'feed error')
          : afai.gap ? 'coverage gap' : `sir ${afai.sir}` })
        continue
      }

      // Don't re-raise a segment that already has live work.
      const { data: open } = await admin.from('missions')
        .select('id').eq('segment_id', seg.id).in('status', OPEN_STATES).limit(1)
      if (open?.length) { skipped.push({ segment: seg.name, why: 'mission already open' }); continue }

      const owner = orgById.get(seg.org_id)
      const country = owner?.country_code ?? 'JM'

      // Rank the country's approved hubs by DERIVED spare capacity (0022).
      // Hubs with unknown capacity rank last rather than being assumed capable.
      const hubs = (orgs ?? []).filter(o => o.role === 'recovery_hub' && o.approved && o.country_code === country)
      const ranked: any[] = []
      for (const h of hubs) {
        const { data: spare } = await admin.rpc('hub_spare_capacity', { p_org: h.id })
        ranked.push({ ...h, spare_t: Number(spare ?? 0) })
      }
      ranked.sort((a, b) => b.spare_t - a.spare_t)
      const candidates = ranked.filter(h => h.spare_t > 0).slice(0, MAX_HUBS)

      // Ask the agent to reason over the grounded facts — same orchestrator the
      // dashboard uses, so the narration a human approves is the same shape.
      // INDICATIVE ONLY: frontage length over ten, times a factor at high SIR.
      // This is not derived from AFAI density or any published mass relationship
      // — it is a shape-of-the-problem figure. missions.tonnes_basis (0024)
      // carries that provenance so an approver is not shown an invented number
      // dressed as a measurement.
      const tonnes = Math.round((Number(seg.length_m ?? 400) / 10) * (afai.sir === 'high' ? 1.5 : 1))
      const agentRes = await fetch(`${base}/functions/v1/agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beaches: [{ name: seg.name, sir: afai.sir, afai_level: afai.level, tonnes }],
          hubs: candidates.map(h => ({ name: h.name, spare_t: h.spare_t })),
        }),
      })
      const agent = agentRes.ok ? await agentRes.json() : null
      if (!agent?.ok) { skipped.push({ segment: seg.name, why: 'agent unavailable' }); continue }

      // Raise the mission. 'proposed' — the gate is untouched.
      const { data: mission, error: mErr } = await admin.from('missions').insert({
        org_id: seg.org_id,
        segment_id: seg.id,
        title: `${seg.name} — inundation response`,
        tonnes,
        status: 'proposed',
        access_state: 'pending',
        eta_at: drift?.ok && drift.arrival_window
          ? new Date(Date.now() + 36 * 3600_000).toISOString()
          : new Date(Date.now() + 24 * 3600_000).toISOString(),
        source: 'live_feed',
        tonnes_basis: 'indicative_length_heuristic',
      }).select('id').single()
      if (mErr) { skipped.push({ segment: seg.name, why: `mission insert: ${mErr.message}` }); continue }

      await admin.from('agent_proposals').insert({
        country_code: country,
        org_id: seg.org_id,
        segment_id: seg.id,
        mission_id: mission.id,
        agents: agent.agents,
        recommendation: agent.recommendation,
        confidence: agent.confidence,
        narration: agent.narration ?? null,
        ai_model: agent.model ?? null,
        feed_as_of: { afai: afai.asOf ?? null, drift: drift?.asOf ?? null },
      })

      // The alert: candidate hubs, unaccepted. Acknowledging sets accepted.
      if (candidates.length) {
        await admin.from('mission_hubs').insert(candidates.map(h => ({
          org_id: h.id,
          mission_id: mission.id,
          hub_name: h.name,
          share_tonnes: Math.round((tonnes / candidates.length) * 10) / 10,
          accepted: false,
        })))
      }

      raised.push({ segment: seg.name, mission: mission.id, sir: afai.sir, tonnes,
                    hubs: candidates.map(h => `${h.name} (${h.spare_t}t spare)`) })
    }

    return json({
      ok: true,
      checked: withCoords.length,
      raised: raised.length,
      missions: raised,
      skipped,
      note: 'Missions raised as proposed. Nothing dispatches until authority_decide().',
    })
  } catch (e) {
    return json({ ok: false, reason: 'watch failed', detail: String(e) }, 500)
  }
})
