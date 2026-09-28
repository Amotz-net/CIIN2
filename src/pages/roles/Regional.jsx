import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { LEVELS } from '../../lib/alert'

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

function SeriesChart({ rows }) {
  const W = 760, H = 170, P = { l: 44, r: 8, t: 8, b: 20 }
  if (!rows?.length) return null
  const top = Math.max(...rows.map(r => r.t)) * 1.05
  const x = i => P.l + (i / (rows.length - 1)) * (W - P.l - P.r), y = v => P.t + (1 - v / top) * (H - P.t - P.b)
  const line = k => rows.map((r, i) => `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(' ')
  const months = rows.map((r, i) => [r.d, i]).filter(([d]) => d.slice(8) === '01')
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420, display: 'block' }} role="img"
           aria-label="Daily wet sargassum biomass in the Greater Caribbean this year">
        {[0, 0.5, 1].map(f => <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={y(top * f)} y2={y(top * f)} stroke="#3C454E" strokeWidth=".6" />
          <text x={P.l - 5} y={y(top * f) + 3} textAnchor="end" fontSize="9" fill="#9AA6A3">{(top * f / 1e6).toFixed(1)}M</text></g>)}
        <polyline points={line('t1d')} fill="none" stroke="#9AA6A3" strokeWidth=".8" opacity=".6" />
        <polyline points={line('t')} fill="none" stroke="#57C4AE" strokeWidth="1.6" strokeLinejoin="round" />
        {months.map(([d, i]) => <text key={d} x={x(i)} y={H - 5} fontSize="9" fill="#9AA6A3" textAnchor="middle">
          {new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</text>)}
      </svg>
    </div>
  )
}

export function Regional({ profile }) {
  const country = { JM: 'Jamaica', PR: 'Puerto Rico', BB: 'Barbados', DO: 'Dominican Republic' }[profile?.organizations?.country_code] || 'Jamaica'
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    supabase.functions.invoke('regional?country=' + encodeURIComponent(country), { body: {} })
      .then(({ data, error }) => { if (alive) setD(error ? { ok: false, reason: error.message } : data) })
    return () => { alive = false }
  }, [country])

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
        <SeriesChart rows={gc} />
        <div className="muted" style={{ fontSize: 11 }}>Green: multi-day composite. Grey: each day alone, which dips when cloud hides the sea.</div>
        <Src>Wet sargassum biomass from MODIS at 1 km, {d.series?.as_of}. The {country} level compares today's density with
          the 75th, 90th, 95th and 99th percentiles of SATsum's monthly record for {country}, 2010–2025; a daily figure against
          a monthly scale is approximate. Source: SATsum / SIMAR, CONABIO, CC BY 4.0.</Src>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>By country waters <span className="pill grey" style={{ fontSize: 10 }}>{d.eez?.as_of}</span></h2>
        {zones.slice(0, 12).map((z, i) => (
          <div key={z.zone} style={{ display: 'grid', gridTemplateColumns: '24px minmax(110px,190px) 1fr 110px', gap: 10, alignItems: 'center', padding: '5px 0' }}>
            <span className="muted" style={{ fontSize: 11 }}>{i + 1}</span>
            <span style={{ fontSize: 13, fontWeight: z.zone === country ? 800 : 400, color: z.zone === country ? 'var(--teal)' : undefined }}>{z.zone}</span>
            <div className="bar" style={{ marginTop: 0 }}><i style={{ width: (z.t / maxZone) * 100 + '%', background: z.zone === country ? 'var(--teal)' : '#6EA8D6' }} /></div>
            <span style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(z.t)} t</span>
          </div>
        ))}
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
