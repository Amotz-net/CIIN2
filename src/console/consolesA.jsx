import { useMemo } from 'react'
import { Console, Kpi, Panel, Chip, Empty, Source, Facts, Notice, Steps, Spark, LegendLine, Icon, fmt, nice, eta, ago, shortDate } from './kit.jsx'
import { SargassumMap } from './SargassumMap.jsx'
import { useConsole, arrivalText, REGION_BOX, CENTRE, COUNTRY, segPoints, boxAround } from './useConsole.js'
import { stage, chain, byChannel, CHANNEL_ICON } from './mission.js'
import { PROGRAMME, GATES } from './program.js'

const REGION_VIEW = [{ key: 'region', bounds: [[10, -90], [27, -59]] }]
const ROLE_KIND = { hotel: 'hotel', recovery_hub: 'hub', processor: 'processor', university_lab: 'lab', government: 'agency', buyer: 'buyer', finance: 'agency' }
const ROLE_NAME = { hotel: 'Hotel', recovery_hub: 'Hub', processor: 'Processor', university_lab: 'Laboratory', government: 'Agency', buyer: 'Buyer', finance: 'Finance' }

// Organisations have no recorded address. Hotels are placed at their beaches;
// everyone else is placed beside their country and the popup says so.
function networkMarkers(d, kinds = null) {
  const out = []
  for (const b of d.beaches) out.push({ lat: b.lat, lng: b.lng, kind: 'hotel', label: b.name, note: d.orgName(b.org_id) + ' · monitored beach' })
  const groups = {}
  for (const o of d.orgs) {
    if (o.role === 'hotel' || !CENTRE[o.country_code]) continue
    const k = ROLE_KIND[o.role]; if (kinds && !kinds.includes(k)) continue
    ;(groups[o.country_code + k] ||= { code: o.country_code, kind: k, list: [] }).list.push(o)
  }
  const ring = ['hub', 'processor', 'lab', 'agency', 'buyer']
  for (const g of Object.values(groups)) {
    const [la, lo] = CENTRE[g.code], a = (ring.indexOf(g.kind) / ring.length) * 2 * Math.PI
    out.push({ lat: la - 1.7 * Math.cos(a) - 0.4, lng: lo + 2.3 * Math.sin(a), kind: g.kind, count: g.list.length,
      label: g.list.map(o => o.name).join(', '), note: `${COUNTRY[g.code] || g.code} · placed beside the country, not at an address` })
  }
  return out
}

function committed(d, hubId) {
  return Object.values(d.pools).flat().filter(p => p.org_id === hubId)
    .filter(p => { const m = d.missions.find(x => x.id === p.mission_id); return m && !['completed', 'rejected'].includes(m.status) })
    .reduce((s, p) => s + Number(p.share_tonnes || 0), 0)
}

function MissionQueue({ d, limit = 6 }) {
  if (!d.open.length) return <Empty>No open missions.</Empty>
  return (
    <table className="k-table"><thead><tr><th>Site</th><th>Expected</th><th>Tonnes</th><th>Status</th></tr></thead><tbody>
      {d.open.slice(0, limit).map(m => { const s = stage(m); return (
        <tr key={m.id}><td>{m.title}</td><td>{eta(m.eta_at)}</td><td>{m.tonnes != null ? fmt(m.tonnes) : '—'}</td>
          <td><span className={'k-dot tone-' + s.tone} />{s.label}</td></tr>) })}
    </tbody></table>
  )
}

