// =====================================================================
// CIIN Watch — the scheduled origin of a mission, and of the alert.
//
// A mission starts from the satellite, not from someone opening a dashboard.
// This runs hourly with the SERVICE ROLE:
//   1. read every beach that has coordinates and a ten-year baseline
//   2. read the biomass in its approach zone, 20 to 40 km offshore
//   3. place that reading on the beach's own scale: low, moderate, high,
//      severe, extreme
//   4. at HIGH or above, raise a mission and alert the property and every
//      approved recovery hub in the country
//   5. at SEVERE or above, public health is treated as at risk: the mission
//      waits for government, and government is alerted too
//
// The trigger is the offshore level, not the reading at the waterline. The
// waterline index is a coastal artefact, bright all year.
//
// CIIN does not choose which hub does the work. Every approved hub in the
// country is told; a hub that wants the mission accepts it.
//
// ?dry=1 reports what would happen and changes nothing.
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

const LEVELS = ['low', 'moderate', 'high', 'severe', 'extreme']
const RAISE_AT = 2        // high
const HEALTH_AT = 3       // severe: government decides
// A mission is still open — and must not be raised again — until it is finished.
const OPEN_STATES = ['raised', 'proposed', 'authority_approved', 'access_granted', 'in_progress']

async function call(base: string, key: string, path: string, body: unknown) {
  try {
    const r = await fetch(`${base}/functions/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return { ok: false, reason: `${path.split('?')[0]} ${r.status}` }
    return await r.json()
  } catch (_) {
    return { ok: false, reason: 'unreachable' }
  }
}

// Send one email through Resend. Returns the status to record.
async function send(to: string, subject: string, text: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { status: 'not_configured', detail: 'No email service key is set.' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('ALERT_FROM') ?? 'CIIN alerts <onboarding@resend.dev>', to: [to], subject, text }),
    })
    if (r.ok) return { status: 'sent', detail: null }
    return { status: 'failed', detail: `${r.status} ${(await r.text()).slice(0, 200)}` }
  } catch (e) {
    return { status: 'failed', detail: String(e).slice(0, 200) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const base = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const app = Deno.env.get('APP_URL') ?? 'https://ciin-dev.vercel.app'
    const admin = createClient(base, key)
    const dry = new URL(req.url).searchParams.get('dry') === '1'

    const { data: segments } = await admin.from('beach_segments').select('id, org_id, name, lat, lng, length_m, path')
    const withCoords = (segments ?? []).filter(s => s.lat && s.lng)
    if (!withCoords.length) return json({ ok: true, checked: 0, raised: 0, note: 'No beach has coordinates.' })

    const [{ data: orgs }, { data: bases }, { data: people }] = await Promise.all([
      admin.from('organizations').select('id, name, role, country_code, approved'),
      admin.from('segment_baselines').select('*').eq('afai_window', '7D'),
      admin.from('profiles').select('id, full_name, org_id'),
    ])
    const orgById = new Map((orgs ?? []).map(o => [o.id, o]))
    const baseBy = new Map((bases ?? []).map(b => [b.segment_id, b]))

    const raised: any[] = [], skipped: any[] = [], sentLog: any[] = []

    for (const seg of withCoords) {
      const base10 = baseBy.get(seg.id)
      if (!base10) { skipped.push({ beach: seg.name, why: 'no ten-year baseline yet' }); continue }

      const band = await call(base, key, `feeds?feed=band&lat=${seg.lat}&lng=${seg.lng}&days=1&window=7D`,
        { feed: 'band', lat: seg.lat, lng: seg.lng, days: 1, window: '7D', path: seg.path ?? null })
      // No clear read is not a quiet coast. It is an absence of evidence, and
      // raising a mission on it would invent an observation.
      if (!band?.ok || band.gap || !band.latest) {
        skipped.push({ beach: seg.name, why: !band?.ok ? (band?.reason ?? 'feed error') : 'no clear satellite read' }); continue
      }
      const density = Number(band.latest.density)
      const rank = [base10.p75, base10.p90, base10.p95, base10.p99].filter(p => density >= Number(p)).length
      const level = LEVELS[rank]
      if (rank < RAISE_AT) { skipped.push({ beach: seg.name, why: `offshore level ${level}`, density }); continue }

      const { data: open } = await admin.from('missions').select('id').eq('segment_id', seg.id).in('status', OPEN_STATES).limit(1)
      if (open?.length) { skipped.push({ beach: seg.name, why: 'a mission is already open', level }); continue }

      const owner = orgById.get(seg.org_id)
      const country = owner?.country_code ?? 'JM'
      const health = rank >= HEALTH_AT
      const hubs = (orgs ?? []).filter(o => o.role === 'recovery_hub' && o.approved && o.country_code === country)
      const gov = (orgs ?? []).filter(o => o.role === 'government' && o.approved && o.country_code === country)
      // INDICATIVE ONLY: frontage length over ten, more at the higher levels.
      // It is not derived from the satellite or any published mass relationship;
      // missions.tonnes_basis carries that so nobody reads it as a measurement.
      const tonnes = Math.round((Number(seg.length_m ?? 400) / 10) * (rank >= 3 ? 1.5 : 1))
      const drift = await call(base, key, `feeds?feed=drift&lat=${seg.lat}&lng=${seg.lng}`, { feed: 'drift', lat: seg.lat, lng: seg.lng })

      if (dry) { raised.push({ beach: seg.name, level, density, tonnes, government_decides: health, hubs: hubs.map(h => h.name), dry: true }); continue }

      const { data: mission, error: mErr } = await admin.from('missions').insert({
        org_id: seg.org_id, segment_id: seg.id,
        title: `${seg.name} — ${level} offshore`,
        tonnes, tonnes_basis: 'indicative_length_heuristic',
        status: health ? 'proposed' : 'raised',
        authority_required: health, alert_level: level,
        access_state: 'pending',
        eta_at: new Date(Date.now() + 36 * 3600_000).toISOString(),
        source: 'live_feed',
      }).select('id').single()
      if (mErr) { skipped.push({ beach: seg.name, why: `mission insert: ${mErr.message}` }); continue }

      // The reasoning, frozen. The narration is a convenience: a mission and its
      // alert must not wait on it.
      const agent = await call(base, key, 'agent', {
        beaches: [{ name: seg.name, sir: rank >= 3 ? 'high' : 'medium', afai_level: level, tonnes }],
        hubs: [],
      })
      await admin.from('agent_proposals').insert({
        country_code: country, org_id: seg.org_id, segment_id: seg.id, mission_id: mission.id,
        agents: agent?.ok ? agent.agents : [{ agent: 'Forecast', says: `Offshore biomass ${density} t/km², ${level} on this beach's own scale.`, source: 'NOAA AFAI, approach zone 20 to 40 km offshore' }],
        recommendation: agent?.ok ? agent.recommendation : `Offshore level is ${level} at ${seg.name}. Recovery capacity should be readied.`,
        confidence: agent?.ok ? agent.confidence : 'moderate',
        narration: agent?.ok ? agent.narration ?? null : null,
        ai_model: agent?.ok ? agent.model ?? null : null,
        feed_as_of: { band: band.latest.t ?? null, drift: drift?.asOf ?? null },
      })

      // Every approved hub in the country is told. None is chosen for them.
      if (hubs.length) await admin.from('mission_hubs').insert(hubs.map(h => ({
        org_id: h.id, mission_id: mission.id, hub_name: h.name, share_tonnes: null, accepted: false })))

      // ---------- alerts ----------
      const facts = [
        `Beach: ${seg.name}`,
        `Offshore level: ${level} (${density} t/km² in the water 20 to 40 km offshore, satellite date ${String(band.latest.t).slice(0, 10)})`,
        drift?.ok ? `Water movement: ${drift.bearing} at about ${drift.speed_km_day} km a day` : null,
        `Indicative tonnage: ${tonnes} t (from frontage length, not measured)`,
      ].filter(Boolean).join('\n')
      const caveat = 'This describes sargassum offshore. It is not a measurement of the beach and not a prediction of when or how much will land.'
      const audiences: [string, any[], string, string][] = [
        ['owner', owner ? [owner] : [], `Sargassum alert: ${seg.name} is ${level} offshore`,
          `CIIN has raised a recovery mission for your frontage.\n\n${facts}\n\n${health
            ? 'Because the level is severe or above, the coastal authority will decide first. You will then be asked to grant access.'
            : 'Nothing happens on your property until you grant access.'}\n\nReview it: ${app}/app/overview\n\n${caveat}`],
        ['hub', hubs, `Recovery mission open: ${seg.name}`,
          `A recovery mission is open in your country.\n\n${facts}\nProperty: ${owner?.name ?? 'unknown'}\n\nAccept it if you can respond. Work starts only after the property grants access.\n\nOpen it: ${app}/app/overview\n\n${caveat}`],
        ['government', health ? gov : [], `Decision needed: ${seg.name} is ${level} offshore`,
          `The offshore level at ${seg.name} is ${level}. CIIN treats this as a public-health risk, so the mission waits for your decision.\n\n${facts}\nProperty: ${owner?.name ?? 'unknown'}\n\nCIIN does not measure air quality. Confirm conditions on site.\n\nDecide: ${app}/app/overview\n\n${caveat}`],
      ]
      for (const [audience, list, subject, body] of audiences) {
        for (const o of list) {
          for (const p of (people ?? []).filter(x => x.org_id === o.id)) {
            const { data: u } = await admin.auth.admin.getUserById(p.id)
            const email = u?.user?.email
            const res = email ? await send(email, subject, `Hello ${p.full_name || ''},\n\n${body}`) : { status: 'failed', detail: 'no email address on the account' }
            await admin.from('alerts').insert({ mission_id: mission.id, org_id: o.id, profile_id: p.id, audience, subject, body,
              status: res.status, detail: res.detail, sent_at: res.status === 'sent' ? new Date().toISOString() : null })
            sentLog.push({ audience, org: o.name, status: res.status })
          }
        }
      }

      raised.push({ beach: seg.name, mission: mission.id, level, density, tonnes, government_decides: health, hubs: hubs.map(h => h.name) })
    }

    return json({
      ok: true, dry, checked: withCoords.length, raised: raised.length, missions: raised, skipped, alerts: sentLog,
      email: Deno.env.get('RESEND_API_KEY') ? 'configured' : 'not configured',
      note: 'Missions are raised at high or above. Government decides only at severe or above.',
    })
  } catch (e) {
    return json({ ok: false, reason: 'watch failed', detail: String(e) }, 500)
  }
})
