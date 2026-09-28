import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEVELS } from '../lib/alert'

// Command centre — the first thing every role sees: the regional satellite
// picture with a daily / monthly / annual filter, the headline figures, and
// what is waiting on a decision.
// The map and tonnages are SATsum's (CONABIO, CC BY 4.0), not CIIN's; the
// caption says so and says the image has been cropped.

const SITE = 'https://simar.conabio.gob.mx/satsum'
const LEVELS_OF = [['1d', 'Daily'], ['mensual', 'Monthly'], ['anual', 'Annual']]
const COUNTRY = { JM: 'Jamaica', PR: 'Puerto Rico', BB: 'Barbados', DO: 'Dominican Republic' }
// Where each role goes to act on a mission.
const ACT_ON = { government: 'overview', hotel: 'management', recovery_hub: 'queue' }
const HOUR = 60 * 60 * 1000

// Where a coordinate falls on SATsum's Greater Caribbean image. The image is a
// plain latitude/longitude grid; its corners were measured from the outlines of
// Cuba, Jamaica, Hispaniola and Puerto Rico, which agree to about a tenth of a
// degree. IMG/FRAME corrects for the strip cropped off the bottom.
const WEST = -98.2, NORTH = 33.1, SPAN_LNG = 47.4, SPAN_LAT = 25.7, CROP = 542.5 / 490
const place = (lat, lng) => ({ left: ((lng - WEST) / SPAN_LNG) * 100 + '%', top: ((NORTH - lat) / SPAN_LAT) * CROP * 100 + '%' })
const CENTRE = { JM: [18.15, -77.3], PR: [18.22, -66.45], BB: [13.17, -59.55], DO: [18.9, -70.3] }

const STAGES = [
  ['proposed', 'Raised', 'From the satellite reading; awaiting the authority'],
  ['authority_approved', 'Authorised', 'Approved; awaiting access to the property'],
  ['access_granted', 'Access granted', 'Owner has allowed work on the frontage'],
  ['in_progress', 'Collection', 'On the recovery line'],
  ['completed', 'Completed', 'Line finished; ready to invoice'],
]
const TONE = { proposed: 'amber', authority_approved: '', access_granted: '', in_progress: '', completed: 'green', rejected: 'red' }