/* ------------------------------------------------------------------ */
/* CIIN Command Centre — the platform administrator's overview         */
/* ------------------------------------------------------------------ */
export function CommandConsole({ profile, onNavigate }) {
  const d = useConsole(profile, { scope: 'all', history: true })
  const arr = arrivalText(d.landfall)
  const active = d.open.filter(m => m.status !== 'proposed')
  const authority = d.open.filter(m => stage(m).key === 'authority'), owner = d.open.filter(m => stage(m).key === 'owner')
  const recoverable = d.open.reduce((s, m) => s + Number(m.tonnes || 0), 0)
  const lead = d.open[0]
  const mass = d.batches.reduce((s, b) => s + Number(b.wet_mass_t || 0), 0)
  const checked = d.batches.filter(b => b.confirmed).reduce((s, b) => s + Number(b.wet_mass_t || 0), 0)
  const channels = byChannel(d.batches).slice(0, 3)
  const hubs = d.orgs.filter(o => o.role === 'recovery_hub')
  const series = (d.hist?.zones?.[d.country] ?? []).slice(-30).map(r => ({ v: r.t }))
  const day10 = d.forecast?.country_total?.a_flote
  const markers = useMemo(() => networkMarkers(d, ['hub']), [d.beaches, d.orgs])

  return (
    <Console
      kpis={<>
        <Kpi icon="waves" label="Landfall window" value={arr.value} sub={arr.sub} tone={arr.tone} />
        <Kpi icon="target" label="Missions active" value={String(active.length).padStart(2, '0')}
             meter={d.missions.length ? active.length / d.missions.length : 0} sub={`${active.length} of ${d.missions.length} on record`} />
        <Kpi icon="doc" label="Approvals pending" value={String(authority.length + owner.length).padStart(2, '0')} tone="amber"
             meter={d.open.length ? (authority.length + owner.length) / d.open.length : 0} sub={`${authority.length} authority · ${owner.length} owner`} />
        <Kpi icon="leaf" label="Recoverable biomass" value={fmt(recoverable)} unit="t" tone="green" bars={recoverable ? 4 : 0} sub="estimated, open missions" />
      </>}
      rail={<>
        <div className="k-rail-h">Decisions &amp; alerts</div>
        {owner.slice(0, 2).map(m => <Notice key={m.id} icon="alert" tone="amber" title="Owner approval required" when={ago(m.created_at)}
          lines={[m.title, d.orgName(m.org_id)]}>
          <button className="k-btn amber" onClick={() => onNavigate('admin')}>Review</button></Notice>)}
        {authority.slice(0, 2).map(m => <Notice key={m.id} icon="bank" tone="amber" title="Authority decision required" when={ago(m.created_at)}
          lines={[m.title, `${fmt(m.tonnes)} t · expected ${eta(m.eta_at)}`]}>
          <button className="k-btn amber" onClick={() => onNavigate('admin')}>Review</button></Notice>)}
        <Notice icon="alert" tone={d.waterLevel?.tone === 'green' ? 'green' : d.waterLevel?.tone || 'grey'}
          title={`${d.country} waters: ${d.waterLevel?.label ?? 'reading'}`} when={d.regional?.eez?.as_of}
          lines={[d.mine ? `${fmt(d.mine.t)} t afloat offshore` : 'Reading the regional figures', "Against the country's own record, 2010–2025."]}>
          <div style={{ width: '100%' }}>
            <div className="k-mini-h">Risk trend</div>
            <Spark rows={series} dashed={Number.isFinite(day10) && series.length ? [{ v: null }, { v: null }, { v: day10 }] : []} height={92} x0="30 days" xm="Now" x1="+10 d" />
            <LegendLine items={[['var(--amber)', 'Observed'], ['var(--teal)', 'Forecast, day 10', true]]} />
          </div>
        </Notice>
        {hubs.map(h => { const used = committed(d, h.id), cap = Number(h.capacity_t || 0); return (
          <Notice key={h.id} icon="db" tone="teal" title="Hub capacity" lines={[h.name, cap ? `${fmt(Math.max(0, cap - used))} t spare of ${fmt(cap)} t` : 'Capacity not recorded']}>
            <button className="k-btn ghost" onClick={() => onNavigate('admin')}>View hub</button></Notice>) })}
        <Source>Regional figures and forecast: SATsum / SIMAR, CONABIO, CC BY 4.0.</Source>
      </>}>
      <SargassumMap title="Sargassum offshore" note="observed, last 72 hours" raster={REGION_BOX} views={REGION_VIEW} markers={markers}
        layers={[{ key: 'sargassum', label: 'Sargassum', color: '#F08A3C' }, { key: 'hotel', label: 'Hotels', color: '#57C4AE' }, { key: 'hub', label: 'Hubs', color: '#E0A94F' }]}
        legend={[{ type: 'fill', color: '#F08A3C', label: 'Sargassum afloat (satellite)' }, { type: 'pin', kind: 'hotel', label: 'Hotel beach (monitored)' },
                 { type: 'pin', kind: 'hub', label: 'Recovery hubs, per country' }]} />
      <Panel title="Response pipeline" note={lead ? lead.title : null}>
        {lead ? <Steps steps={chain(lead, d.pools[lead.id], d.batches)} /> : <Empty>No open mission to follow.</Empty>}
      </Panel>
      <div className="k-two">
        <Panel title="Mission queue" action={<a className="k-link" onClick={() => onNavigate('admin')}>View all</a>}><MissionQueue d={d} limit={4} /></Panel>
        <Panel title="Sargassum to value">
          <div className="k-tiles3">
            <div className="k-tile"><Icon name="leaf" size={26} /><div><span>Recovered</span><b>{fmt(mass)} t</b><small>{d.batches.length} batches</small></div></div>
            <div className="k-tile"><Icon name="flask" size={26} /><div><span>Quality checked</span><b>{fmt(checked)} t</b><small>{mass ? Math.round((checked / mass) * 100) : 0}% of recovered</small></div></div>
            <div className="k-tile off"><Icon name="link" size={26} /><div><span>Matched</span><b>—</b><small>not yet recorded</small></div></div>
          </div>
          <div className="k-flow">Quality passport → Processor → Permitted use<i /></div>
          <div className="k-tiles3">{channels.length ? channels.map(c => (
            <div key={c.channel} className="k-tile plain"><Icon name={CHANNEL_ICON[c.channel] || 'leaf'} size={24} /><div><b style={{ fontSize: 13, textTransform: 'capitalize' }}>{nice(c.channel)}</b>
              <small>{fmt(c.t)} t eligible · {c.n} batches</small></div></div>)) : <Empty>No graded batches yet.</Empty>}</div>
        </Panel>
      </div>
    </Console>
  )
}

