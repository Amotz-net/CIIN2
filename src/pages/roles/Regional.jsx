import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { LEVELS } from '../../lib/alert'
import { SeriesChart } from '../../components/SeriesChart'

// Regional picture — the Caribbean-wide view, from SATsum (CONABIO, Mexico).
// CIIN does not produce these figures. Every panel names its source and date,
// and the forecast carries SATsum's own statement of what it can and cannot do.

const fmt = (n) => Math.round(Number(n || 0)).toLocaleString()
const day = (iso, add = 0) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + add)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const Src = ({ children }) => <div className="muted" style={{ fontSize: 10.5, marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>{children}</div>
const Big = ({ v, unit, label, tone }) => (
  <div>
    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: tone ? `var(--${tone})` : undefined }}>
      {v}{unit && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> {unit}</span>}</div>
    <div className="muted" style={{ fontSize: 11.5 }}>{label}</div>
  </div>
)

const REGIONS = [
  ['greater_caribbean', 'Greater Caribbean'], ['caribbean_sea', 'Caribbean Sea'],
  ['gulf_of_mexico', 'Gulf of Mexico'], ['mexican_caribbean', 'Mexican Caribbean'],
]
const RANGES = [['30', '30 days'], ['90', '90 days'], ['all', 'This year']]
const HOUR = 60 * 60 * 1000

