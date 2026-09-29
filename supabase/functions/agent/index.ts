// =====================================================================
// CIIN Agent Orchestrator (Edge Function)
// HYBRID + HONEST: deterministic engine produces GROUNDED FACTS and a
// recommendation from real data; an LLM (Groq) then reasons OVER those facts to
// narrate + propose. Every agent output traces to a real data point. The human
// approves/modifies/rejects — the agent never acts.
//
// Named agents (per the architecture diagram), each a grounded contribution:
//   Forecast · Beach Arrival · Mission Prioritization · Logistics/Routing ·
//   Economic Impact · Governance/Learning
//
// Groq: set GROQ_API_KEY as a Supabase secret to enable AI narration.
//   supabase secrets set GROQ_API_KEY=gsk_...
// The model id is overridable without a redeploy, because Groq retires models
// on a schedule and a retired id fails as a 404:
//   supabase secrets set GROQ_MODEL=openai/gpt-oss-120b
// Without the key, the function returns the deterministic recommendation +
// rule-based rationale (fully honest, no LLM) — the AI layer is an enhancement.
//
// The caller POSTs the grounded facts (assembled client-side from the live
// feeds + DB the user already loaded), so the function stays fast and the LLM
// only ever sees real, labelled data.
// =====================================================================

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Deterministic reasoning from grounded facts (no LLM). Six layers, each
// saying one thing it can support and naming where that came from.
//
// facts.beaches   [{name, level, rank, density, date, sir?, afai_level?, tonnes?, drift_bearing?, drift_speed?, window?}]
// facts.landings  [{name, hours_left, extent}]
// facts.missions  {open, awaiting_owner, awaiting_government, unaccepted, collecting}
// facts.hubs      [{name, spare_t}]        totals only are reported; no hub is preferred
// facts.removed   {tonnes, signed_tonnes}
// facts.samples   {waiting}
// facts.regional  {country, level, tonnes, as_of}
function reason(facts: any) {
  const RANK: Record<string, number> = { extreme: 4, severe: 3, high: 2, moderate: 1, medium: 2, low: 0 }
  const beaches = (facts?.beaches ?? []).map((b: any) => ({ ...b, level: b.level ?? b.afai_level ?? b.sir ?? 'low',
    rank: Number.isFinite(b.rank) ? b.rank : (RANK[b.level ?? b.sir ?? 'low'] ?? 0) }))
  const hubs = facts?.hubs ?? [], landings = facts?.landings ?? [], m = facts?.missions ?? {}
  const top = [...beaches].sort((a: any, b: any) => b.rank - a.rank)[0]
  const urgent = [...landings].sort((a: any, b: any) => a.hours_left - b.hours_left)[0]
  const spare = hubs.reduce((s: number, h: any) => s + Number(h.spare_t || 0), 0)
  const hot = top && top.rank >= 2
  const reg = facts?.regional

  const agents = [
    { agent: 'Forecast', reads: 'Satellite floating-algae index, 20 to 40 km offshore',
      says: !beaches.length ? 'No beach with a satellite reading is in view.'
        : top.density != null ? `${top.name}: ${top.density} t/km² offshore, ${top.level} on its own ten-year scale${top.date ? ` (satellite date ${String(top.date).slice(0, 10)})` : ''}.`
        : `${top.name}: offshore level ${top.level}.`
        + (reg?.level ? ` ${reg.country} waters overall: ${reg.level}.` : ''),
      source: 'NOAA AFAI, approach zone', tier: 'satellite' },
    { agent: 'Beach Arrival', reads: 'Ocean currents and landing reports from properties',
      says: urgent ? `${urgent.name} has sargassum on the beach (${urgent.extent}). ${urgent.hours_left <= 0 ? `Overdue by ${Math.ceil(-urgent.hours_left)} hours.` : `${Math.floor(urgent.hours_left)} hours left of 48.`}`
        : top?.drift_bearing ? `Water off ${top.name} is moving ${top.drift_bearing}${top.drift_speed ? ` at about ${top.drift_speed} km a day` : ''}${top.window ? `; arrival window ${top.window}` : ''}. No landing has been reported.`
        : 'No landing has been reported and no current reading is available.',
      source: urgent ? 'landing report from the property' : 'ocean current feed (indicative)', tier: urgent ? 'reported' : 'indicative' },
    { agent: 'Mission Prioritization', reads: 'Offshore levels, landings and open missions',
      says: urgent ? `${urgent.name} comes first: it has landed and the clock is running.`
        : hot ? `${top.name} ranks highest for action (${top.level} offshore).`
        : 'No beach is at high or above. Nothing warrants a mission now.',
      source: 'rules over the readings', tier: 'computed' },
    { agent: 'Logistics/Routing', reads: 'Hub capacity and who has accepted what',
      says: `${hubs.length} recovery hub${hubs.length === 1 ? '' : 's'} with ${Math.round(spare)} t spare in total.`
        + (m.open != null ? ` ${m.open} mission${m.open === 1 ? '' : 's'} open; ${m.unaccepted ?? 0} with no hub yet; ${m.collecting ?? 0} in collection.` : '')
        + ' CIIN tells every hub and chooses none.',
      source: 'hub capacity and mission record', tier: 'record' },
    { agent: 'Economic Impact', reads: 'Tonnes removed and signed off',
      says: facts?.removed?.tonnes ? `${facts.removed.tonnes} t recorded as removed, ${facts.removed.signed_tonnes ?? 0} t signed off by the property. About ${Math.round((facts.removed.signed_tonnes ?? 0) * 0.3 * 10) / 10} t CO₂e avoided on the signed tonnage.`
        : top?.tonnes ? `About ${Math.round(top.tonnes * 0.3)} t CO₂e avoidable at ${top.name} if cleared in time, on an indicative tonnage.`
        : 'No removal has been recorded, so there is nothing to value yet.',
      source: 'removal records; carbon factor 0.30 t per tonne', tier: 'directional' },
    { agent: 'Governance/Learning', reads: 'Decisions waiting and evidence outstanding',
      says: [m.awaiting_government ? `${m.awaiting_government} mission${m.awaiting_government === 1 ? '' : 's'} waiting on government (public health at risk).` : 'Nothing is waiting on government; it decides only at severe or above.',
             m.awaiting_owner ? `${m.awaiting_owner} waiting on a property to grant access.` : null,
             facts?.samples?.waiting ? `${facts.samples.waiting} sample${facts.samples.waiting === 1 ? '' : 's'} waiting on a laboratory result.` : null].filter(Boolean).join(' '),
      source: 'policy and the decision record', tier: 'record' },
  ]

  let recommendation, confidence
  if (urgent) {
    recommendation = urgent.hours_left <= 0 ? `Clear ${urgent.name} now: it is past 48 hours.` : `Clear ${urgent.name} within ${Math.floor(urgent.hours_left)} hours. A hub should confirm its dates with the property today.`
    confidence = 'high'
  } else if (hot) {
    recommendation = `Ready recovery capacity for ${top.name} (${top.level} offshore).` + (top.rank >= 3 ? ' Public health is treated as at risk: government decides before work starts.' : ' The property and the hubs have been told.')
    confidence = top.rank >= 3 ? 'high' : 'moderate'
  } else {
    recommendation = 'No action is recommended. Offshore levels are below high on every beach in view. Keep watching.'
    confidence = 'moderate'
  }
  return { agents, recommendation, confidence, top: urgent?.name ?? top?.name ?? null }
}