/* ------------------------------------------------------------------ */
/* Regional Administration                                             */
/* ------------------------------------------------------------------ */
export function AdminConsole({ profile, onOpen }) {
  const d = useConsole(profile, { scope: 'all', admin: true })
  const active = d.open.filter(m => m.status !== 'proposed')
  const waiting = d.open.filter(m => ['authority', 'owner'].includes(stage(m).key))
  const late = waiting.filter(m => Date.now() - new Date(m.created_at) > 24 * 3.6e6)
  const unapproved = d.orgs.filter(o => !o.approved)
  const invites = d.invitations.filter(i => i.status === 'pending')
  const feeds = useMemo(() => {
    const reads = d.beaches.map(b => b.read).filter(Boolean), drifts = d.beaches.map(b => b.drift).filter(Boolean)
    const asOf = list => list.map(x => x.asOf).filter(Boolean).sort().pop()
    const st = (ok, stale) => (ok ? (stale ? ['Delayed', 'amber'] : ['Healthy', 'green']) : ['No reading', 'red'])
    const isStale = kind => d.stale.some(s => s.kind === kind)
    const old = iso => iso && Date.now() - new Date(iso) > 3 * 86400000
    return [
      { icon: 'satellite', name: 'Satellite intake', src: 'NOAA AFAI', st: !d.feedsDone && !reads.length ? ['Reading', 'grey'] : st(reads.some(r => r.ok), old(asOf(reads))), at: asOf(reads) },
      { icon: 'waves', name: 'Ocean currents', src: 'NOAA', st: !d.feedsDone && !drifts.length ? ['Reading', 'grey'] : st(drifts.some(r => r.ok), old(asOf(drifts))), at: asOf(drifts) },
      { icon: 'db', name: 'Regional figures', src: 'SATsum', st: !d.regional ? ['Reading', 'grey'] : st(!!d.regional.series, isStale('series') || isStale('eez')), at: d.regional?.series?.as_of },
      { icon: 'trend', name: 'Drift forecast', src: 'SATsum', st: !d.regional ? ['Reading', 'grey'] : st(!!d.forecast, isStale('forecast')), at: d.forecast?.analysis },
    ]
  }, [d.beaches, d.regional, d.stale, d.feedsDone])
  const sick = feeds.filter(f => ['Delayed', 'No reading'].includes(f.st[0]))

  const exceptions = []
  late.forEach(m => exceptions.push({ tone: 'red', icon: 'alert', pr: 'High priority', title: stage(m).key === 'owner' ? 'Owner approval overdue' : 'Authority decision overdue',
    lines: [`Waiting ${ago(m.created_at).replace(' ago', '')}`, `${m.title} · ${d.orgName(m.org_id)}`], act: 'Open', org: m.org_id }))
  d.open.forEach(m => { const share = (d.pools[m.id] || []).reduce((s, p) => s + Number(p.share_tonnes || 0), 0)
    const own = d.orgs.find(o => o.id === m.org_id)?.role === 'recovery_hub'   // a hub's own mission is covered by that hub
    if (!own && m.tonnes && share < Number(m.tonnes)) exceptions.push({ tone: 'amber', icon: 'users', pr: 'Medium', title: 'Mission not fully covered',
      lines: [`${fmt(share)} t allocated of ${fmt(m.tonnes)} t`, m.title], act: 'Open', org: m.org_id }) })
  sick.forEach(f => exceptions.push({ tone: 'blue', icon: 'db', pr: 'Medium', title: 'Data feed ' + f.st[0].toLowerCase(),
    lines: [f.at ? `Last reading ${shortDate(f.at)}` : 'No reading received', `${f.name} · ${f.src}`] }))
  unapproved.forEach(o => exceptions.push({ tone: 'amber', icon: 'shield', pr: 'Medium', title: 'Organisation awaiting approval',
    lines: [o.name, ROLE_NAME[o.role] || o.role], act: 'Approve', orgs: true }))

  const onboarding = [
    ...unapproved.map(o => ({ key: o.id, name: o.name, type: ROLE_NAME[o.role], status: ['Access review', 'amber'], next: 'Approve organisation' })),
    ...invites.map(i => ({ key: i.id, name: i.email, type: ROLE_NAME[d.orgs.find(o => o.id === i.org_id)?.role] || 'Member',
      status: new Date(i.expires_at) < new Date() ? ['Invitation expired', 'red'] : ['Invitation sent', 'blue'], next: 'Awaiting acceptance' })),
  ]

  return (
    <Console railWidth={470}
      kpis={<>
        <Kpi icon="target" label="Active missions" value={String(active.length).padStart(2, '0')} bars={Math.min(5, active.length + 1)} sub={`${d.open.length} open in total`} />
        <Kpi icon="alert" label="Approval bottlenecks" value={String(late.length).padStart(2, '0')} tone={late.length ? 'amber' : 'green'} sub={`${waiting.length} awaiting a decision`} />
        <Kpi icon="users" label="Partners onboarding" value={String(onboarding.length).padStart(2, '0')} sub={`${d.orgs.filter(o => o.approved).length} organisations approved`} />
        <Kpi icon="db" label="Feeds needing attention" value={String(sick.length).padStart(2, '0')} tone={sick.length ? 'amber' : 'green'} sub={`${feeds.length} feeds watched`} />
      </>}
      rail={<Panel title="Exceptions requiring action" className="fill">
        {exceptions.length ? exceptions.slice(0, 5).map((x, i) => (
          <div key={i} className={'k-exc tone-' + x.tone}>
            <span className="k-exc-ic"><Icon name={x.icon} size={26} /></span>
            <div className="k-exc-b"><b>{x.title}</b>{x.lines.map((l, j) => <span key={j}>{l}</span>)}</div>
            <div className="k-exc-r"><Chip tone={x.tone} solid>{x.pr}</Chip>
              {x.act && <button className="k-btn ghost" onClick={() => onOpen(x.orgs ? { orgs: true } : { org: x.org })}>{x.act}</button>}</div>
          </div>)) : <Empty>Nothing needs action. Every mission is moving, every feed is reporting and every organisation is approved.</Empty>}
      </Panel>}
      below={<div className="k-three">
        <Panel title="Partner onboarding" action={<a className="k-link" onClick={() => onOpen({ orgs: true })}>Organisations ›</a>}>
          {onboarding.length ? <table className="k-table"><thead><tr><th>Partner</th><th>Type</th><th>Status</th><th>Next step</th></tr></thead><tbody>
            {onboarding.map(o => <tr key={o.key}><td>{o.name}</td><td>{o.type}</td><td><Chip tone={o.status[1]}>{o.status[0]}</Chip></td><td>{o.next}</td></tr>)}
          </tbody></table> : <Empty>No organisation is waiting for approval and no invitation is outstanding.</Empty>}
        </Panel>
        <Panel title="System oversight">
          <table className="k-table"><thead><tr><th>Data source</th><th>Status</th><th>Last reading</th></tr></thead><tbody>
            {feeds.map(f => <tr key={f.name}><td><span className="k-cellic"><Icon name={f.icon} size={17} />{f.name}<small>{f.src}</small></span></td>
              <td><Chip tone={f.st[1]}>{f.st[0]}</Chip></td><td>{f.at ? shortDate(f.at) : '—'}</td></tr>)}
          </tbody></table>
        </Panel>
        <div className="k-stack">
          <Panel title="Human approval gates">
            {GATES.map(g => <div key={g.name} className="k-gate"><Icon name={g.icon} size={19} /><span>{g.name}</span><Chip tone={g.tone} solid>{g.rule}</Chip><small>{g.covers}</small></div>)}
          </Panel>
          <Panel title="Programme milestones"><Steps steps={PROGRAMME} /></Panel>
        </div>
      </div>}>
      <SargassumMap title="Regional network" raster={REGION_BOX} views={REGION_VIEW} markers={useMemo(() => networkMarkers(d), [d.beaches, d.orgs])} height={400} timeline={false}
        layers={[{ key: 'sargassum', label: 'Sargassum', color: '#F08A3C', off: true }]}
        legend={[{ type: 'pin', kind: 'hotel', label: 'Hotels' }, { type: 'pin', kind: 'hub', label: 'Hubs' }, { type: 'pin', kind: 'processor', label: 'Processors' },
                 { type: 'pin', kind: 'lab', label: 'Laboratories' }, { type: 'pin', kind: 'agency', label: 'Agencies' }, { type: 'pin', kind: 'buyer', label: 'Buyers' }]} />
    </Console>
  )
}

