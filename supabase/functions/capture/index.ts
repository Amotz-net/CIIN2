// =====================================================================
// CIIN Capture Agent (Edge Function) — the cross-org knowledge layer (§5).
// Runs with the SERVICE ROLE so it can see across the RLS boundary that no human
// participant can. It mines batch evidence for PATTERNS, writes them as aggregate
// knowledge_items (never a single org's record), and PROPOSES rule reviews
// (standards-audit) that a human decides. HARD boundaries, enforced here:
//   - Aggregate only, above a k-anonymity floor (K distinct orgs).
//   - The agent NEVER writes grading_rules (it proposes rule_reviews).
//   - Every item carries provenance: measured | operator_stated | agent_inferred.
//
// Deploy: supabase functions deploy capture   (JWT verify ON — admin-triggered)
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase).
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const K = 2  // k-anonymity floor: a pattern must draw on >= K distinct orgs to publish.
             // (Low for the demo's small org count; raise for production, e.g. 5.)

// Recompute grade band for a batch row (mirror of the engine's dimension logic,
// enough to bucket batches by dimension breach without importing the client).
function dimBand(dim: string, b: any): string | null {
  const v = dim === 'arsenic' ? (b.arsenic_inorganic ?? b.arsenic_total)
    : dim === 'foreign_matter' ? b.foreign_matter
    : dim === 'age' ? b.age_hours : null
  if (v == null) return null
  if (dim === 'arsenic') {
    if (b.arsenic_inorganic != null) return b.arsenic_inorganic > 40 ? 'C' : b.arsenic_inorganic > 2 ? 'B' : 'A'
    return b.arsenic_total > 40 ? 'C' : 'B'
  }
  if (dim === 'foreign_matter') return v > 5 ? 'C' : v > 2 ? 'B' : 'A'
  if (dim === 'age') return v > 72 ? 'C' : v > 48 ? 'B' : 'A'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, key)  // service role — bypasses RLS

    // Pull batches across ALL orgs (this is the cross-org read only the agent can do).
    const { data: batches } = await admin.from('batches')
      .select('org_id, batch_ref, arsenic_total, arsenic_inorganic, foreign_matter, age_hours, chain_valid, signature_valid, measurement_conf')
    const rows = batches ?? []

    const knowledge: any[] = []
    const reviews: any[] = []

    // ---- Pattern 1: foreign-matter clustering just above band A (0010 A<=2%) ----
    const fmVals = rows.map(r => r.foreign_matter).filter((v: any) => typeof v === 'number')
    const fmOrgs = new Set(rows.filter(r => typeof r.foreign_matter === 'number').map(r => r.org_id))
    const nearA = fmVals.filter((v: number) => v > 2 && v <= 3).length
    if (fmVals.length && fmOrgs.size >= K) {
      const pct = Math.round((nearA / fmVals.length) * 100)
      if (pct >= 25) {
        knowledge.push({
          topic: 'foreign_matter_threshold_clustering',
          headline: `${pct}% of graded batches sit just above the foreign-matter A threshold (2%), across ${fmOrgs.size} organisations.`,
          provenance: 'agent_inferred', org_count: fmOrgs.size, sample_n: fmVals.length,
          detail: { band_A_limit_pct: 2, clustered_2_to_3_pct: pct },
        })
        reviews.push({
          dimension: 'foreign_matter', band: 'A',
          finding: `A large share of batches cluster in 2–3% foreign matter, just failing band A, across ${fmOrgs.size} orgs.`,
          proposal: 'Review whether the foreign-matter A threshold (2%) is achievable with manual collection on high-energy beaches, or should be re-set.',
          evidence_n: fmVals.length, org_count: fmOrgs.size,
        })
      }
    }

    // ---- Pattern 2: repeated arsenic-driven C/B across orgs (screened vs confirmed) ----
    const asRows = rows.filter(r => r.arsenic_total != null || r.arsenic_inorganic != null)
    const asOrgs = new Set(asRows.map(r => r.org_id))
    const screenedHigh = asRows.filter(r => r.measurement_conf === 'screened' && (r.arsenic_total ?? 0) > 40).length
    if (asRows.length && asOrgs.size >= K && screenedHigh > 0) {
      knowledge.push({
        topic: 'screened_arsenic_uncertainty',
        headline: `${screenedHigh} screened batches exceed the total-As ceiling before lab confirmation, across ${asOrgs.size} organisations — lab confirmation materially changes their fate.`,
        provenance: 'agent_inferred', org_count: asOrgs.size, sample_n: asRows.length,
        detail: { screened_over_ceiling: screenedHigh },
      })
    }

    // ---- Pattern 3: age-window pressure (batches graded down by age) ----
    const ageRows = rows.filter(r => typeof r.age_hours === 'number')
    const ageOrgs = new Set(ageRows.map(r => r.org_id))
    const overWindow = ageRows.filter(r => r.age_hours > 48).length
    if (ageRows.length && ageOrgs.size >= K && overWindow / ageRows.length >= 0.25) {
      const pct = Math.round((overWindow / ageRows.length) * 100)
      knowledge.push({
        topic: 'recovery_window_pressure',
        headline: `${pct}% of batches were collected after the 48h window, across ${ageOrgs.size} organisations — evidence the clean-recovery window is frequently missed.`,
        provenance: 'agent_inferred', org_count: ageOrgs.size, sample_n: ageRows.length,
        detail: { over_48h_pct: pct },
      })
    }

    // Write knowledge_items (skip anything below the k floor — belt & suspenders).
    // Upsert on the pattern's identity, so a re-run refreshes the numbers on the
    // one row rather than stacking another copy (0020).
    const toWrite = knowledge.filter(k => k.org_count >= K)
      .map(k => ({ ...k, country_code: k.country_code ?? 'ALL' }))
    if (toWrite.length) {
      await admin.from('knowledge_items').upsert(toWrite, { onConflict: 'topic,country_code' })
    }

    // Rule reviews: one standing review per dimension+band. The payload carries
    // ONLY evidence columns — state, decided_by and decided_at are deliberately
    // absent, so an upsert refreshes what the evidence says without reopening or
    // overwriting a decision a human already made. Previously this keyed off
    // state='proposed', so deciding a review caused the next run to re-propose it.
    if (reviews.length) {
      await admin.from('rule_reviews').upsert(
        reviews.map(rv => ({ ...rv, band: rv.band ?? '*' })),
        { onConflict: 'dimension,band' },
      )
    }

    return json({
      ok: true,
      patterns_found: toWrite.length,
      reviews_proposed: reviews.length,
      k_floor: K,
      note: toWrite.length ? 'Aggregate patterns written above the k-anonymity floor.' : 'No cross-org pattern met the k-anonymity floor yet (needs more orgs/records).',
    })
  } catch (e) {
    return json({ ok: false, reason: 'capture failed', detail: String(e) })
  }
})
