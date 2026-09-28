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

const fmt = n => Math.round(Number(n || 0)).toLocaleString()
const utc = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })
function label(nivel, f) {
  if (!f) return '—'
  if (nivel === 'anual') return f
  if (nivel === 'mensual') return utc(`${f.slice(0, 4)}-${f.slice(4, 6)}-01`, { month: 'long', year: 'numeric' })
  return utc(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`, { day: 'numeric', month: 'short', year: 'numeric' })
}
const mapUrl = (nivel, f) => `${SITE}/mapa?zona=gran_caribe&nivel=${nivel}&fecha=${f}&var=biomasa&w=1400&fmt=webp`

export function CommandCentre({ profile, role, onNavigate }) {
  const country = COUNTRY[profile?.organizations?.country_code] || 'Jamaica'
  const [d, setD] = useState(null)
  const [nivel, setNivel] = useState('1d')
  const [per, setPer] = useState(null)         // { dates, fecha, zones }
  const [idx, setIdx] = useState(null)         // position in per.dates
  const [zones, setZones] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [missions, setMissions] = useState([])
  const [tick, setTick] = useState(0)
  const asked = useRef(0)

  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), HOUR); return () => clearInterval(id) }, [])

  useEffect(() => {
    let alive = true
    supabase.functions.invoke('regional?country=' + encodeURIComponent(country), { body: {} })
      .then(({ data }) => { if (alive && data?.ok) setD(data) })
    // Row-level security decides which missions this organisation can see.
    supabase.from('missions').select('id, title, status, tonnes, eta_at').order('eta_at', { ascending: true }).limit(50)
      .then(({ data }) => { if (alive) setMissions(data ?? []) })
    return () => { alive = false }
  }, [country, tick, profile?.org_id])

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
            <div className="seg">{LEVELS_OF.map(([v, n]) =>
              <button key={v} className={nivel === v ? 'on' : ''} onClick={() => setNivel(v)}>{n}</button>)}</div>
          </div>
          <div className="cc-frame">
            {fecha ? <img key={nivel} src={mapUrl(nivel, fecha)} alt={`Satellite map of floating sargassum across the Greater Caribbean, ${label(nivel, fecha)}`} />
                   : <div className="cc-wait">Loading the satellite map…</div>}
            <div className="cc-scale" aria-hidden="true"><span>less</span><i /><span>more</span></div>
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
    </section>
  )
}