/* ------------------------------------------------------------------ */
/* Government Console                                                  */
/* ------------------------------------------------------------------ */
export function GovConsole({ profile, onNavigate, reviews = [] }) {
  const d = useConsole(profile, { scope: 'all', history: true })
  const authority = d.open.filter(m => stage(m).key === 'authority')
  const pendingReviews = reviews.filter(r => r.state === 'proposed').length
  // A mission a hub raised itself is already staffed by that hub.
  const hubOwned = m => d.orgs.find(o => o.id === m.org_id)?.role === 'recovery_hub'
  const staffed = m => hubOwned(m) || (d.pools[m.id] || []).some(p => p.accepted)
  const gaps = d.open.filter(m => !staffed(m) || stage(m).key === 'owner')
  const clear = d.beaches.filter(b => b.band?.ok && !b.band.gap).length
  const pts = segPoints(d.beaches)
  const views = pts.length ? [{ key: 'coast', label: 'Coast', icon: 'pin', points: pts, maxZoom: 12, pad: 0.8 },
                              { key: 'offshore', label: 'Offshore', icon: 'waves', points: pts.flatMap(p => [[p[0] - 0.55, p[1] - 0.55], [p[0] + 0.55, p[1] + 0.55]]), maxZoom: 10, pad: 0 }]
    : [{ key: 'country', bounds: [[(CENTRE[d.code] || [18, -77])[0] - 1.2, (CENTRE[d.code] || [18, -77])[1] - 2], [(CENTRE[d.code] || [18, -77])[0] + 1.2, (CENTRE[d.code] || [18, -77])[1] + 2]] }]
  const cleanup = d.open.map(m => { const s = d.beaches.find(b => b.id === m.segment_id); return s && { lat: s.lat + 0.006, lng: s.lng + 0.006, kind: 'mission', label: m.title, note: stage(m).label } }).filter(Boolean)
  const w = d.worst
  const offshore = (w?.band?.series ?? []).map(s => ({ v: s.gap ? null : s.density }))
  const waters = (d.hist?.zones?.[d.country] ?? []).slice(-30).map(r => ({ v: r.t }))
  const recovered = useMemo(() => { let sum = 0; return [...d.batches].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(b => ({ v: (sum += Number(b.wet_mass_t || 0)) })) }, [d.batches])
  const recoveredT = d.batches.reduce((s, b) => s + Number(b.wet_mass_t || 0), 0)

  return (
    <Console
      kpis={<>
        <Kpi icon="waves" label="Sectors monitored" value={d.beaches.length} bars={Math.min(5, d.beaches.length + 1)} sub={`${d.country} coast`} />
        <Kpi icon="doc" label="Reviews pending" value={String(authority.length + pendingReviews).padStart(2, '0')} tone="amber" sub={`${authority.length} missions · ${pendingReviews} rule reviews`} />
        <Kpi icon="alert" label="Response gaps" value={String(gaps.length).padStart(2, '0')} tone={gaps.length ? 'red' : 'green'} sub="open missions not yet staffed or cleared" />
        <Kpi icon="satellite" label="Satellite reads" value={`${clear} / ${d.beaches.length}`} tone="green" bars={d.beaches.length ? Math.round((clear / d.beaches.length) * 5) : 0} sub="beaches with a clear reading" />
      </>}
      rail={<>
        <Panel title="Public-health review">
          {w ? <>
            <div className="k-lead"><span className={'k-lead-ic tone-' + (w.level?.tone || 'grey')}><Icon name="alert" size={26} /></span>
              <div><b>{w.name}</b><span className={'tone-' + (w.level?.tone || 'grey')}>{w.level ? `${w.level.label} offshore` : w.tag || 'Reading satellite'}</span></div></div>
            <div className="k-notes">
              <div><Icon name="chart" size={18} /><span><b>Field measurements needed</b>CIIN has no air-quality feed. Confirm conditions on site.</span></div>
              <div><Icon name="doc" size={18} /><span><b>Offshore reading</b>{w.latest ? `${w.latest.density} t/km² in the approach zone, ${w.latest.t.slice(0, 10)}.` : 'No clear reading yet.'}</span></div>
              <div><Icon name="waves" size={18} /><span><b>Water movement</b>{w.drift?.ok ? `Moving ${w.drift.bearing} at about ${w.drift.speed_km_day} km a day.` : 'Current not available.'}</span></div>
            </div>
            <button className="k-btn amber wide" onClick={() => onNavigate('regional')}>Review evidence</button>
            <button className="k-btn ghost wide" onClick={() => onNavigate('reports')}>Reports and exports</button>
          </> : <Empty>{d.loading ? 'Loading sectors…' : 'No beach with coordinates is on record for this country.'}</Empty>}
        </Panel>
        <Panel title="Response gap">
          {gaps.length ? gaps.slice(0, 2).map(m => <div key={m.id} className="k-lead" style={{ marginBottom: 10 }}>
            <span className="k-lead-ic tone-red"><Icon name="alert" size={26} /></span>
            <div><b>{m.title}</b><span className="tone-red">{stage(m).key === 'owner' ? 'Owner has not granted access' : 'No hub has acknowledged'}</span>
              <small>{fmt(m.tonnes)} t · expected {eta(m.eta_at)}</small></div></div>) : <Empty>Every open mission has a hub and site access.</Empty>}
          <button className="k-btn teal wide" onClick={() => onNavigate('coast')}>Open coast map</button>
        </Panel>
        <Panel title="Sector summary">
          <Facts rows={[['waves', 'Sectors monitored', d.beaches.length], ['satellite', 'Clear satellite reads', `${clear} / ${d.beaches.length}`],
            ['leaf', 'Hubs in country', d.orgs.filter(o => o.role === 'recovery_hub').length], ['target', 'Missions open', d.open.length], ['scale', 'Recovered', fmt(recoveredT) + ' t']]} />
        </Panel>
      </>}>
      <SargassumMap title="Coastal sectors" note={d.country} raster={pts.length ? boxAround(pts, 90) : null} views={views} segments={d.beaches} vectors={d.vectors} markers={cleanup}
        layers={[{ key: 'segments', label: 'Exposure', color: '#57C4AE' }, { key: 'vectors', label: 'Drift', color: '#EAF0EF' }, { key: 'mission', label: 'Cleanup', color: '#D9736A' },
                 { key: 'sargassum', label: 'Sargassum', color: '#F08A3C' }]}
        legend={[{ type: 'fill', color: '#D9736A', label: 'Offshore level: severe' }, { type: 'fill', color: '#E0A94F', label: 'Offshore level: high' }, { type: 'fill', color: '#6FC08C', label: 'Offshore level: low' },
                 { type: 'dash', color: '#EAF0EF', label: 'Drift, 24 hours' }, { type: 'pin', kind: 'mission', label: 'Open mission' }, { type: 'fill', color: '#F08A3C', label: 'Sargassum afloat, beyond 20 km' }]} />
      <Panel title="Dynamic risk trend" action={<span className="k-hint">Offshore readings · not a measurement of the beach</span>}>
        <div className="k-three tight">
          <div><div className="k-mini-h"><Icon name="leaf" size={16} />Offshore biomass <small>{w?.name || ''}</small></div><Spark rows={offshore} color="var(--amber)" x0="−30 d" x1="Now" /></div>
          <div><div className="k-mini-h"><Icon name="alert" size={16} />{d.country} waters <small>tonnes afloat</small></div><Spark rows={waters} color="var(--red)" x0="−30 d" x1="Now" /></div>
          <div><div className="k-mini-h"><Icon name="scale" size={16} />Recovered <small>cumulative tonnes</small></div><Spark rows={recovered} color="var(--green)" x0="first batch" x1="latest" /></div>
        </div>
      </Panel>
      <Panel title="Agency actions">
        {d.open.length ? <table className="k-table"><thead><tr><th>Sector</th><th>Responding</th><th>Next action</th><th>Status</th></tr></thead><tbody>
          {d.open.map(m => { const s = stage(m), seg = d.beaches.find(b => b.id === m.segment_id), pool = d.pools[m.id] || []
            return <tr key={m.id}><td><span className={'k-dot tone-' + (seg?.level?.tone || 'grey')} />{seg?.name || m.title}</td>
              <td>{pool.length ? pool.map(p => p.hub_name).join(', ') : hubOwned(m) ? d.orgName(m.org_id) : 'No hub yet'}</td><td>{s.next}</td><td><Chip tone={s.tone}>{s.label}</Chip></td></tr> })}
        </tbody></table> : <Empty>No open missions in this jurisdiction.</Empty>}
      </Panel>
    </Console>
  )
}
