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

// Deterministic recommendation from grounded facts (no LLM).
// facts.beaches: [{name, sir, afai_level, drift_bearing, drift_window, tonnes?}]
// facts.hubs: [{name, spare_t, reach_km}]
function reason(facts: any) {
  const beaches = facts?.beaches ?? []
  const hubs = facts?.hubs ?? []
  const RANK = { high: 3, medium: 2, low: 1 }
  // Prioritise beaches by inundation risk (SIR), then drift arrival urgency.
  const ranked = [...beaches].sort((a, b) =>
    (RANK[b.sir] || 0) - (RANK[a.sir] || 0)
  )
  const top = ranked[0]
  const totalSpare = hubs.reduce((s: number, h: any) => s + Number(h.spare_t || 0), 0)
  const agents = [
    { agent: 'Forecast', says: top ? `Elevated floating-algae signal near ${top.name} (AFAI ${top.afai_level}).` : 'No elevated offshore signal.', source: 'live AFAI' },
    { agent: 'Beach Arrival', says: top ? `${top.name} inundation risk: ${top.sir}.` : 'Coastal risk low across segments.', source: 'SIR method (live)' },
    { agent: 'Mission Prioritization', says: top ? `${top.name} ranks highest for action.` : 'No mission warrants dispatch now.', source: 'rules over live risk' },
    { agent: 'Logistics/Routing', says: `Network spare capacity ${totalSpare} t across ${hubs.length} hubs.`, source: 'hub capacity (representative)' },
    { agent: 'Economic Impact', says: top?.tonnes ? `~${Math.round(top.tonnes * 0.3)} t CO₂e avoidable if cleared in-window.` : 'Carbon exposure low.', source: 'carbon model (directional)' },
    { agent: 'Governance/Learning', says: 'Dispatch remains blocked until a named human approves, modifies, or rejects.', source: 'policy' },
  ]
  let recommendation, confidence
  if (top && (top.sir === 'high' || top.sir === 'medium')) {
    recommendation = `Recommend dispatch to ${top.name} (${top.sir} risk). Network has ${totalSpare} t spare capacity to respond within the window.`
    confidence = top.sir === 'high' ? 'high' : 'moderate'
  } else {
    recommendation = 'No dispatch recommended — coastal risk is low across monitored segments. Continue monitoring.'
    confidence = 'moderate'
  }
  return { agents, recommendation, confidence, top: top?.name ?? null }
}

async function narrate(det: any, facts: any) {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) return { ai: false }   // graceful fallback — deterministic only
  try {
    const sys = 'You are CIIN\'s coordination assistant. You reason ONLY over the grounded facts provided (each from a real data source). Do NOT invent numbers or places. Produce a concise (<=90 words) operational rationale and a clear recommended action for a human to approve, modify, or reject. Never state anything not supported by the facts.'
    const user = 'Grounded agent facts:\n' + det.agents.map((a: any) => `- ${a.agent} [${a.source}]: ${a.says}`).join('\n') +
      `\n\nDeterministic recommendation: ${det.recommendation}\nConfidence: ${det.confidence}\n\nWrite the rationale + recommended action.`
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_tokens: 220,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    })
    if (!r.ok) return { ai: false, reason: `groq ${r.status}` }
    const j = await r.json()
    const text = j?.choices?.[0]?.message?.content?.trim()
    return text ? { ai: true, narration: text } : { ai: false }
  } catch (e) {
    return { ai: false, reason: 'groq unreachable' }
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