export function Regional({ profile }) {
  const country = { JM: 'Jamaica', PR: 'Puerto Rico', BB: 'Barbados', DO: 'Dominican Republic' }[profile?.organizations?.country_code] || 'Jamaica'
  const [d, setD] = useState(null)
  const [region, setRegion] = useState('greater_caribbean')
  const [range, setRange] = useState('90')
  const [zone, setZone] = useState(country)
  const [hist, setHist] = useState(null)       // { zones, remaining } — daily history per country
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  // SATsum publishes once a day; asking hourly picks the new day up soon after
  // it appears. A failed refresh keeps what is already on screen.
  useEffect(() => {
    let alive = true
    setBusy(true)
    supabase.functions.invoke('regional?country=' + encodeURIComponent(country), { body: {} })
      .then(({ data, error }) => {
        if (!alive) return
        setBusy(false)
        if (error || !data?.ok) setD(prev => prev?.ok ? prev : (error ? { ok: false, reason: error.message } : data))
        else setD(data)
      })
    return () => { alive = false }
  }, [country, tick])
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), HOUR); return () => clearInterval(id) }, [])

  // Per-country history is filled in 30 days per call; keep asking until complete.
  useEffect(() => {
    let alive = true
    const pull = async (left = 4) => {
      const { data } = await supabase.functions.invoke('regional?action=history&days=60', { body: {} })
      if (!alive || !data?.ok) return
      setHist(data)
      if (data.remaining > 0 && left > 0) pull(left - 1)
    }
    pull()
    return () => { alive = false }
  }, [tick])

  if (!d) return <div className="card"><span className="muted">Loading the regional picture…</span></div>
  if (!d.ok) return <div className="card"><div className="empty"><span className="muted">Regional data unavailable ({d.reason}).</span></div></div>

  const gc = d.series?.payload?.greater_caribbean ?? [], cs = d.series?.payload?.caribbean_sea ?? []
  const last = gc[gc.length - 1], prev = gc[gc.length - 2], csLast = cs[cs.length - 1]
  const zones = [...(d.eez?.payload ?? [])].sort((a, b) => b.t - a.t)
  const mine = zones.find(z => z.zone === country), rank = zones.findIndex(z => z.zone === country) + 1
  const th = d.thresholds, density = mine && th ? mine.t / th.area_km2 : null
  const lvl = density == null ? null : LEVELS[th.umbrales.filter(u => density >= u).length]
  const f = d.forecast?.payload, daily = f?.country_daily_stranding ?? []
  const peak = daily.length ? daily.indexOf(Math.max(...daily)) : -1
  const maxZone = zones[0]?.t || 1, maxDaily = Math.max(...daily, 1)
  const change = last && prev ? ((last.t - prev.t) / prev.t) * 100 : null
  const stale = (d.stale ?? []).length > 0
  const all = d.series?.payload?.[region] ?? []
  const shownRows = range === 'all' ? all : all.slice(-Number(range))
  const regionName = REGIONS.find(r => r[0] === region)[1]
  const zoneRows = hist?.zones?.[zone] ?? []
  const zth = d.thresholds_all?.[zone]
  const zoneBands = zth?.umbrales && zth?.area_km2 ? zth.umbrales.map(u => u * zth.area_km2) : null

  return (
    <div className="dash-grid">
      {stale && <div className="card" style={{ gridColumn: '1 / -1', borderColor: 'var(--amber)' }}>
        <span className="pill amber">stored copy</span>{' '}
        <span style={{ fontSize: 12.5 }}>SATsum could not be reached for {d.stale.map(s => s.kind).join(', ')}. Showing the last copy CIIN stored; dates are on each panel.</span>
      </div>}

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Caribbean today <span className="pill" style={{ fontSize: 10 }}>satellite</span></h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
          <Big v={fmt(last?.t)} unit="t" label={`Greater Caribbean · ${change == null ? '' : (change >= 0 ? '+' : '') + change.toFixed(1) + '% on the day before'}`} />
          <Big v={fmt(csLast?.t)} unit="t" label="Caribbean Sea" />
          <Big v={fmt(mine?.t)} unit="t" label={`${country} waters · ranked ${rank} of ${zones.length}`} />
          <Big v={lvl ? lvl.label : '—'} tone={lvl?.tone} label={density == null ? 'no scale' : `${density.toFixed(3)} t/km² across ${country}'s zone`} />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Satellite figures are issued once a day. CIIN checks for a new issue every hour
          {d.fetched_at && <> · last checked {new Date(d.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>}{' '}
          <button className="btn ghost sm" style={{ padding: '3px 9px', fontSize: 11 }} disabled={busy} onClick={() => setTick(t => t + 1)}>
            {busy ? 'Checking…' : 'Check now'}</button>
        </div>
        <Src>Wet sargassum biomass from MODIS at 1 km, {d.series?.as_of}. The {country} level compares today's density with
          the 75th, 90th, 95th and 99th percentiles of SATsum's monthly record for {country}, 2010–2025; a daily figure against
          a monthly scale is approximate. Source: SATsum / SIMAR, CONABIO, CC BY 4.0.</Src>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>{regionName}: daily biomass <span className="pill grey" style={{ fontSize: 10 }}>{d.series?.as_of}</span></h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="seg">{REGIONS.map(([k, n]) => <button key={k} className={region === k ? 'on' : ''} onClick={() => setRegion(k)}>{n}</button>)}</div>
          <div className="seg">{RANGES.map(([k, n]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{n}</button>)}</div>
        </div>
        <SeriesChart rows={shownRows} second="t1d" label={regionName} />
        <div className="muted" style={{ fontSize: 11 }}>Green: multi-day composite. Grey: each day alone, which dips when cloud hides the sea.
          Statistics describe the period shown.</div>
        <Src>Wet sargassum biomass from MODIS at 1 km. Source: SATsum / SIMAR, CONABIO, CC BY 4.0.</Src>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>By country waters <span className="pill grey" style={{ fontSize: 10 }}>{d.eez?.as_of}</span></h2>
        {zones.slice(0, 12).map((z, i) => (
          <button key={z.zone} className={'zonerow' + (z.zone === zone ? ' on' : '')} onClick={() => setZone(z.zone)} aria-pressed={z.zone === zone}>
            <span className="muted" style={{ fontSize: 11 }}>{i + 1}</span>
            <span style={{ fontSize: 13, fontWeight: z.zone === country ? 800 : 400, color: z.zone === country ? 'var(--teal)' : undefined }}>{z.zone}</span>
            <div className="bar" style={{ marginTop: 0 }}><i style={{ width: (z.t / maxZone) * 100 + '%', background: z.zone === country ? 'var(--teal)' : '#6EA8D6' }} /></div>
            <span style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(z.t)} t</span>
          </button>
        ))}
        <div className="muted" style={{ fontSize: 11, margin: '6px 0 14px' }}>Click a country to see its last 60 days.</div>

        <h2 style={{ marginTop: 0 }}>{zone}: last 60 days</h2>
        {!hist ? <span className="muted" style={{ fontSize: 12.5 }}>Loading daily history…</span>
          : zoneRows.length ? <>
              <SeriesChart rows={zoneRows} color="#6EA8D6" bands={zoneBands} label={zone + ' waters'} />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {zoneBands ? `Shaded bands are ${zone}'s alert levels: the 75th, 90th, 95th and 99th percentiles of its monthly record, 2010–2025, scaled to its zone area.`
                           : `SATsum publishes no alert scale for ${zone}.`}
                {hist.remaining > 0 && ` Still collecting ${hist.remaining} earlier days.`}</div>
            </>
          : <span className="muted" style={{ fontSize: 12.5 }}>No daily history stored for {zone} yet.</span>}
        <Src>Tonnes of wet sargassum afloat inside each exclusive economic zone on {d.eez?.as_of}. Floating offshore, not landed.
          Source: SATsum / SIMAR, CONABIO, CC BY 4.0.</Src>
      </div>

      {f && <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>{country}: 10-day drift forecast <span className="pill amber" style={{ fontSize: 10 }}>probabilistic</span></h2>
        <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginBottom: 12 }}>
          <Big v={fmt(f.country_total?.a_flote)} unit="t" label={`still afloat in ${country} waters at day 10`} />
          <Big v={fmt(f.country_total?.varado)} unit="t" label="expected to strand over 10 days (indicative)" tone="amber" />
          <Big v={peak >= 0 ? day(f.analysis, peak + 1) : '—'} label={peak >= 0 ? `heaviest expected arrival (day ${peak + 1})` : 'no arrival forecast'} />
          <Big v={f.scenarios} label={`scenarios · analysis of ${f.analysis}`} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 110 }}>
          {daily.map((v, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div className="muted" style={{ fontSize: 9.5 }}>{Math.round(v)}</div>
              <div style={{ height: Math.max(3, (v / maxDaily) * 74), background: i === peak ? 'var(--amber)' : '#6EA8D6', borderRadius: 3, opacity: i >= 7 ? .45 : 1 }} />
              <div className="muted" style={{ fontSize: 9.5, marginTop: 3 }}>{day(f.analysis, i + 1)}</div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Tonnes expected to strand on {country}'s coast each day. Days 8 to 10 are faded: SATsum has never verified them.</div>
        <Src>
          <b>How far to trust it, in SATsum's own words:</b> checked against what the satellite later saw at 1, 2, 3, 5 and 7 days,
          the model beat "assume nothing moves" at four of the five, and lost at day 7. It finds about 8 in 10 patches but flags
          more area than fills up, so read it as where to look. Stranded tonnages are indicative until calibrated against beach
          collection records; the timing and the distribution along the coast are the reliable part. {Math.round((f.unobserved_fraction || 0) * 100)}% of
          the starting scene was cloud or land. Currents: CMEMS GLO12. Waves: MFWAM. Wind: ECMWF IFS. Source: SATsum-Drift / SIMAR, CONABIO, CC BY 4.0.
        </Src>
      </div>}

      {f && <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Flow through the passages <span className="pill grey" style={{ fontSize: 10 }}>10 days</span></h2>
        {[...f.passages].sort((a, b) => Math.abs(b.net_t) - Math.abs(a.net_t)).map(p => {
          const m = Math.max(...f.passages.map(q => Math.abs(q.net_t)), 1), jm = p.name.includes('Jamaica')
          return (
            <div key={p.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,200px) 1fr 150px', gap: 10, alignItems: 'center', padding: '5px 0' }}>
              <span style={{ fontSize: 13, fontWeight: jm ? 800 : 400, color: jm ? 'var(--teal)' : undefined }}>{p.name}</span>
              <div className="bar" style={{ marginTop: 0 }}><i style={{ width: (Math.abs(p.net_t) / m) * 100 + '%', background: p.net_t < 0 ? 'var(--mute)' : 'var(--amber)' }} /></div>
              <span style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.net_t)} t · {Number(p.speed_ms).toFixed(2)} m/s</span>
            </div>
          )
        })}
        <Src>Net tonnes of sargassum crossing each passage over the 10-day forecast, and the mean speed at which it crosses.
          A negative figure means it crossed against the usual direction. Source: SATsum-Drift / SIMAR, CONABIO, CC BY 4.0.</Src>
      </div>}

      {f?.animation_url && <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Forecast animation <span className="pill grey" style={{ fontSize: 10 }}>{f.analysis}</span></h2>
        <img src={f.animation_url} alt={`Animated 10-day sargassum drift forecast around ${country}`} loading="lazy"
             style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
        <Src>Image produced and hosted by SATsum-Drift / SIMAR, CONABIO, CC BY 4.0. Labels are in Spanish.</Src>
      </div>}
    </div>
  )
}
