// =====================================================================
// Client for the CIIN agent orchestrator. Assembles GROUNDED FACTS from data
// the caller already loaded (live feeds + DB), sends them to the agent function,
// and returns the deterministic recommendation + (if a Groq key is set) an
// AI-narrated rationale. Honest: the LLM only ever sees real, labelled facts.
// =====================================================================
import { supabase } from './supabase'

// segReads: { segId: {ok, gap, level, sir, afai} } ; segments: rows ; hubs: [{name, spare_t, reach_km}]
export async function runAgent({ segments, segReads, hubs = [] }) {
  const beaches = (segments || [])
    .filter(s => s.lat && s.lng)
    .map(s => {
      const r = segReads?.[s.id]
      if (!r || !r.ok || r.gap) return { name: s.name, sir: 'low', afai_level: 'no read' }
      return { name: s.name, sir: r.sir || 'low', afai_level: r.level || 'low', tonnes: s.tonnes }
    })
  const facts = { beaches, hubs }
  try {
    const { data, error } = await supabase.functions.invoke('agent', { body: facts })
    if (error) return { ok: false, reason: error.message || 'agent error' }
    return data
  } catch (e) {
    return { ok: false, reason: 'agent unreachable' }
  }
}