// llama-3.3-70b-versatile was decommissioned 2026-08-16 and returned 404,
// which silently downgraded the agent to rules-only. Overridable via GROQ_MODEL.
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b'

async function narrate(det: any, facts: any) {
  const key = Deno.env.get('GROQ_API_KEY')
  // No key is a deliberate configuration, not a fault: stay deterministic and
  // say so, rather than reporting a degradation the operator did not cause.
  if (!key) return { ai: false, ai_status: 'no_key' }
  try {
    const sys = 'You are CIIN\'s coordination assistant. You reason ONLY over the grounded facts provided (each from a real data source). Do NOT invent numbers or places. Produce a concise (<=90 words) operational rationale and a clear recommended action. CIIN is an independent verifier: never name or prefer a particular recovery hub. Never state anything not supported by the facts. Reply in PLAIN PROSE ONLY: no markdown, no asterisks, no bold, no headings, no bullet points \u2014 the dashboard renders your reply as plain text.'
    const user = 'Grounded agent facts:\n' + det.agents.map((a: any) => `- ${a.agent} [${a.source}]: ${a.says}`).join('\n') +
      `\n\nDeterministic recommendation: ${det.recommendation}\nConfidence: ${det.confidence}\n\nWrite the rationale + recommended action.`
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 220,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return { ai: false, ai_status: 'error', reason: `groq ${r.status}`,
               ai_detail: (r.status === 404 ? `model "${GROQ_MODEL}" not found — check GROQ_MODEL` : detail.slice(0, 200)) }
    }
    const j = await r.json()
    // The card renders narration as plain text, so markdown would show as
    // literal asterisks. The prompt asks for prose; this enforces it.
    const text = j?.choices?.[0]?.message?.content
      ?.replace(/\*\*(.+?)\*\*/g, '$1')
      ?.replace(/^#{1,6}\s+/gm, '')
      ?.replace(/^\s*[-*]\s+/gm, '')
      ?.replace(/\n{3,}/g, '\n\n')
      ?.trim()
    return text ? { ai: true, ai_status: 'ok', narration: text, model: GROQ_MODEL }
                : { ai: false, ai_status: 'empty', reason: 'groq returned no text' }
  } catch (e) {
    return { ai: false, ai_status: 'error', reason: 'groq unreachable' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const facts = await req.json().catch(() => ({}))
    const det = reason(facts)
    const nar = await narrate(det, facts)
    return json({ ok: true, ...det, ...nar })
  } catch (e) {
    return json({ ok: false, reason: 'agent failed', detail: String(e) })
  }
})
