import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadRuleset, gradeBatch, permittedUses } from '../../lib/grading'

// Buyer / Exchange dashboard — own-org. Verified-biomass marketplace: only
// batches that pass (A/B, not FAIL/C) and are confirmed appear as matchable,
// with the passport (grade + permitted uses) as the assurance.
export function BuyerView({ profile }) {
  const orgId = profile?.org_id
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [matched, setMatched] = useState({})

  useEffect(() => {
    let alive = true
    async function load() {
      const [{ data: rows }, rs] = await Promise.all([
        supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        loadRuleset(),
      ])
      if (!alive) return
      const graded = (rows ?? []).map(b => {
        const result = gradeBatch({
          arsenic_total: b.arsenic_total, arsenic_inorganic: b.arsenic_inorganic,
          foreign_matter: b.foreign_matter, age_hours: b.age_hours,
          chain_valid: b.chain_valid, signature_valid: b.signature_valid,
        }, rs)
        return { ...b, result, uses: permittedUses(result.grade, b.measurement_conf === 'confirmed') }
      })
      setListings(graded)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [orgId])

  if (loading) return <div className="card"><span className="muted">Loading marketplace…</span></div>

  // Only verified, passing batches are matchable (the passport is the assurance).
  const matchable = listings.filter(b => (b.result.grade === 'A' || b.result.grade === 'B') && b.measurement_conf === 'confirmed')
  const blocked = listings.filter(b => !matchable.includes(b))

  return (
    <div className="dash-grid">
      <div className="card">
        <h2>Marketplace</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{matchable.length}</div><div className="muted" style={{ fontSize: 12 }}>verified listings</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{matchable.reduce((s, b) => s + Number(b.wet_mass_t || 0), 0)} t</div><div className="muted" style={{ fontSize: 12 }}>available</div></div>
          <div><div style={{ fontSize: 24, fontWeight: 800 }}>{Object.values(matched).filter(Boolean).length}</div><div className="muted" style={{ fontSize: 12 }}>matched</div></div>
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Verified biomass <span className="pill" style={{ fontSize: 10 }}>passport-assured</span></h2>
        {matchable.length ? (
          <table>
            <thead><tr><th>Batch</th><th>Grade</th><th>Permitted uses</th><th>Mass</th><th></th></tr></thead>
            <tbody>
              {matchable.map(b => {
                const gr = b.result.grade
                const tone = gr === 'A' ? 'green' : 'amber'
                return (
                  <tr key={b.id}>
                    <td>{b.batch_ref}</td>
                    <td><span className={'pill ' + tone}>{gr}</span> <span className="pill" style={{ fontSize: 9 }}>verified</span></td>
                    <td style={{ fontSize: 11 }}>{b.uses.permitted.slice(0, 3).map(c => c.replace(/_/g, ' ')).join(', ')}{b.uses.permitted.length > 3 ? '…' : ''}</td>
                    <td>{b.wet_mass_t} t</td>
                    <td>{matched[b.id]
                      ? <span className="pill green">matched</span>
                      : <button className="btn sm" onClick={() => setMatched(m => ({ ...m, [b.id]: true }))}>Match &amp; contract</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No verified biomass available to match yet.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Only certified, lab-verified biomass (Grade A/B) appears here. The quality passport is your assurance; grade C, failed, or unverified batches are not offered.</div>
      </div>

      {blocked.length > 0 && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Not offered</h2>
          {blocked.map(b => (
            <div key={b.id} className="line-item">
              <div><b>{b.batch_ref}</b><div className="muted" style={{ fontSize: 12 }}>grade {b.result.grade || '—'} · {b.measurement_conf}</div></div>
              <span className="pill grey">{b.result.grade === 'FAIL' ? 'quarantined' : b.result.grade === 'C' ? 'disposal only' : 'unverified'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
