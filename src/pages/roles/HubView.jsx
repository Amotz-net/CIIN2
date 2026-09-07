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
  const [invoices, setInvoices] = useState([])
  const [rates, setRates] = useState([])
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [issuing, setIssuing] = useState(null)

  async function load() {
    // A mission belongs to the coastal asset owner; this hub reaches it through
    // its mission_hubs pool row (0021). Filtering on missions.org_id alone —
    // which this view used to do — only ever found the hub's own seeded rows and
    // never a mission the watcher raised against a hotel's frontage.
    const [{ data: own }, { data: pool }, { data: batchRows }, ruleset, { data: inv }, { data: rt }, { data: og }] =
      await Promise.all([
        supabase.from('missions').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('mission_hubs').select('*, missions(*)').eq('org_id', orgId),
        supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        loadRuleset(),
        supabase.from('invoices').select('*').eq('issuer_org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('cost_rates').select('*').eq('org_id', orgId).is('effective_to', null),
        supabase.from('organizations').select('id, name, role, country_code'),
      ])

    const byId = new Map()
    for (const m of own ?? []) byId.set(m.id, { ...m, pool: null })
    for (const ph of pool ?? []) {
      if (!ph.missions) continue
      const prev = byId.get(ph.missions.id) || { ...ph.missions }
      byId.set(ph.missions.id, { ...prev, ...ph.missions, pool: ph })
    }
    setMissions([...byId.values()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')))
    setInvoices(inv ?? []); setRates(rt ?? []); setOrgs(og ?? [])
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

  // Acknowledging the alert and starting work are different acts. The first
  // tells the network this hub has picked the mission up; the second commits the
  // line. mission_hubs.accepted was built for exactly this.
  async function acknowledge(m) {
    if (!m.pool) return
    setBusy(true)
    await supabase.from('mission_hubs').update({ accepted: true }).eq('id', m.pool.id)
    await load(); setBusy(false)
  }
  async function startLine(m) {
    setBusy(true)
    await supabase.from('missions').update({ status: 'in_progress', line_step: 1 }).eq('id', m.id)
    await load(); setBusy(false)
  }

  // Issue an invoice. The hub is always the issuer; the payer is the hotel for
  // recovery, or a processor for transport and pre-processing.
  async function issueInvoice(m, payerOrgId, purpose) {
    const rate = rates.find(r => r.unit === (purpose === 'recovery' ? 'truck' : 'tonne'))
    if (!rate || !payerOrgId) return
    setIssuing(m.id + purpose)
    const qty = purpose === 'recovery'
      ? Math.ceil(Number(m.tonnes || 0) / 12)          // 12 t per truck load
      : Number(m.tonnes || 0)
    const amount = Math.round(qty * Number(rate.amount) * 100) / 100
    const { data: ref } = await supabase.rpc('next_invoice_ref', { p_org: orgId })
    const { data: created, error } = await supabase.from('invoices').insert({
      invoice_ref: ref,
      issuer_org_id: orgId,
      payer_org_id: payerOrgId,
      mission_id: m.id,
      purpose,
      status: 'sent',
      subtotal: amount, tax: 0, total: amount,
      issued_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    }).select('id').single()
    if (!error && created) {
      await supabase.from('invoice_lines').insert({
        invoice_id: created.id, rate_id: rate.id,
        description: purpose === 'recovery'
          ? `Recovery — ${m.title}` : `Transport and pre-processing — ${m.title}`,
        qty, unit: rate.unit, unit_rate: rate.amount, amount,
      })
    }
    await load(); setIssuing(null)
  }

  // Settlement is the issuer's to confirm (0025): the payer cannot mark its own
  // invoice paid.
  async function markPaid(inv) {
    setBusy(true)
    await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inv.id)
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

  const S = (sec) => section === sec   // strict: a tab renders only its own panels
  const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const orgName = (id) => orgs.find(o => o.id === id)?.name || '—'
  const processors = orgs.filter(o => o.role === 'processor')
  const unacked = missions.filter(m => m.pool && !m.pool.accepted)
  const issued = invoices.filter(i => i.status === 'sent')
  const settled = invoices.filter(i => i.status === 'paid')
  const owedTotal = issued.reduce((s, i) => s + Number(i.total || 0), 0)
  const paidTotal = settled.reduce((s, i) => s + Number(i.total || 0), 0)
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
      {/* Dispatched to this hub — the alert. Acknowledging tells the network the
          hub has it; starting the line is a separate, later commitment. */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Dispatched to you <span className={'pill ' + (unacked.length ? 'amber' : 'green')} style={{ fontSize: 10 }}>
          {unacked.length} unacknowledged</span></h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Missions the agent raised from the satellite reading and ranked this hub to answer.
          Acknowledge to claim it; the property still has to grant access before work starts.
        </div>
        {missions.filter(m => m.pool).length ? missions.filter(m => m.pool).map(m => {
          const inv = invoices.filter(i => i.mission_id === m.id)
          const canInvoice = m.status === 'completed' || m.line_step >= 9
          return (
            <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b>{m.title}</b>
                <span className={'pill ' + (m.pool.accepted ? 'green' : 'amber')} style={{ fontSize: 10 }}>
                  {m.pool.accepted ? 'acknowledged' : 'awaiting acknowledgement'}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  your share {m.pool.share_tonnes} t of {m.tonnes} t · {orgName(m.org_id)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                authority {m.status.replace(/_/g, ' ')} · access {m.access_state}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {!m.pool.accepted && <button className="btn sm" disabled={busy} onClick={() => acknowledge(m)}>Acknowledge</button>}
                {m.pool.accepted && m.line_step === 0 && m.access_state === 'granted' &&
                  <button className="btn sm" disabled={busy} onClick={() => startLine(m)}>Start line</button>}
                {m.pool.accepted && m.line_step === 0 && m.access_state !== 'granted' &&
                  <span className="muted" style={{ fontSize: 11 }}>Waiting on the property to grant access.</span>}
                {canInvoice && !inv.some(i => i.purpose === 'recovery') &&
                  <button className="btn ghost sm" disabled={issuing === m.id + 'recovery'}
                          onClick={() => issueInvoice(m, m.org_id, 'recovery')}>
                    Invoice {orgName(m.org_id)}
                  </button>}
                {canInvoice && processors.length > 0 && !inv.some(i => i.purpose === 'transport_preprocessing') &&
                  <button className="btn ghost sm" disabled={issuing === m.id + 'transport_preprocessing'}
                          onClick={() => issueInvoice(m, processors[0].id, 'transport_preprocessing')}>
                    Invoice {processors[0].name} — transport &amp; pre-processing
                  </button>}
                {inv.length > 0 && <span className="muted" style={{ fontSize: 11 }}>
                  {inv.length} invoice{inv.length > 1 ? 's' : ''} raised</span>}
                {!canInvoice && <span className="muted" style={{ fontSize: 11 }}>Invoiceable once the line completes.</span>}
              </div>
            </div>
          )
        }) : <div className="empty"><span className="muted">Nothing dispatched to this hub yet. The watcher raises missions from the satellite feed and ranks hubs by spare capacity.</span></div>}
      </div>

      {/* Missions this hub owns outright (seeded or self-raised) */}
      {missions.some(m => !m.pool) && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Own missions</h2>
          {missions.filter(m => !m.pool).map(m => (
            <div key={m.id} className="line-item">
              <div>
                <div><b>{m.title}</b></div>
                <div className="muted" style={{ fontSize: 12 }}>{m.tonnes} t · authority {m.status.replace(/_/g, ' ')} · access {m.access_state}</div>
              </div>
              {m.line_step === 0 && <button className="btn sm" disabled={busy} onClick={() => startLine(m)}>Start line</button>}
            </div>
          ))}
        </div>
      )}

      </>}
      {S('invoices') && <>
      <div className="card">
        <h2>Owed to you <span className={'pill ' + (issued.length ? 'amber' : 'green')} style={{ fontSize: 10 }}>{issued.length}</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: issued.length ? 'var(--amber)' : 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(owedTotal)}</div>
        <div className="muted" style={{ fontSize: 12 }}>Issued and unpaid</div>
      </div>
      <div className="card">
        <h2>Settled <span className="pill green" style={{ fontSize: 10 }}>{settled.length}</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(paidTotal)}</div>
        <div className="muted" style={{ fontSize: 12 }}>Received to date</div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Invoices you have issued</h2>
        {invoices.length ? (
          <table>
            <thead><tr><th>Reference</th><th>Billed to</th><th>For</th><th>Issued</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th></th></tr></thead>
            <tbody>{invoices.map(i => (
              <tr key={i.id}>
                <td>{i.invoice_ref}</td>
                <td>{orgName(i.payer_org_id)}</td>
                <td className="muted">{i.purpose.replace(/_/g, ' ')}</td>
                <td>{i.issued_at ? new Date(i.issued_at).toLocaleDateString() : '—'}</td>
                <td><span className={'pill ' + (i.status === 'paid' ? 'green' : i.status === 'sent' ? 'amber' : 'grey')}>{i.status}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(i.total)}</td>
                <td>{i.status === 'sent' && <button className="btn ghost sm" disabled={busy} onClick={() => markPaid(i)}>Mark paid</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><span className="muted">No invoices issued yet. Raise one from a completed mission in Sargassum.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
          You issue and you confirm settlement — a payer marking its own invoice paid would be
          self-certification, so the payer sees these but cannot change them.
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Your rate card <span className="pill" style={{ fontSize: 10 }}>published in-country</span></h2>
        {rates.length ? (
          <table>
            <thead><tr><th>Unit</th><th>Description</th><th style={{ textAlign: 'right' }}>Rate (USD)</th></tr></thead>
            <tbody>{rates.map(r => (
              <tr key={r.id}><td>{r.unit.replace(/_/g, ' ')}</td><td className="muted">{r.label || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</td></tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><span className="muted">No rates published. Invoices cannot be raised until this hub has a rate card.</span></div>}
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
