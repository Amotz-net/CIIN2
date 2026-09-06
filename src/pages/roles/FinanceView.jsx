import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadRuleset, gradeBatch } from '../../lib/grading'

// Finance / Investor dashboard — own-org. Instruments underwritten on VERIFIED
// performance: only verified, passing batches count as underwritable tonnage.
// Turns a graded, closure-verified record into an underwritable asset.
const CO2E_PER_T = 0.30
export function FinanceView({ profile }) {
  const orgId = profile?.org_id
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [underwritten, setUnderwritten] = useState({})

  useEffect(() => {
    let alive = true
    async function load() {
      const [{ data: rows }, rs] = await Promise.all([
        supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        loadRuleset(),
      ])
      if (!alive) return
      setBatches((rows ?? []).map(b => ({
        ...b,
        result: gradeBatch({
          arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
          foreign_matter: b.foreign_matter, age_hours: b.age_hours,
          chain_valid: b.chain_valid, signature_valid: b.signature_valid,
        }, rs),
      })))
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [orgId])

  if (loading) return <div className="card"><span className="muted">Loading underwriting book…</span></div>

  const verified = batches.filter(b => (b.result.grade === 'A' || b.result.grade === 'B') && b.measurement_conf === 'confirmed')
  const verifiedT = verified.reduce((s, b) => s + Number(b.wet_mass_t || 0), 0)
  const avoidedCO2e = Math.round(verifiedT * CO2E_PER_T * 10) / 10

  const instruments = [
    { key: 'credits', name: 'Tonnage-verified credits', basis: `${avoidedCO2e} t CO₂e avoided (directional)` },
    { key: 'pbf', name: 'Performance-based finance', basis: `disbursed against ${verifiedT} t verified delivery` },
    { key: 'insurance', name: 'Offtake insurance', basis: 'priced on passport quality signal' },
  ]

  return (
    <div className="dash-grid">
      <div className="card">
        <h2>Underwriting book</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{verified.length}</div><div className="muted" style={{ fontSize: 12 }}>verified batches</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{verifiedT} t</div><div className="muted" style={{ fontSize: 12 }}>underwritable</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{Object.values(underwritten).filter(Boolean).length}</div><div className="muted" style={{ fontSize: 12 }}>underwritten</div></div>
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Instruments <span className="pill" style={{ fontSize: 10 }}>on verified performance</span></h2>
        {instruments.map(inst => (
          <div key={inst.key} className="line-item">
            <div><b>{inst.name}</b><div className="muted" style={{ fontSize: 12 }}>{inst.basis}</div></div>
            {verified.length === 0
              ? <span className="pill grey">awaiting verified record</span>
              : underwritten[inst.key]
                ? <span className="pill green">underwritten</span>
                : <button className="btn sm" onClick={() => setUnderwritten(u => ({ ...u, [inst.key]: true }))}>Underwrite</button>}
          </div>
        ))}
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Instruments price off the verified, graded, closure-checked record — not promises. Only lab-verified A/B tonnage is underwritable. Carbon figures are directional (≈0.30 t CO₂e per tonne wet cleared in-window).</div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Verified performance record</h2>
        {verified.length ? (
          <table>
            <thead><tr><th>Batch</th><th>Grade</th><th>Mass</th></tr></thead>
            <tbody>
              {verified.map(b => (
                <tr key={b.id}>
                  <td>{b.batch_ref}</td>
                  <td><span className={'pill ' + (b.result.grade === 'A' ? 'green' : 'amber')}>{b.result.grade}</span></td>
                  <td>{b.wet_mass_t} t</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No verified performance to underwrite yet.</span></div>}
      </div>
    </div>
  )
}
