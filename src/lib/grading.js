// =====================================================================
// CIIN grading engine — CONFIG-DRIVEN (Master Spec §2, §11.4).
// Reads bands from the grading_rules table (draft/verified status), so the
// numbers are owner-editable and never hard-coded. Settled rules that are NOT
// config (they're the method itself): worst-dimension-wins, arsenic breaks ties,
// compounding (N+ simultaneous B-breaches -> C), broken chain/signature -> FAIL.
//
// A grade computed on any draft rule is labelled 'draft' so the UI can show
// "computed (draft ruleset)" until the owner flips rules to verified.
// =====================================================================
import { supabase } from './supabase'

let _rulesCache = null
let _policyCache = null

export async function loadRuleset() {
  if (_rulesCache && _policyCache) return { rules: _rulesCache, policy: _policyCache }
  const [{ data: rules }, { data: pol }] = await Promise.all([
    supabase.from('grading_rules').select('*'),
    supabase.from('grading_policy').select('*').eq('id', 1).maybeSingle(),
  ])
  _rulesCache = rules ?? []
  _policyCache = pol ?? { compounding_b_to_c: 3, arsenic_breaks_ties: true, closure_conforming: 15, closure_conditional: 30, status: 'draft' }
  return { rules: _rulesCache, policy: _policyCache }
}
export function clearRulesetCache() { _rulesCache = null; _policyCache = null }

// Classify one dimension's value into A/B/C using the config rows for it.
function classify(rules, dimension, value) {
  if (value == null) return null
  const rows = rules.filter(r => r.dimension === dimension || (dimension === 'arsenic' && r.dimension.startsWith('arsenic')))
  // arsenic is special: inorganic drives A/B, total drives C — handled by caller
  for (const r of rows) {
    const lo = r.low == null ? -Infinity : Number(r.low)
    const hi = r.high == null ? Infinity : Number(r.high)
    if (r.op === '<=' && value <= hi) return { band: r.band, status: r.status, citation: r.citation }
    if (r.op === '>'  && value >  lo) return { band: r.band, status: r.status, citation: r.citation }
    if (r.op === 'between' && value > lo && value <= hi) return { band: r.band, status: r.status, citation: r.citation }
  }
  return null
}

const RANK = { A: 0, B: 1, C: 2 }

