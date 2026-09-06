import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadRuleset, gradeBatch } from '../../lib/grading'

// Recovery Hub dashboard — own-org scoping. Mission queue, the 9-step recovery
// line (advanceable), capacity, and deliveries with engine-COMPUTED grades.
// Completes the operational loop: hotel sees inbound -> hub acts here.

const LINE_STEPS = [
  'Receiving', 'Weighing', 'De-sanding', 'Dewatering', 'Drying',
  'Baling', 'Storage', 'Quality certification', 'Shipment',
]

export function HubView({ profile, section = 'overview' }) {
  const orgId = profile?.org_id
  const [missions, setMissions] = useState([])
  const [graded, setGraded] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [{ data: mis }, { data: batchRows }, ruleset] = await Promise.all([
      supabase.from('missions').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      loadRuleset(),
    ])
    setMissions(mis ?? [])
    setGraded((batchRows ?? []).map(b => ({
      ref: b.batch_ref, mass: b.wet_mass_t, conf: b.measurement_conf,
      result: gradeBatch({
        arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
        foreign_matter: b.foreign_matter, age_hours: b.age_hours,
        chain_valid: b.chain_valid, signature_valid: b.signature_valid,
      }, ruleset),
    })))
    setLoading(false)
  }
  useEffect(() => { load() }, [orgId])

  async function acknowledge(m) {
    setBusy(true)
    await supabase.from('missions').update({ status: 'in_progress', line_step: 1 }).eq('id', m.id)
    await load(); setBusy(false)
  }
  async function advance(m) {
    if (m.line_step >= 9) return
    setBusy(true)
    const next = m.line_step + 1
    const patch = { line_step: next }
    if (next >= 9) patch.status = 'completed'
    await supabase.from('missions').update(patch).eq('id', m.id)
    await load(); setBusy(false)
  }

  if (loading) return <div className="card"><span className="muted">Loading hub dashboard…</span></div>

  const active = missions.find(m => m.line_step > 0 && m.line_step < 9)
  const queued = missions.filter(m => m.line_step === 0)
  const dayCap = 180, used = active ? Math.round((active.line_step / 9) * 100) : 0

  const S = (sec) => section === 'overview' || section === sec
  return (
    <div className="dash-grid">
      {S('overview') && <>
      {/* Capacity */}
      <div className="card">
        <h2>Capacity</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{dayCap} t</div><div className="muted" style={{ fontSize: 12 }}>daily capacity</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{missions.length}</div><div className="muted" style={{ fontSize: 12 }}>missions</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{used}%</div><div className="muted" style={{ fontSize: 12 }}>line progress</div></div>
        </div>
      </div>

      </>}
      {S('queue') && <>
      {/* Mission queue */}
      <div className="card">
        <h2>Mission queue</h2>
        {queued.length ? queued.map(m => (
          <div key={m.id} className="line-item">
            <div>
              <b>{m.title}</b>
              <div className="muted" style={{ fontSize: 12 }}>{m.tonnes} t · authority {m.status.replace(/_/g, ' ')} · access {m.access_state}</div>
            </div>
            <button className="btn sm" disabled={busy} onClick={() => acknowledge(m)}>Acknowledge & start</button>
          </div>
        )) : <div className="empty"><span className="muted">No missions waiting. {active ? 'One in progress →' : ''}</span></div>}
      </div>

      </>}
      {S('line') && <>
      {/* Active recovery line */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Active recovery line</h2>
        {active ? (
          <>
            <div className="muted" style={{ marginBottom: 10 }}>{active.title} · {active.tonnes} t</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {LINE_STEPS.map((s, i) => {
                const n = i + 1
                const done = active.line_step > n, cur = active.line_step === n
                const bg = done ? 'var(--green)' : cur ? 'var(--teal)' : 'var(--panel2, #23292E)'
                const col = (done || cur) ? '#0c1a17' : 'var(--muted)'
                return (
                  <span key={i} style={{ padding: '6px 10px', borderRadius: 8, background: bg, color: col, fontSize: 12, border: '1px solid var(--line)' }}>
                    {n}. {s}{n === 8 ? ' (sample)' : ''}
                  </span>
                )
              })}
            </div>
            {active.line_step < 9 ? (
              <button className="btn" disabled={busy} onClick={() => advance(active)}>
                {active.line_step === 7 ? 'Submit sample to lab (step 8)' : `Advance to step ${active.line_step + 1}`}
              </button>
            ) : <span className="pill green">line complete — shipped</span>}
          </>
        ) : <div className="empty"><span className="muted">No active cleanup. Acknowledge a mission to start the line.</span></div>}
      </div>

      </>}
      {S('batches') && <>
      {/* Deliveries with computed grades */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Batches &amp; grades <span className="pill" style={{ fontSize: 10 }}>computed</span></h2>
        {graded.length ? (
          <table>
            <thead><tr><th>Batch</th><th>Grade</th><th>Basis</th></tr></thead>
            <tbody>
              {graded.map((g, i) => {
                const gr = g.result?.grade
                const tone = gr === 'A' ? 'green' : gr === 'B' ? 'amber' : gr === 'C' ? 'red' : gr === 'FAIL' ? 'red' : 'grey'
                return (
                  <tr key={i}>
                    <td>{g.ref}<div className="muted" style={{ fontSize: 11 }}>{g.mass} t · {g.conf}</div></td>
                    <td><span className={'pill ' + tone}>{gr || '—'}</span> <span className="pill" style={{ fontSize: 9 }}>{g.result?.draft ? 'draft ruleset' : 'verified'}</span></td>
                    <td className="muted" style={{ fontSize: 11 }}>binding: {g.result?.binding || 'clean'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No batches yet.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Grades computed by CIIN's rule engine from batch measurements. Ruleset is editable configuration.
        </div>
      </div>
    </>}
    </div>
  )
}
