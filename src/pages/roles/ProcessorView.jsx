import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadRuleset, gradeBatch, permittedUses, closeLedger } from '../../lib/grading'

// Processor dashboard — the certification-authority payoff. Certification status
// is DERIVED from batch evidence (not a stored flag): all batches pass -> certified;
// any FAIL/C -> blocked. Quality passports show grade + usage/limits from the engine.
// Own-org scoping.

const CHANNEL_LABEL = (c) => c.replace(/_/g, ' ')

export function ProcessorView({ profile }) {
  const orgId = profile?.org_id
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const org = profile?.organizations

  useEffect(() => {
    let alive = true
    async function load() {
      const [{ data: rows }, ruleset] = await Promise.all([
        supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        loadRuleset(),
      ])
      if (!alive) return
      const graded = (rows ?? []).map(b => {
        const result = gradeBatch({
          arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
          foreign_matter: b.foreign_matter, age_hours: b.age_hours,
          chain_valid: b.chain_valid, signature_valid: b.signature_valid,
        }, ruleset)
        const uses = permittedUses(result.grade, b.measurement_conf === 'confirmed')
        return { ...b, result, uses }
      })
      setBatches(graded)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [orgId])

  if (loading) return <div className="card"><span className="muted">Loading certification dashboard…</span></div>

  // Certification status DERIVED from evidence:
  const anyFail = batches.some(b => b.result.grade === 'FAIL')
  const anyC = batches.some(b => b.result.grade === 'C')
  const anyDraft = batches.some(b => b.result.draft)
  const passing = batches.filter(b => b.result.grade === 'A' || b.result.grade === 'B').length
  let certStatus, certTone, certNote
  if (!batches.length) { certStatus = 'No evidence'; certTone = 'grey'; certNote = 'Submit graded batches to establish certification.' }
  else if (anyFail) { certStatus = 'Suspended'; certTone = 'red'; certNote = 'A batch failed chain-of-custody/signature. Resolve to restore certification.' }
  else if (anyC) { certStatus = 'Conditional'; certTone = 'amber'; certNote = 'A grade-C batch is present. Certification conditional pending corrective action.' }
  else { certStatus = 'Active'; certTone = 'green'; certNote = 'All batches meet grade thresholds.' }

  const blockers = []
  if (anyFail) blockers.push('Batch with broken chain/signature (FAIL) present')
  if (anyC) blockers.push('Grade-C batch requires corrective action')
  if (anyDraft) blockers.push('Grades rest on a draft ruleset (pending sign-off)')

  return (
    <div className="dash-grid">
      {/* Certification status — derived from evidence */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Certification status <span className={'pill ' + certTone}>{certStatus}</span> <span className="pill" style={{ fontSize: 10 }}>computed from evidence</span></h2>
        <div className="muted" style={{ marginBottom: 8 }}>{certNote}</div>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{batches.length}</div><div className="muted" style={{ fontSize: 12 }}>batches on file</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{passing}</div><div className="muted" style={{ fontSize: 12 }}>passing (A/B)</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800, color: `var(--${certTone})` }}>{certStatus}</div><div className="muted" style={{ fontSize: 12 }}>status</div></div>
        </div>
        {blockers.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Blocking / attention:</div>
            {blockers.map((b, i) => <div key={i} style={{ fontSize: 12 }}>• {b}</div>)}
          </div>
        )}
      </div>

      {/* Quality passports with usage & limits */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Quality passports <span className="pill" style={{ fontSize: 10 }}>computed</span></h2>
        {batches.length ? batches.map((b, i) => {
          const gr = b.result.grade
          const tone = gr === 'A' ? 'green' : gr === 'B' ? 'amber' : (gr === 'C' || gr === 'FAIL') ? 'red' : 'grey'
          return (
            <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <b>{b.batch_ref}</b>
                  <span className={'pill ' + tone} style={{ marginLeft: 8 }}>{gr || '—'}</span>
                  <span className="pill" style={{ marginLeft: 4, fontSize: 9 }}>{b.measurement_conf}</span>
                  <span className="pill" style={{ marginLeft: 4, fontSize: 9 }}>{b.result.draft ? 'draft ruleset' : 'verified'}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{b.wet_mass_t} t · binding: {b.result.binding || 'clean'}</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span className="muted">{b.uses.note}</span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {b.uses.permitted.map(c => <span key={c} className="pill green" style={{ fontSize: 10 }}>✓ {CHANNEL_LABEL(c)}</span>)}
                {b.uses.excluded.map(c => <span key={c} className="pill red" style={{ fontSize: 10 }}>✕ {CHANNEL_LABEL(c)}</span>)}
              </div>
            </div>
          )
        }) : <div className="empty"><span className="muted">No batches on file.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Each passport's permitted vs excluded uses are set by the batch grade through CIIN's rules. Hard-ceiling (agricultural/food) channels require Grade A with lab-confirmed inorganic arsenic.
        </div>
      </div>

      {/* Closure ledger (illustrative streams for the demo batch) */}
      <div className="card">
        <h2>Closure ledger</h2>
        <ClosureCard />
      </div>

      {/* Printable certificate */}
      <div className="card">
        <h2>Certificate</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: 'var(--muted)' }}>CIIN CERTIFICATE OF VERIFIED HANDLING</div>
          <div style={{ fontSize: 18, fontWeight: 800, margin: '8px 0' }}>{org?.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>Status: <span className={'pill ' + certTone}>{certStatus}</span></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Attests verified extraction, collection & arsenic-disposal handling, on graded batch evidence.</div>
        </div>
        <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => window.print()}>Print / save PDF</button>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Certificate reflects live evidence; it is not valid while status is Suspended.</div>
      </div>
    </div>
  )
}

function ClosureCard() {
  const [res, setRes] = useState(null)
  useEffect(() => {
    let alive = true
    loadRuleset().then(rs => {
      // illustrative residual streams for a processed load (all manifested)
      const streams = [{ share: 0.62, manifested: true }, { share: 0.30, manifested: true }, { share: 0.09, manifested: true }]
      if (alive) setRes(closeLedger(streams, rs))
    })
    return () => { alive = false }
  }, [])
  if (!res) return <div className="muted">…</div>
  const tone = res.state === 'conforming' ? 'green' : res.state === 'conditional' ? 'amber' : 'red'
  return (
    <>
      <div style={{ fontSize: 28, fontWeight: 800, color: `var(--${tone})` }}>±{Math.abs(res.errPct)}%</div>
      <div className="muted" style={{ fontSize: 12 }}>mass-balance closure · <span className={'pill ' + tone}>{res.state.replace(/_/g, ' ')}</span></div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Residual streams reconciled against the processed load. Open (unmanifested) streams fail closure regardless of arithmetic.</div>
    </>
  )
}