// batch: { arsenic_inorganic, arsenic_total, foreign_matter, age_hours,
//          chain_valid, signature_valid }
// Returns { grade, status, binding, breaches, draft } — draft=true if any
// contributing rule is draft (so the UI can label it honestly).
export function gradeBatch(batch, ruleset) {
  const { rules, policy } = ruleset
  // integrity beats chemistry
  if (batch.chain_valid === false || batch.signature_valid === false) {
    return { grade: 'FAIL', status: 'quarantined', binding: 'broken chain/signature', breaches: [], draft: false }
  }

  const dims = []
  // Arsenic: a CONFIRMED inorganic reading drives A/B/C (it's the regulated value).
  // The total ceiling only forces C when we have NO inorganic reading (screened only).
  if (batch.arsenic_total != null || batch.arsenic_inorganic != null) {
    let asRes = null
    const totalRow = rules.find(r => r.dimension === 'arsenic_total' && r.band === 'C')
    const ceiling = totalRow ? Number(totalRow.low) : 40
    if (batch.arsenic_inorganic != null) {
      // confirmed inorganic present -> classify on it
      asRes = classify(rules, 'arsenic_inorganic', batch.arsenic_inorganic)
      // if inorganic itself exceeds the total ceiling, that's still C
      if (batch.arsenic_inorganic > ceiling) asRes = { band: 'C', status: totalRow?.status ?? 'draft', citation: totalRow?.citation }
    } else if (batch.arsenic_total != null && batch.arsenic_total > ceiling) {
      // screened only, over ceiling -> C
      asRes = { band: 'C', status: totalRow?.status ?? 'draft', citation: totalRow?.citation }
    } else if (batch.arsenic_total != null) {
      // screened only, under ceiling -> provisional B (needs lab to confirm A)
      asRes = { band: 'B', status: 'draft', citation: 'screened total under ceiling; lab confirmation needed for A' }
    }
    if (asRes) dims.push({ dim: 'arsenic', ...asRes })
  }
  const fm = classify(rules, 'foreign_matter', batch.foreign_matter)
  if (fm) dims.push({ dim: 'foreign_matter', ...fm })
  const age = classify(rules, 'age_hours', batch.age_hours)
  if (age) dims.push({ dim: 'age_hours', ...age })

  if (!dims.length) return { grade: null, status: 'draft', binding: 'no measurements', breaches: [], draft: true }

  // worst dimension wins
  let worst = Math.max(...dims.map(d => RANK[d.band]))
  const bBreaches = dims.filter(d => d.band === 'B')
  // compounding: N+ simultaneous B-breaches escalate to C
  if (worst === 1 && bBreaches.length >= policy.compounding_b_to_c) worst = 2

  const grade = worst === 2 ? 'C' : worst === 1 ? 'B' : 'A'
  // binding constraint: the worst dim; arsenic breaks ties if configured
  const worstDims = dims.filter(d => RANK[d.band] === Math.max(...dims.map(x => RANK[x.band])))
  const binding = policy.arsenic_breaks_ties
    ? (worstDims.find(d => d.dim === 'arsenic') || worstDims[0])
    : worstDims[0]

  const draft = dims.some(d => d.status === 'draft') || policy.status === 'draft'
  return {
    grade,
    status: draft ? 'computed_draft' : 'computed',
    binding: binding?.dim ?? null,
    breaches: dims.map(d => ({ dim: d.dim, band: d.band })),
    draft,
  }
}

// Grade -> permitted vs excluded destination channels (usage & limits).
// Master-spec channel logic: hard-ceiling (agri/food) needs A + confirmed;
// B may use B-channels; C is controlled disposal; FAIL is quarantined.
const HARD_CEILING = ['biofertiliser', 'compost_for_sale', 'soil_amendment']
const B_CHANNELS = ['alginate_extraction', 'anaerobic_digestion', 'biochar_pyrolysis', 'construction_materials', 'non_food_bioplastics']
export function permittedUses(grade, confirmed) {
  if (grade === 'FAIL') return { permitted: [], excluded: [...HARD_CEILING, ...B_CHANNELS], note: 'quarantined — chain/signature invalid' }
  if (grade === 'C') return { permitted: ['controlled_disposal'], excluded: [...HARD_CEILING, ...B_CHANNELS], note: 'grade C — disposal only' }
  if (grade === 'B') return { permitted: B_CHANNELS, excluded: HARD_CEILING, note: 'B — non-food channels; agri excluded' }
  if (grade === 'A') {
    if (confirmed) return { permitted: [...HARD_CEILING, ...B_CHANNELS], excluded: [], note: 'A verified — all channels' }
    return { permitted: B_CHANNELS, excluded: HARD_CEILING, note: 'A screened — agri needs lab confirmation' }
  }
  return { permitted: [], excluded: [], note: 'ungraded' }
}

// Closure banding (config policy). streams: [{share, manifested}], route.
export function closeLedger(streams, ruleset) {
  const { policy } = ruleset
  const anyOpen = streams.some(s => s.manifested === false)
  const total = streams.reduce((s, x) => s + Number(x.share || 0), 0)
  const errPct = Math.round((total - 1) * 1000) / 10
  let state = 'non_conforming'
  if (anyOpen) state = 'non_conforming'                                  // open manifest fails regardless
  else if (Math.abs(errPct) <= policy.closure_conforming) state = 'conforming'
  else if (Math.abs(errPct) <= policy.closure_conditional) state = 'conditional'
  return { errPct, state, anyOpen }
}
