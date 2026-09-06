// =====================================================================
// Client for the capture agent + knowledge hub.
// runCapture() triggers the cross-org mining (admin). loadKnowledge()/loadReviews()
// read the aggregate public good (any authenticated user). decideReview() is the
// human gate on the standards-audit loop (platform admin).
// =====================================================================
import { supabase } from './supabase'

export async function runCapture() {
  try {
    const { data, error } = await supabase.functions.invoke('capture', { body: {} })
    if (error) return { ok: false, reason: error.message || 'capture error' }
    return data
  } catch (e) {
    return { ok: false, reason: 'capture unreachable' }
  }
}

export async function loadKnowledge() {
  const { data } = await supabase.from('knowledge_items')
    .select('*').order('created_at', { ascending: false }).limit(20)
  return data ?? []
}

export async function loadReviews() {
  const { data } = await supabase.from('rule_reviews')
    .select('*').order('created_at', { ascending: false }).limit(20)
  return data ?? []
}

export async function decideReview(id, state) {
  const { error } = await supabase.from('rule_reviews')
    .update({ state, decided_at: new Date().toISOString() }).eq('id', id)
  return !error
}