const fmt = n => Math.round(Number(n || 0)).toLocaleString()
const utc = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })
function label(nivel, f) {
  if (!f) return '—'
  if (nivel === 'anual') return f
  if (nivel === 'mensual') return utc(`${f.slice(0, 4)}-${f.slice(4, 6)}-01`, { month: 'long', year: 'numeric' })
  return utc(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`, { day: 'numeric', month: 'short', year: 'numeric' })
}
const mapUrl = (nivel, f) => `${SITE}/mapa?zona=gran_caribe&nivel=${nivel}&fecha=${f}&var=biomasa&w=1400&fmt=webp`

export function CommandCentre({ profile, role, onNavigate, admin = false }) {
  const country = COUNTRY[profile?.organizations?.country_code] || 'Jamaica'
  const [d, setD] = useState(null)
  const [nivel, setNivel] = useState('1d')
  const [per, setPer] = useState(null)         // { dates, fecha, zones }
  const [idx, setIdx] = useState(null)         // position in per.dates
  const [zones, setZones] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [missions, setMissions] = useState([])
  const [beaches, setBeaches] = useState([])
  const [orgs, setOrgs] = useState([])
  const [batches, setBatches] = useState([])
  const [show, setShow] = useState({ beaches: true, hubs: true })
  const [tick, setTick] = useState(0)
  const asked = useRef(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), HOUR); return () => clearInterval(id) }, [])

  useEffect(() => {
    let alive = true
    supabase.functions.invoke('regional?country=' + encodeURIComponent(country), { body: {} })
      .then(({ data }) => { if (alive && data?.ok) setD(data) })
    // Row-level security decides which missions this organisation can see.
    supabase.from('missions').select('id, title, status, tonnes, eta_at').order('eta_at', { ascending: true }).limit(200)
      .then(({ data }) => { if (alive) setMissions(data ?? []) })
    supabase.from('beach_segments').select('id, name, lat, lng').then(({ data }) => { if (alive) setBeaches((data ?? []).filter(b => b.lat && b.lng)) })
    supabase.from('organizations').select('id, name, role, country_code').then(({ data }) => { if (alive) setOrgs(data ?? []) })
    if (admin) supabase.from('batches').select('id, wet_mass_t, measurement_conf').then(({ data }) => { if (alive) setBatches(data ?? []) })
    return () => { alive = false }
  }, [country, tick, profile?.org_id, admin])

  // Changing the filter loads that level's list of published maps.
  useEffect(() => {
    let alive = true
    setPlaying(false); setPer(null); setIdx(null); setZones(null)
    supabase.functions.invoke(`regional?action=period&nivel=${nivel}`, { body: {} }).then(({ data }) => {
      if (!alive || !data?.ok) return
      setPer(data); setIdx(data.dates.length - 1); setZones(data.zones)
    })
    return () => { alive = false }
  }, [nivel, tick])

  const fecha = per && idx != null ? per.dates[idx] : null

  // Country figures follow the date, but only once it has stopped moving.
  useEffect(() => {
    if (!per || !fecha || playing || fecha === per.fecha) { if (per && fecha === per.fecha) setZones(per.zones); return }
    const mine = ++asked.current
    const id = setTimeout(() => {
      supabase.functions.invoke(`regional?action=period&nivel=${nivel}&fecha=${fecha}`, { body: {} })
        .then(({ data }) => { if (mine === asked.current) setZones(data?.ok ? data.zones : null) })
    }, 350)
    return () => clearTimeout(id)
  }, [fecha, playing, per, nivel])

  useEffect(() => {
    if (!playing || !per) return
    const id = setInterval(() => setIdx(i => {
      if (i >= per.dates.length - 1) { setPlaying(false); return i }
      return i + 1
    }), 700)
    return () => clearInterval(id)
  }, [playing, per])

  const play = () => {
    if (playing) return setPlaying(false)
    // From the end, replay the most recent stretch rather than sixteen years.
    if (idx >= per.dates.length - 1) setIdx(Math.max(0, per.dates.length - (nivel === '1d' ? 30 : nivel === 'mensual' ? 24 : per.dates.length)))
    setPlaying(true)
  }

  const k = useMemo(() => {
    if (!d) return null
    const gc = d.series?.payload?.greater_caribbean ?? []
    const last = gc[gc.length - 1], prev = gc[gc.length - 2]
    const all = [...(d.eez?.payload ?? [])].sort((a, b) => b.t - a.t)
    const mine = all.find(z => z.zone === country), th = d.thresholds
    const density = mine && th ? mine.t / th.area_km2 : null
    const daily = d.forecast?.payload?.country_daily_stranding ?? []
    const peak = daily.length ? daily.indexOf(Math.max(...daily)) : -1
    let peakDay = null
    if (peak >= 0) { const p = new Date(d.forecast.payload.analysis + 'T12:00:00Z'); p.setUTCDate(p.getUTCDate() + peak + 1); peakDay = p }
    return {
      last, change: last && prev ? ((last.t - prev.t) / prev.t) * 100 : null, asOf: d.series?.as_of,
      mine, rank: all.findIndex(z => z.zone === country) + 1, of: all.length,
      level: density == null ? null : LEVELS[th.umbrales.filter(u => density >= u).length],
      peakDay, peakT: peak >= 0 ? daily[peak] : null, total10: d.forecast?.payload?.country_total?.varado,
      analysis: d.forecast?.payload?.analysis,
    }
  }, [d, country])

  const waiting = missions.filter(m => m.status === 'proposed')
  const open = missions.filter(m => !['proposed', 'rejected', 'completed', 'closed', 'cancelled'].includes(m.status))
  const top = (zones ?? []).slice(0, 7), max = top[0]?.t || 1
  const go = ACT_ON[role]
  // Hubs have no recorded position, so they are counted per country and shown
  // at the country, not at an address.
  const hubs = Object.entries(orgs.filter(o => o.role === 'recovery_hub').reduce((a, o) => ({ ...a, [o.country_code]: (a[o.country_code] || 0) + 1 }), {}))
    .filter(([c]) => CENTRE[c])
  const mass = batches.reduce((a, b) => a + Number(b.wet_mass_t || 0), 0)
  const confirmed = batches.filter(b => b.measurement_conf === 'confirmed')
  const massConfirmed = confirmed.reduce((a, b) => a + Number(b.wet_mass_t || 0), 0)

  return (
    <section className="cc" data-tour="command">
      <div className="cc-kpis">
        <div className={'cc-kpi' + (k?.level ? ' tone-' + k.level.tone : '')}>
          <span className="cc-k">{country} waters · alert level</span>
          <span className="cc-v">{k?.level?.label ?? '—'}</span>
          <span className="cc-s">{k?.mine ? `${fmt(k.mine.t)} t afloat · ranked ${k.rank} of ${k.of}` : 'loading'}</span>
        </div>
        <div className="cc-kpi">
          <span className="cc-k">Greater Caribbean · afloat</span>
          <span className="cc-v">{k?.last ? fmt(k.last.t) : '—'} <small>t</small></span>
          <span className="cc-s">{k?.change == null ? '' : `${k.change >= 0 ? '▲' : '▼'} ${Math.abs(k.change).toFixed(1)}% on the day before · `}{k?.asOf ?? ''}</span>
        </div>
        <div className="cc-kpi tone-amber">
          <span className="cc-k">Heaviest arrival expected</span>
          <span className="cc-v">{k?.peakDay ? k.peakDay.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—'}</span>
          <span className="cc-s">{k?.total10 != null ? `${fmt(k.total10)} t over 10 days · indicative` : 'no forecast'}</span>
        </div>
        <div className="cc-kpi">
          <span className="cc-k">Missions</span>
          <span className="cc-v">{open.length} <small>active</small></span>
          <span className="cc-s">{waiting.length} awaiting a decision</span>
        </div>
      </div>

      <div className="cc-main">
        <div className="cc-map">
          <div className="cc-maphead">
            <div>
              <div className="cc-title">Sargassum across the Caribbean</div>
              <div className="cc-sub">Satellite · {LEVELS_OF.find(l => l[0] === nivel)[1].toLowerCase()} · {label(nivel, fecha)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className={'cc-tog' + (show.beaches ? ' on' : '')} onClick={() => setShow(v => ({ ...v, beaches: !v.beaches }))} aria-pressed={show.beaches}><i />Beaches</button>
              <button className={'cc-tog hub' + (show.hubs ? ' on' : '')} onClick={() => setShow(v => ({ ...v, hubs: !v.hubs }))} aria-pressed={show.hubs}><i />Hubs</button>
              <div className="seg">{LEVELS_OF.map(([v, n]) =>
                <button key={v} className={nivel === v ? 'on' : ''} onClick={() => setNivel(v)}>{n}</button>)}</div>
            </div>
          </div>
          <div className="cc-frame">
            {fecha ? <img key={nivel} src={mapUrl(nivel, fecha)} alt={`Satellite map of floating sargassum across the Greater Caribbean, ${label(nivel, fecha)}`} />
                   : <div className="cc-wait">Loading the satellite map…</div>}
            {show.beaches && beaches.map(b => <span key={b.id} className="cc-pin" style={place(b.lat, b.lng)} title={b.name + ' · monitored beach'} />)}
            {show.hubs && hubs.map(([c, n]) => <span key={c} className="cc-pin hub" style={place(CENTRE[c][0] - 0.9, CENTRE[c][1])}
              title={`${n} recovery hub${n > 1 ? 's' : ''} in ${COUNTRY[c] || c} · shown at the country, not at an address`}>{n}</span>)}
            <div className="cc-legend">
              <span><i className="cc-pin" />Monitored beach</span>
              <span><i className="cc-pin hub" />Recovery hubs, per country</span>
            </div>
          </div>
          <div className="cc-ctl">
            <button className="cc-play" onClick={play} disabled={!per} aria-label={playing ? 'Stop' : 'Play'}>{playing ? '■' : '▶'}</button>
            <button className="cc-step" disabled={!per || idx <= 0} onClick={() => { setPlaying(false); setIdx(i => i - 1) }} aria-label="Earlier">‹</button>
            <input type="range" min="0" max={per ? per.dates.length - 1 : 0} value={idx ?? 0} disabled={!per}
                   onChange={e => { setPlaying(false); setIdx(Number(e.target.value)) }} aria-label="Date" />
            <button className="cc-step" disabled={!per || idx >= per.dates.length - 1} onClick={() => { setPlaying(false); setIdx(i => i + 1) }} aria-label="Later">›</button>
            <span className="cc-date">{label(nivel, fecha)}</span>
          </div>
          <div className="cc-src">Sargassum afloat offshore, not landed. Map and figures: SATsum / SIMAR, CONABIO, CC BY 4.0, from MODIS at 1 km.
            Image cropped by CIIN; place names are in Spanish. Issued once a day.</div>
        </div>

        <aside className="cc-rail">
          <div className="cc-railhead">Decisions &amp; alerts</div>

          {waiting.length > 0 && <div className="cc-alert tone-amber">
            <b>{waiting.length} mission{waiting.length > 1 ? 's' : ''} awaiting a decision</b>
            {waiting.slice(0, 3).map(m => <span key={m.id}>{m.title}{m.tonnes ? ` · ${fmt(m.tonnes)} t` : ''}</span>)}
            {go && <button className="btn sm" onClick={() => onNavigate(go)}>Review</button>}
          </div>}

          {k?.level && <div className={'cc-alert tone-' + k.level.tone}>
            <b>{country} waters: {k.level.label}</b>
            <span>Today's density against {country}'s own record, 2010–2025.</span>
          </div>}

          {k?.peakDay && <div className="cc-alert">
            <b>Drift forecast · {k.analysis}</b>
            <span>Heaviest arrival on {country}'s coast around {k.peakDay.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}
              {k.peakT != null ? `, about ${fmt(k.peakT)} t that day` : ''}. Timing is the reliable part; tonnage is indicative.</span>
          </div>}

          <div className="cc-alert">
            <b>By country waters · {label(nivel, fecha)}</b>
            {top.length ? top.map(z => (
              <div key={z.zone} className="cc-zone">
                <span style={z.zone === country ? { color: 'var(--teal)', fontWeight: 700 } : undefined}>{z.zone}</span>
                <div className="bar" style={{ marginTop: 0 }}><i style={{ width: (z.t / max) * 100 + '%', background: z.zone === country ? 'var(--teal)' : '#6EA8D6' }} /></div>
                <span className="cc-num">{fmt(z.t)} t</span>
              </div>
            )) : <span>{playing ? 'Figures load when the map stops.' : per ? 'No country figures for this period.' : 'Loading…'}</span>}
          </div>
        </aside>
      </div>

      {admin && <>
        <div className="cc-panel">
          <div className="cc-railhead">Response pipeline</div>
          <div className="cc-pipe">
            {STAGES.map(([key, name, what]) => {
              const n = missions.filter(m => m.status === key).length
              return <div key={key} className={'cc-stage' + (n ? ' on' : '')}>
                <span className="cc-dot">{n}</span><b>{name}</b><span>{what}</span></div>
            })}
          </div>
        </div>
        <div className="cc-two">
          <div className="cc-panel">
            <div className="cc-railhead">Mission queue</div>
            {missions.filter(m => !['completed', 'rejected'].includes(m.status)).length === 0
              ? <span className="muted" style={{ fontSize: 12.5 }}>No open missions.</span>
              : <table className="cc-table"><thead><tr><th>Site</th><th>Expected</th><th>Tonnes</th><th>Status</th></tr></thead><tbody>
                  {missions.filter(m => !['completed', 'rejected'].includes(m.status)).slice(0, 8).map(m => <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>{m.eta_at ? new Date(m.eta_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}</td>
                    <td>{m.tonnes != null ? fmt(m.tonnes) : '—'}</td>
                    <td><span className={'pill ' + (TONE[m.status] || 'grey')}>{m.status.replace(/_/g, ' ')}</span></td></tr>)}
                </tbody></table>}
          </div>
          <div className="cc-panel">
            <div className="cc-railhead">Sargassum to value</div>
            <div className="cc-kpis" style={{ marginBottom: 0 }}>
              <div className="cc-kpi tone-green"><span className="cc-k">Recovered</span>
                <span className="cc-v">{fmt(mass)} <small>t</small></span><span className="cc-s">{batches.length} batches on record</span></div>
              <div className="cc-kpi"><span className="cc-k">Lab confirmed</span>
                <span className="cc-v">{fmt(massConfirmed)} <small>t</small></span>
                <span className="cc-s">{mass ? Math.round((massConfirmed / mass) * 100) : 0}% of recovered · {confirmed.length} batches</span></div>
            </div>
            <div className="cc-src">Wet mass as recorded on each batch by the hub that handled it. Matching to buyers is not yet recorded, so it is not shown.</div>
          </div>
        </div>
      </>}
    </section>
  )
}
