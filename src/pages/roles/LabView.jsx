import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadRuleset, gradeBatch } from '../../lib/grading'

// Lab dashboard — own-org. Sample queue: batches awaiting or holding lab results.
// The lab MEASURES (returns inorganic-arsenic result); the RULES grade. Screened
// batches (no inorganic yet) are the queue; confirmed ones show the re-graded result.
export function LabView({ profile, section = 'queue' }) {
  const orgId = profile?.org_id
  const [rows, setRows] = useState([])
  const [ruleset, setRuleset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [{ data }, rs] = await Promise.all([
      supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      loadRuleset(),
    ])
    setRows(data ?? []); setRuleset(rs); setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  // Demo action: "return result" sets a confirmed inorganic value + re-grades.
  async function returnResult(b) {
    setBusy(true)
    // Illustrative confirmed inorganic derived from the field total (screened->verified).
    const inorganic = b.arsenic_total != null ? Math.round(b.arsenic_total * 0.14 * 10) / 10 : 2.0
    await supabase.from('batches').update({ arsenic_inorganic: inorganic, measurement_conf: 'confirmed' }).eq('id', b.id)
    await load(); setBusy(false)
  }

  if (loading) return <div className="card"><span className="muted">Loading laboratory dashboard…</span></div>

  const pending = rows.filter(b => b.measurement_conf === 'screened')
  const done = rows.filter(b => b.measurement_conf === 'confirmed')

  const gradeOf = (b) => ruleset ? gradeBatch({
    arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
    foreign_matter: b.foreign_matter, age_hours: b.age_hours,
    chain_valid: b.chain_valid, signature_valid: b.signature_valid,
  }, ruleset) : null

  const S = (sec) => section === sec
  return (
    <div className="dash-grid">
      {S('queue') && <>
      <div className="card">
        <h2>Sample queue</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{pending.length}</div><div className="muted" style={{ fontSize: 12 }}>awaiting result</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{done.length}</div><div className="muted" style={{ fontSize: 12 }}>confirmed</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>EN 16802</div><div className="muted" style={{ fontSize: 12 }}>method</div></div>
        </div>
      </div>

      <div className="card">
        <h2>Awaiting analysis</h2>
        {pending.length ? pending.map(b => (
          <div key={b.id} className="line-item">
            <div>
              <b>{b.batch_ref}</b>
              <div className="muted" style={{ fontSize: 12 }}>field screen {b.arsenic_total} mg/kg total · screened</div>
            </div>
            <button className="btn sm" disabled={busy} onClick={() => returnResult(b)}>Return Tier-3 result</button>
          </div>
        )) : <div className="empty"><span className="muted">No samples awaiting analysis.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>The lab measures inorganic arsenic (EN 16802). Returning a result re-grades the batch on the confirmed value — the lab never sets the grade.</div>
      </div>

      </>}
      {S('results') && <>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Confirmed results</h2>
        {done.length ? (
          <table>
            <thead><tr><th>Batch</th><th>Inorganic As</th><th>Re-graded</th></tr></thead>
            <tbody>
              {done.map(b => {
                const g = gradeOf(b); const gr = g?.grade
                const tone = gr === 'A' ? 'green' : gr === 'B' ? 'amber' : (gr === 'C' || gr === 'FAIL') ? 'red' : 'grey'
                return (
                  <tr key={b.id}>
                    <td>{b.batch_ref}</td>
                    <td>{b.arsenic_inorganic} mg/kg</td>
                    <td><span className={'pill ' + tone}>{gr || '—'}</span> <span className="pill" style={{ fontSize: 9 }}>verified</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No confirmed results yet.</span></div>}
      </div>
    </>}
    </div>
  )
}
