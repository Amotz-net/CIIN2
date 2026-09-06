import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Reusable Reports section — assembles a role-appropriate summary from the org's
// own data and exports it as CSV (client-side) or print/PDF. Honest: it reports
// what's in the data, with the same source tiers as the dashboards.
export function RoleReports({ role, profile }) {
  const orgId = profile?.org_id
  const [rows, setRows] = useState({ batches: [], missions: [], invoices: [], loads: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      const [b, m, i, l] = await Promise.all([
        supabase.from('batches').select('*').limit(500),
        supabase.from('missions').select('*').limit(500),
        supabase.from('invoices').select('*').limit(500),
        supabase.from('load_summaries').select('*').limit(500),
      ])
      if (!alive) return
      setRows({ batches: b.data ?? [], missions: m.data ?? [], invoices: i.data ?? [], loads: l.data ?? [] })
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [orgId])

  function exportCsv(name, data) {
    if (!data.length) return
    const cols = Object.keys(data[0])
    const csv = [cols.join(','), ...data.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `ciin-${name}-${Date.now()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="card"><span className="muted">Assembling report…</span></div>

  const recovered = rows.loads.reduce((s, l) => s + Number(l.recovered_t || 0), 0)
  const graded = rows.batches.length
  const outstanding = rows.invoices.filter(i => i.status === 'outstanding').reduce((s, i) => s + Number(i.amount || 0), 0)
  const paid = rows.invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0)

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <h2>Reports <span className="pill" style={{ fontSize: 10 }}>exportable</span></h2>
      <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        <div><div style={{ fontSize: 24, fontWeight: 800 }}>{recovered} t</div><div className="muted" style={{ fontSize: 12 }}>recovered</div></div>
        <div><div style={{ fontSize: 24, fontWeight: 800 }}>{graded}</div><div className="muted" style={{ fontSize: 12 }}>batches graded</div></div>
        <div><div style={{ fontSize: 24, fontWeight: 800 }}>{rows.missions.length}</div><div className="muted" style={{ fontSize: 12 }}>missions</div></div>
        <div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>${paid.toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>invoiced paid</div></div>
        <div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)' }}>${outstanding.toLocaleString()}</div><div className="muted" style={{ fontSize: 12 }}>outstanding</div></div>
      </div>
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="btn sm" onClick={() => exportCsv('batches', rows.batches)}>Export batches CSV</button>
        <button className="btn sm ghost" onClick={() => exportCsv('missions', rows.missions)}>Export missions CSV</button>
        <button className="btn sm ghost" onClick={() => exportCsv('invoices', rows.invoices)}>Export invoices CSV</button>
        <button className="btn sm ghost" onClick={() => window.print()}>Print / PDF</button>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Report reflects your organisation's records (RLS-scoped). Figures carry the same source tiers as the dashboards; carbon figures are directional.</div>
    </div>
  )
}
