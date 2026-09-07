import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CoastMap } from './CoastMap.jsx'
import { RoleReports } from './Reports.jsx'
import { getForecast, getAfai, getDrift, AFAI_ATTRIBUTION } from '../../lib/feeds'
import { loadRuleset, gradeBatch } from '../../lib/grading'

// Hotel dashboard — wired to the operational data layer.
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

const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function HotelView({ profile, section = 'overview' }) {
  const orgId = profile?.org_id
  const [arrivals, setArrivals] = useState([])
  const [missions, setMissions] = useState([])
  const [pools, setPools] = useState({})       // mission_id -> [hubs]
  const [summary, setSummary] = useState(null)
  const [graded, setGraded] = useState([])     // batches run through the engine
  const [segments, setSegments] = useState([])
  const [weather, setWeather] = useState(null)
  const [afai, setAfai] = useState(null)
  const [segAfai, setSegAfai] = useState({})   // segment_id -> live AFAI reading
  const [drift, setDrift] = useState(null)     // first-order drift for headline segment
  const [invoices, setInvoices] = useState([])
  const [rates, setRates] = useState([])
  const [granting, setGranting] = useState(null)
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

      // Load batches and COMPUTE grades through the config-driven engine.
      const [{ data: batchRows }, ruleset] = await Promise.all([
        supabase.from('batches').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        loadRuleset(),
      ])
      if (alive && batchRows) {
        const g = batchRows.map(b => ({
          ref: b.batch_ref,
          mass: b.wet_mass_t,
          conf: b.measurement_conf,
          result: gradeBatch({
            arsenic_total: b.arsenic_total,
            arsenic_inorganic: b.arsenic_inorganic,
            foreign_matter: b.foreign_matter,
            age_hours: b.age_hours,
            chain_valid: b.chain_valid,
            signature_valid: b.signature_valid,
          }, ruleset),
        }))
        setGraded(g)
      }

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

  // Invoices (0025) are visible to both parties, so the hotel reads the ones it
  // must pay. Rate cards are published within the country so an estimate can be
  // checked against the rate it came from.
  useEffect(() => {
    if (!orgId) return
    let alive = true
    ;(async () => {
      const [inv, rt] = await Promise.all([
        supabase.from('invoices').select('*').eq('payer_org_id', orgId).order('issued_at', { ascending: false }),
        supabase.from('cost_rates').select('*').is('effective_to', null),
      ])
      if (!alive) return
      setInvoices(inv.data ?? []); setRates(rt.data ?? [])
    })()
    return () => { alive = false }
  }, [orgId])

  // Granting access is a real write the hotel is entitled to make: it owns the
  // mission row, so mission_write (org_id = current_org_id()) permits it.
  async function grantAccess(missionId, state) {
    setGranting(missionId)
    const { error } = await supabase.from('missions').update({ access_state: state }).eq('id', missionId)
    if (!error) setMissions(ms => ms.map(m => (m.id === missionId ? { ...m, access_state: state } : m)))
    setGranting(null)
  }

  if (loading) return <div className="card"><span className="muted">Loading your dashboard…</span></div>

  // Strict: a tab renders only its own panels. Overview previously matched
  // every section, so every panel stacked onto it.
  const S = (sec) => section === sec

  // Missions the hotel must act on vs those it has already cleared.
  const awaitingAccess = missions.filter(m => m.access_state === 'pending' && m.status !== 'rejected')
  const cleared = missions.filter(m => m.access_state === 'granted' || m.access_state === 'granted_conditions')
  const outstanding = invoices.filter(i => i.status === 'sent')
  const paid = invoices.filter(i => i.status === 'paid')
  const outstandingTotal = outstanding.reduce((s, i) => s + Number(i.total || 0), 0)
  const paidTotal = paid.reduce((s, i) => s + Number(i.total || 0), 0)
  const avoided = Number(summary?.avoided_cost || 0)
  const truckRate = rates.find(r => r.unit === 'truck')
  const tonneRate = rates.find(r => r.unit === 'tonne')
  return (
    <div className="dash-grid">
      {/* Full-width and tall: the hotel's own frontage in relation to the
          responding network, scoped to this property so it opens on its coast
          rather than the whole region. */}
      {S('overview') && <CoastMap orgId={orgId} height={460} title="Your coast" />}
      {S('overview') && <>
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
          Live offshore floating-algae density (NOAA AFAI) per beach segment. See the inundation-risk panel for the risk of sargassum reaching your shore.
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
          Live coastal inundation risk, computed from NOAA/USF satellite data using NOAA CoastWatch's SIR classification. This indicates the risk of sargassum reaching shore — it is not a tonnage or landing-time forecast. Attribution: NOAA CoastWatch–AOML / USF.
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
              Indicative drift direction and rough arrival window from live ocean-current data, updated daily. Direction and timing only — not a tonnage estimate. Moderate confidence over a 3-day horizon.
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

      </>}
      {S('management') && <>
      {/* Approval queue — cleanups awaiting THIS property's access grant */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Approval queue <span className={'pill ' + (awaitingAccess.length ? 'amber' : 'green')} style={{ fontSize: 10 }}>
          {awaitingAccess.length} awaiting you</span></h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          A mission is raised from the satellite reading and authorised by the coastal authority.
          Access to your frontage is yours to grant — nothing happens on the property until you do.
        </div>
        {awaitingAccess.length ? awaitingAccess.map(m => {
          const hubs = pools[m.id] || []
          const trucks = truckRate ? Math.ceil(Number(m.tonnes || 0) / 12) : null
          return (
            <div key={m.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b>{m.title}</b>
                <span className="pill" style={{ fontSize: 10 }}>{m.status.replace(/_/g, ' ')}</span>
                <span className="muted" style={{ fontSize: 12 }}>{m.tonnes} t · lands {fmtEta(m.eta_at)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {hubs.length ? `Responding: ${hubs.map(h => h.hub_name + ' ' + h.share_tonnes + 't').join(' + ')}` : 'No hub has acknowledged yet.'}
              </div>
              {trucks != null && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Estimated removal cost <b>{money(trucks * Number(truckRate.amount))}</b>
                  <span className="muted"> · {trucks} truck loads at {money(truckRate.amount)} each
                    {m.tonnes_basis === 'indicative_length_heuristic' ? ' · tonnage indicative, not measured' : ''}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn sm" disabled={granting === m.id} onClick={() => grantAccess(m.id, 'granted')}>Grant access</button>
                <button className="btn ghost sm" disabled={granting === m.id} onClick={() => grantAccess(m.id, 'granted_conditions')}>Grant with conditions</button>
                <button className="btn sm" style={{ background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)' }}
                        disabled={granting === m.id} onClick={() => grantAccess(m.id, 'declined')}>Decline</button>
              </div>
            </div>
          )
        }) : <div className="empty"><span className="muted">Nothing awaiting your approval.</span></div>}
      </div>

      {/* Completed approvals */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Completed approvals <span className="pill grey" style={{ fontSize: 10 }}>{cleared.length}</span></h2>
        {cleared.length ? (
          <table>
            <thead><tr><th>Mission</th><th>Load</th><th>Access</th><th>Status</th></tr></thead>
            <tbody>{cleared.map(m => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td>{m.tonnes} t</td>
                <td><span className="pill green">{m.access_state.replace(/_/g, ' ')}</span></td>
                <td><span className="pill">{m.status.replace(/_/g, ' ')}</span></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><span className="muted">No access grants yet.</span></div>}
      </div>

      {/* Full mission board + hub pools */}
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

      </>}
      {S('reports') && <>
      {/* Batch grades — COMPUTED by the config-driven engine */}
      <div className="card">
        <h2>Batch grades <span className="pill" style={{ fontSize: 10 }}>computed</span></h2>
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
        ) : <div className="empty"><span className="muted">No batches to grade yet.</span></div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          Grades computed from batch measurements by CIIN's rule engine (arsenic, foreign matter, age; worst dimension binds). Ruleset is editable configuration.
        </div>
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
      </>}

      {S('invoices') && <>
      {/* Invoices the hub has raised against this property. The hotel is the
          payer: it can see them (0025 lets both parties read) but not mark them
          paid — settlement confirmation belongs to whoever issued the invoice. */}
      <div className="card">
        <h2>Outstanding <span className={'pill ' + (outstanding.length ? 'amber' : 'green')} style={{ fontSize: 10 }}>{outstanding.length}</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: outstanding.length ? 'var(--amber)' : 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(outstandingTotal)}</div>
        <div className="muted" style={{ fontSize: 12 }}>Issued and unpaid</div>
      </div>
      <div className="card">
        <h2>Paid <span className="pill green" style={{ fontSize: 10 }}>{paid.length}</span></h2>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(paidTotal)}</div>
        <div className="muted" style={{ fontSize: 12 }}>Settled to date</div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Invoice ledger</h2>
        {invoices.length ? (
          <table>
            <thead><tr><th>Reference</th><th>For</th><th>Issued</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{invoices.map(i => (
              <tr key={i.id}>
                <td>{i.invoice_ref}</td>
                <td className="muted">{i.purpose.replace(/_/g, ' ')}</td>
                <td>{fmtEta(i.issued_at)}</td>
                <td>{fmtEta(i.due_at)}</td>
                <td><span className={'pill ' + (i.status === 'paid' ? 'green' : i.status === 'sent' ? 'amber' : 'grey')}>{i.status}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(i.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><span className="muted">No invoices raised against this property yet. They appear here once a hub issues one.</span></div>}
      </div>
      </>}

      {S('finance') && <>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Financial trends</h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(paidTotal)}</div>
            <div className="muted" style={{ fontSize: 12 }}>paid for recovery</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>{money(outstandingTotal)}</div>
            <div className="muted" style={{ fontSize: 12 }}>outstanding</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(avoided)}</div>
            <div className="muted" style={{ fontSize: 12 }}>cost avoided</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {paidTotal > 0 ? (avoided / paidTotal).toFixed(2) + '×' : '—'}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>avoided per $ spent</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
          Paid and outstanding are invoiced amounts (USD). Cost avoided comes from
          <code> load_summaries.avoided_cost</code> and is a modelled figure, not an invoiced one —
          the ratio compares a measured spend against an estimate, so read it as direction rather
          than a return.
        </div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Removal rate card <span className="pill" style={{ fontSize: 10 }}>published</span></h2>
        {rates.length ? (
          <table>
            <thead><tr><th>Unit</th><th>Description</th><th style={{ textAlign: 'right' }}>Rate (USD)</th></tr></thead>
            <tbody>{rates.map(r => (
              <tr key={r.id}>
                <td>{r.unit.replace(/_/g, ' ')}</td>
                <td className="muted">{r.label || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><span className="muted">No rates published in your country yet.</span></div>}
      </div>
      </>}

      {S('reports') && <RoleReports role="hotel" profile={profile} />}
    </div>
  )
}
