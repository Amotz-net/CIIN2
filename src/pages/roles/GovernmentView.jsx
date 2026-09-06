import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getAfai } from '../../lib/feeds'
import { computeScores, scoreTone } from '../../lib/riskscores'

// Government dashboard — the jurisdiction/funder-facing view.
// Reads operational data across ALL orgs in its country (RLS 0011), overlays
// live satellite risk per segment, and shows three risk scores at honest tiers
// plus a directional carbon exposure figure. Overwrites the empty stub.

const TIER_PILL = { live: 'teal', 'live-informed': 'blue', directional: 'amber' }
const CO2E_PER_T = 0.30  // t CO2e per t wet sargassum (directional, published range)

function ScoreCard({ title, score }) {
  const tier = score?.tier || 'directional'
  const tone = scoreTone(score?.value)
  return (
    <div className="card">
      <h2>{title} <span className={'pill ' + (TIER_PILL[tier] || 'grey')} style={{ fontSize: 10 }}>{tier}</span></h2>
      {score?.value != null ? (
        <>
          <div style={{ fontSize: 34, fontWeight: 800, color: `var(--${tone})` }}>{score.value}<span style={{ fontSize: 14, color: 'var(--muted)' }}>/100</span></div>
          <div className="muted" style={{ fontSize: 12 }}>{score.note}</div>
        </>
      ) : <div className="empty"><span className="muted">{score?.note || 'no data'}</span></div>}
    </div>
  )
}

export function GovernmentView({ profile }) {
  const [segments, setSegments] = useState([])
  const [orgs, setOrgs] = useState([])
  const [segReads, setSegReads] = useState({})
  const [loads, setLoads] = useState([])
  const [loading, setLoading] = useState(true)
  const country = profile?.organizations?.country_code

  useEffect(() => {
    let alive = true
    async function load() {
      // Cross-org reads (RLS 0011 permits Government to see its whole country).
      const [seg, org, ls] = await Promise.all([
        supabase.from('beach_segments').select('*'),
        supabase.from('organizations').select('id, name, role, country_code'),
        supabase.from('load_summaries').select('*'),
      ])
      if (!alive) return
      const segs = seg.data ?? []
      setSegments(segs)
      setOrgs(org.data ?? [])
      setLoads(ls.data ?? [])
      setLoading(false)

      // live AFAI/SIR per segment with coordinates
      const withCoords = segs.filter(s => s.lat && s.lng)
      const reads = {}
      for (const s of withCoords) reads[s.id] = await getAfai(s.lat, s.lng)
      if (alive) setSegReads(reads)
    }
    load()
    return () => { alive = false }
  }, [])

  if (loading) return <div className="card"><span className="muted">Loading jurisdiction dashboard…</span></div>

  const scores = computeScores(segReads)
  const hotels = orgs.filter(o => o.role === 'hotel').length
  const hubs = orgs.filter(o => o.role === 'recovery_hub').length
  const processors = orgs.filter(o => o.role === 'processor').length
  const recovered = loads.reduce((s, l) => s + Number(l.recovered_t || 0), 0)
  // Carbon exposure (DIRECTIONAL): avoided emissions from what's been recovered.
  const avoidedCO2e = Math.round(recovered * CO2E_PER_T * 10) / 10

  return (
    <div className="dash-grid">
      {/* Jurisdiction summary */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Coast management — {country}</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{segments.length}</div><div className="muted" style={{ fontSize: 12 }}>coast segments</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{hotels}</div><div className="muted" style={{ fontSize: 12 }}>hotels</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{hubs}</div><div className="muted" style={{ fontSize: 12 }}>recovery hubs</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{processors}</div><div className="muted" style={{ fontSize: 12 }}>processors</div></div>
          <div><div style={{ fontSize: 26, fontWeight: 800 }}>{recovered} t</div><div className="muted" style={{ fontSize: 12 }}>recovered</div></div>
        </div>
      </div>

      {/* Three risk scores — each at its honest tier */}
      <ScoreCard title="Coastal Health Risk" score={scores.coastal_health} />
      <ScoreCard title="Public Health Risk" score={scores.public_health} />
      <ScoreCard title="Carbon Credit Risk" score={scores.carbon_credit} />

      {/* Carbon exposure — directional */}
      <div className="card">
        <h2>Carbon exposure <span className="pill amber" style={{ fontSize: 10 }}>directional</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)' }}>{avoidedCO2e} t</div>
        <div className="muted" style={{ fontSize: 12 }}>CO₂e avoided by in-window recovery across the jurisdiction</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Directional estimate (≈0.30 t CO₂e per tonne wet sargassum cleared before decomposition). Basis for planning; confirmed figures attach on verification.
        </div>
      </div>

      {/* Coast segments with live risk */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Coast segments</h2>
        {segments.length ? (
          <table>
            <thead><tr><th>Segment</th><th>Organization</th><th>Inundation risk</th><th>Source</th></tr></thead>
            <tbody>
              {segments.map(s => {
                const r = segReads[s.id]
                const org = orgs.find(o => o.id === s.org_id)
                let risk = '—', tone = 'grey', src = 'awaiting read'
                if (r?.ok && !r.gap && r.sir) { risk = r.sir; tone = r.sir === 'high' ? 'red' : r.sir === 'medium' ? 'amber' : 'green'; src = 'live' }
                else if (r?.ok && r.gap) { risk = 'no clear read'; src = 'cloud/glint gap' }
                else if (r && !r.ok) { risk = 'unavailable'; src = r.reason || 'feed error' }
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{org?.name || '—'}</td>
                    <td><span className={'pill ' + tone} style={{ textTransform: 'capitalize' }}>{risk}</span></td>
                    <td className="muted" style={{ fontSize: 11 }}>{src}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No coast segments registered in this jurisdiction yet.</span></div>}
      </div>
    </div>
  )
}
