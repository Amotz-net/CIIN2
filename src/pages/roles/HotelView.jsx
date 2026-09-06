import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getForecast, getAfai, getDrift, AFAI_ATTRIBUTION } from '../../lib/feeds'

// Hotel dashboard — wired to the operational data layer (Stage 2).
// Operational data is org-scoped by RLS; we still filter by org_id client-side
// for clarity. Sargassum values are seeded-and-labelled; weather is LIVE (NOAA).

function SourceTag({ source }) {
  if (source === 'live_feed') return <span className="pill" title="Live external feed">live</span>
  if (source === 'representative') return <span className="pill grey" title="Representative data, not a live feed">representative</span>
  if (source === 'engine') return <span className="pill" title="Computed by the CIIN engine">computed</span>
  return null
}

function fmtEta(iso) {
  if (!iso) return '—'
  const ms = new Date(iso) - new Date()
  if (ms <= 0) return 'arrived'
  const h = Math.floor(ms / 3.6e6)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`
}

export function HotelView({ profile }) {
  const orgId = profile?.org_id
  const [arrivals, setArrivals] = useState([])
  const [missions, setMissions] = useState([])
  const [pools, setPools] = useState({})       // mission_id -> [hubs]
  const [summary, setSummary] = useState(null)
  const [segments, setSegments] = useState([])
  const [weather, setWeather] = useState(null)
  const [afai, setAfai] = useState(null)
  const [segAfai, setSegAfai] = useState({})   // segment_id -> live AFAI reading
  const [drift, setDrift] = useState(null)     // first-order drift for headline segment
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!orgId) return
      const [seg, arr, mis, loads] = await Promise.all([
        supabase.from('beach_segments').select('*').eq('org_id', orgId),
        supabase.from('sargassum_arrivals').select('*').eq('org_id', orgId).order('eta_at'),
        supabase.from('missions').select('*').eq('org_id', orgId).order('eta_at'),
        supabase.from('load_summaries').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1),
      ])
      if (!alive) return
      setSegments(seg.data ?? [])
      setArrivals(arr.data ?? [])
      setMissions(mis.data ?? [])
      setSummary((loads.data ?? [])[0] ?? null)

      // hub pools for the missions
      const ids = (mis.data ?? []).map(m => m.id)
      if (ids.length) {
        const { data: mh } = await supabase.from('mission_hubs').select('*').in('mission_id', ids)
        const grouped = {}
        ;(mh ?? []).forEach(h => { (grouped[h.mission_id] ||= []).push(h) })
        if (alive) setPools(grouped)
      }
      setLoading(false)

      // LIVE weather for the first segment with coordinates
      const withCoords = (seg.data ?? []).find(s => s.lat && s.lng)
      if (withCoords) {
        const w = await getForecast(withCoords.lat, withCoords.lng)
        if (alive) setWeather(w)
        // LIVE satellite AFAI for the same segment (headline panel)
        const a = await getAfai(withCoords.lat, withCoords.lng)
        if (alive) setAfai(a)
        // first-order drift for the headline segment
        const d = await getDrift(withCoords.lat, withCoords.lng)
        if (alive) setDrift(d)
      }

      // LIVE AFAI per segment — drives the Incoming panel so it agrees with satellite.
      const segList = (seg.data ?? []).filter(s => s.lat && s.lng)
      const perSeg = {}
      for (const s of segList) {
        const r = await getAfai(s.lat, s.lng)
        perSeg[s.id] = r
      }
      if (alive) setSegAfai(perSeg)
    }
    load()
    return () => { alive = false }
  }, [orgId])

  if (loading) return <div className="card"><span className="muted">Loading your dashboard…</span></div>

  return (
    <div className="dash-grid">
      {/* Incoming sargassum — driven by LIVE satellite AFAI per segment */}
      <div className="card">
        <h2>Incoming sargassum <span className="pill" style={{ fontSize: 10 }}>AFAI live</span></h2>
        {segments.filter(s => s.lat && s.lng).length ? (
          segments.filter(s => s.lat && s.lng).map(s => {
            const r = segAfai[s.id]
            let level = '—', tone = 'grey', detail = 'awaiting satellite read'
            if (r?.ok && !r.gap) { level = r.level; tone = r.level === 'elevated' ? 'red' : r.level === 'moderate' ? 'amber' : 'green'; detail = `offshore density index ${r.afai?.toExponential(2)}` }
            else if (r?.ok && r.gap) { level = 'no clear read'; tone = 'grey'; detail = 'cloud / glint / dust — honest gap' }
            else if (r && !r.ok) { level = 'unavailable'; tone = 'grey'; detail = r.reason || 'feed error' }
            return (
              <div key={s.id} className="line-item">
                <div>
                  <b style={{ textTransform: 'capitalize' }}>{level}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{s.name} · {detail}</div>
                </div>
                <span className={'pill ' + tone}>{level === 'no clear read' || level === 'unavailable' ? 'live' : 'live'}</span>
              </div>
            )
          })
        ) : <div className="empty"><span className="muted">No beach segments with coordinates yet.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Shows live offshore floating-algae density (NOAA AFAI) per segment. A tonnes-and-ETA landing forecast requires a drift/trajectory model (not yet built); see the live inundation-risk panel for shore-risk.
        </div>
      </div>

      {/* Inundation risk — LIVE, computed from AFAI via NOAA's SIR method */}
      <div className="card">
        <h2>Inundation risk <span className="pill" style={{ fontSize: 10 }}>SIR method · live</span></h2>
        {segments.filter(s => s.lat && s.lng).length ? (
          segments.filter(s => s.lat && s.lng).map(s => {
            const r = segAfai[s.id]
            let risk = '—', tone = 'grey', detail = 'awaiting satellite read'
            if (r?.ok && !r.gap && r.sir) {
              risk = r.sir
              tone = r.sir === 'high' ? 'red' : r.sir === 'medium' ? 'amber' : 'green'
              detail = `nearby AFAI peak ${r.sir_peak?.toExponential(2)} (NOAA thresholds 0.001 / 0.003)`
            } else if (r?.ok && r.gap) { risk = 'no clear read'; detail = 'cloud / glint / dust — honest gap' }
            else if (r && !r.ok) { risk = 'unavailable'; detail = r.reason || 'feed error' }
            return (
              <div key={s.id} className="line-item">
                <div>
                  <b style={{ textTransform: 'capitalize' }}>{risk}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{s.name} · {detail}</div>
                </div>
                <span className={'pill ' + tone}>live</span>
              </div>
            )
          })
        ) : <div className="empty"><span className="muted">No beach segments with coordinates yet.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Live coastal inundation RISK, computed from NOAA/USF AFAI using NOAA CoastWatch's SIR classification (thresholds 0.001 / 0.003). This is a potential-nowcast (risk of sargassum reaching shore) — <b>not</b> a tonnage or landing-time forecast, which requires a drift model. Derived from the live AFAI feed, not the official SIR product object.
        </div>
      </div>

      {/* Drift outlook — first-order, honestly labelled */}
      <div className="card">
        <h2>Drift outlook <span className="pill amber" style={{ fontSize: 10 }}>indicative</span></h2>
        {drift?.ok ? (
          <>
            <div className="line-item">
              <div>
                <b>Drifting {drift.bearing}</b>
                <div className="muted" style={{ fontSize: 12 }}>~{drift.speed_km_day} km/day · arrival window {drift.arrival_window}</div>
              </div>
              <span className="pill amber">{drift.confidence}</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              Indicative first-order drift (OSCAR surface current + windage), {drift.horizon} horizon, moderate confidence. <b>Not</b> a validated forecast and <b>not</b> a tonnage estimate — direction and rough timing only. A validated trajectory needs a full drift model (OpenDrift/OceanParcels), scaffolded for later.
            </div>
          </>
        ) : (
          <div className="empty"><span className="muted">{drift ? `Drift outlook unavailable${drift.reason ? ` (${drift.reason})` : ''}.` : 'Computing drift outlook…'}</span></div>
        )}
      </div>

      <div className="card">
        <h2>Weather <span className="pill" style={{ fontSize: 10 }}>NOAA live</span></h2>
        {weather?.ok ? (
          weather.periods.map((p, i) => (
            <div key={i} className="line-item">
              <div><b>{p.name}</b><div className="muted" style={{ fontSize: 12 }}>{p.short}</div></div>
              <div style={{ textAlign: 'right' }}>{p.temp}<div className="muted" style={{ fontSize: 12 }}>{p.wind}</div></div>
            </div>
          ))
        ) : (
          <div className="empty">
            <span className="muted">
              {weather ? `Weather feed unavailable for this location${weather.reason ? ` (${weather.reason})` : ''}.` : 'Fetching live forecast…'}
            </span>
          </div>
        )}
      </div>

      {/* Satellite sargassum (NOAA AFAI) */}
      <div className="card">
        <h2>Satellite detection <span className="pill" style={{ fontSize: 10 }}>AFAI live</span></h2>
        {afai?.ok ? (
          afai.gap ? (
            <div className="empty"><span className="muted">{afai.note}</span></div>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, textTransform: 'capitalize' }}>{afai.level}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                floating-algae index {afai.afai?.toExponential(2)} · {afai.coverage} clear pixels
                {afai.asOf ? ` · as of ${new Date(afai.asOf).toLocaleDateString()}` : ''}
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>{AFAI_ATTRIBUTION}</div>
            </>
          )
        ) : (
          <div className="empty">
            <span className="muted">{afai ? `Satellite feed unavailable${afai.reason ? ` (${afai.reason})` : ''}.` : 'Fetching satellite read…'}</span>
          </div>
        )}
      </div>

      {/* Missions + hub pools */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Missions against your property</h2>
        {missions.length ? (
          <table>
            <thead><tr><th>Mission</th><th>Load</th><th>Lands</th><th>Status</th><th>Responding hubs</th><th>Access</th></tr></thead>
            <tbody>
              {missions.map(m => {
                const hubs = pools[m.id] || []
                const covered = hubs.reduce((s, h) => s + Number(h.share_tonnes || 0), 0)
                return (
                  <tr key={m.id}>
                    <td>{m.title} <SourceTag source={m.source} /></td>
                    <td>{m.tonnes} t</td>
                    <td>{fmtEta(m.eta_at)}</td>
                    <td><span className="pill">{m.status.replace(/_/g, ' ')}</span></td>
                    <td>{hubs.length ? `${hubs.map(h => h.hub_name.split(' ')[0] + ' ' + h.share_tonnes + 't').join(' + ')} (${covered}/${m.tonnes}t)` : '—'}</td>
                    <td><span className={'pill ' + (m.access_state === 'granted' ? '' : 'amber')}>{m.access_state}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <div className="empty"><span className="muted">No missions raised against your property.</span></div>}
      </div>

      {/* Grade + closure + avoided cost */}
      <div className="card">
        <h2>Latest grade & closure</h2>
        {summary ? (
          <table><tbody>
            <tr><th>Grade</th><td><span className="pill">{summary.grade}</span> <SourceTag source={summary.source} /></td></tr>
            <tr><th>Closure</th><td>±{summary.closure_pct}% <span className="pill">{summary.closure_state?.replace(/_/g, ' ')}</span></td></tr>
            <tr><th>Recovered</th><td>{summary.recovered_t} t</td></tr>
          </tbody></table>
        ) : <div className="empty"><span className="muted">No completed loads yet.</span></div>}
      </div>

      {/* Avoided cost */}
      <div className="card">
        <h2>Avoided cost</h2>
        {summary?.avoided_cost != null ? (
          <>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)' }}>
              ${Number(summary.avoided_cost).toLocaleString()}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              vs uncoordinated cleanup + closure risk <SourceTag source={summary.source} />
            </div>
          </>
        ) : <div className="empty"><span className="muted">No avoided-cost figure yet.</span></div>}
      </div>
    </div>
  )
}
