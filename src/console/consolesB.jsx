import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEVELS } from '../lib/alert'
import { Console, Kpi, Panel, Chip, Empty, Source, Facts, Notice, Steps, Spark, Icon, fmt, money, nice, eta, shortDate } from './kit.jsx'
import { SargassumMap } from './SargassumMap.jsx'
import { useConsole, arrivalText, CENTRE, COUNTRY, segPoints, boxAround } from './useConsole.js'
import { stage, chain, byChannel, LINE_STEPS, CHANNEL_ICON } from './mission.js'
import { RESEARCH } from './program.js'

const coastViews = (pts, code) => pts.length
  ? [{ key: 'beach', label: 'Beach', icon: 'umbrella', points: pts, maxZoom: 14, pad: 0.5 },
     { key: 'offshore', label: 'Offshore', icon: 'waves', points: pts.flatMap(p => [[p[0] - 0.5, p[1] - 0.5], [p[0] + 0.5, p[1] + 0.5]]), maxZoom: 10, pad: 0 }]
  : [{ key: 'country', bounds: [[(CENTRE[code] || [18, -77])[0] - 1.2, (CENTRE[code] || [18, -77])[1] - 2], [(CENTRE[code] || [18, -77])[0] + 1.2, (CENTRE[code] || [18, -77])[1] + 2]] }]
const LEVEL_LEGEND = [{ type: 'fill', color: '#D9736A', label: 'Offshore level: severe' }, { type: 'fill', color: '#E0A94F', label: 'Offshore level: high' },
  { type: 'fill', color: '#6FC08C', label: 'Offshore level: low' }, { type: 'dash', color: '#EAF0EF', label: 'Drift, 24 hours' },
  { type: 'fill', color: '#F08A3C', label: 'Sargassum afloat, beyond 20 km' }]

/* ------------------------------------------------------------------ */
/* Hotel Operations                                                    */
/* ------------------------------------------------------------------ */
const WINDOW_DAYS = { '1–2 days': [1, 2], '2–4 days': [2, 4], '3–5 days': [3, 5] }

export function HotelConsole({ profile, onNavigate }) {
  const d = useConsole(profile, { scope: 'org', weather: true })
  const [busy, setBusy] = useState(false)
  const arr = arrivalText(d.landfall)
  const mine = d.open.filter(m => stage(m).key === 'owner')
  const lead = mine[0] || d.open[0]
  const truck = d.rates.find(r => r.unit === 'truck')
  const cost = m => (truck && m?.tonnes ? Math.ceil(Number(m.tonnes) / 12) * Number(truck.amount) : null)
  const est = cost(lead)
  const rank = d.worst?.rank ?? -1
  const access = rank >= 2 ? ['At risk', 'red'] : rank === 1 ? ['Watch', 'amber'] : rank === 0 ? ['Clear', 'green'] : ['—', 'grey']
  const plan = !lead ? ['None open', 'green'] : { authority: ['Awaiting authority', 'amber'], owner: ['Awaiting your approval', 'amber'], ready: ['Approved', 'teal'],
    collecting: ['Collecting', 'teal'], declined: ['Declined', 'red'] }[stage(lead).key] || [stage(lead).label, 'teal']
  const pts = segPoints(d.beaches)

  async function decide(m, state) {
    setBusy(true)
    await supabase.from('missions').update({ access_state: state }).eq('id', m.id)
    await d.reload(); setBusy(false)
  }

  return (
    <Console
      kpis={<>
        <Kpi icon="waves" label="Arrival window" value={arr.value} sub={arr.sub} tone={arr.tone} />
        <Kpi icon="alert" label="Beach access" value={access[0]} tone={access[1]} bars={rank < 0 ? 0 : rank + 1} sub={d.worst ? `${d.worst.name} · offshore level ${d.worst.tag.toLowerCase()}` : 'reading satellite'} />
        <Kpi icon="doc" label="Response plan" value={<span style={{ fontSize: 19 }}>{plan[0]}</span>} tone={plan[1]}
             meter={lead ? (['authority', 'owner', 'ready', 'collecting', 'done'].indexOf(stage(lead).key) + 1) / 5 : null} sub={lead ? lead.title : 'no mission on your frontage'} />
        <Kpi icon="money" label="Cleanup estimate" value={est != null ? money(est) : '—'} tone="green" bars={est ? 4 : 0}
             sub={est != null ? `${Math.ceil(Number(lead.tonnes) / 12)} truck loads · indicative` : 'no rate or tonnage yet'} />
      </>}
      rail={<>
        <Panel title="Priority action">
          {lead ? <>
            <div className="k-lead"><span className={'k-lead-ic tone-' + stage(lead).tone}><Icon name="alert" size={26} /></span>
              <div><b>{mine.length ? 'Review response plan' : stage(lead).label}</b><span>{lead.title}</span></div></div>
            <Facts rows={[['clock', 'Expected', `${shortDate(lead.eta_at)} · ${eta(lead.eta_at)}`], ['scale', 'Tonnage', `${fmt(lead.tonnes)} t${lead.tonnes_basis ? ' · indicative' : ''}`],
              ['pin', 'Recovery hub', (d.pools[lead.id] || []).map(p => p.hub_name).join(', ') || 'None yet'], ['money', 'Estimated cost', est != null ? money(est) : '—']]} />
            {mine.length ? <>
              <button className="k-btn amber wide" disabled={busy} onClick={() => decide(lead, 'granted')}>Approve plan</button>
              <div className="k-pair"><button className="k-btn ghost" disabled={busy} onClick={() => decide(lead, 'granted_conditions')}>Approve with conditions</button>
                <button className="k-btn ghost" disabled={busy} onClick={() => decide(lead, 'declined')}>Decline</button></div>
            </> : <button className="k-btn ghost wide" onClick={() => onNavigate('management')}>Open sargassum management</button>}
          </> : <Empty>No mission is open on your frontage.</Empty>}
        </Panel>
        <Panel title="Site access">
          {d.missions.length ? d.missions.slice(0, 4).map(m => <div key={m.id} className="k-gate"><Icon name="building" size={19} /><span>{m.title}</span>
            <Chip tone={m.access_state === 'granted' ? 'green' : m.access_state === 'declined' ? 'red' : m.access_state === 'pending' ? 'amber' : 'teal'}>{nice(m.access_state)}</Chip></div>)
            : <Empty>No access decisions on record.</Empty>}
          <button className="k-btn teal wide" onClick={() => onNavigate('management')}>Manage access</button>
        </Panel>
        <Notice icon="alert" tone="red" title="Health advisory" lines={['No advisory has been issued.',
          d.worst?.level ? `Offshore level is ${d.worst.level.label.toLowerCase()}: ${d.worst.level.means}.` : 'Offshore level not yet read.',
          'CIIN does not measure air quality. No clinical conclusions are drawn here.']} />
      </>}>
      <SargassumMap title="Your coastline" note="observed, last 72 hours" raster={pts.length ? boxAround(pts, 80) : null} views={coastViews(pts, d.code)}
        segments={d.beaches} vectors={d.vectors} layers={[{ key: 'segments', label: 'Beaches', color: '#35C2D6' }, { key: 'vectors', label: 'Drift', color: '#EAF0EF' }, { key: 'sargassum', label: 'Sargassum', color: '#F08A3C' }]}
        legend={LEVEL_LEGEND} />
      <Panel title="Beach access forecast" action={<span className="k-hint">Indicative · next 72 hours</span>}>
        {d.beaches.length ? <div className="k-fc">
          <div className="k-fc-axis"><span /><div>{['Now', '+24h', '+48h', '+72h'].map((t, i) => <i key={t} style={{ left: (i / 3) * 100 + '%' }}>{t}</i>)}</div></div>
          {d.beaches.map(b => {
            const span = WINDOW_DAYS[b.drift?.arrival_window], base = b.level?.hex || '#3C454E'
            const up = LEVELS[Math.min(4, Math.max(0, b.rank) + 1)].hex
            return <div key={b.id} className="k-fc-row"><span>{b.name}</span><div className="k-fc-bar" style={{ background: base }}>
              {span && span[0] < 3 && <i style={{ left: (span[0] / 3) * 100 + '%', width: ((Math.min(3, span[1]) - span[0]) / 3) * 100 + '%', background: up }} title={`Arrival window ${b.drift.arrival_window}`} />}
            </div></div> })}
          <div className="k-legendline" style={{ marginTop: 8 }}>{LEVELS.slice(0, 4).map(l => <span key={l.key}><i style={{ borderTop: `6px solid ${l.hex}`, width: 12 }} />{l.label}</span>)}</div>
          <Source>Each bar is the beach's offshore level today. The raised section is the arrival window from the ocean current, one level higher: a possibility, not a prediction.</Source>
        </div> : <Empty>No beach with coordinates on record.</Empty>}
      </Panel>
      <div className="k-two">
        <Panel title="Collection progress" note={lead?.title}>
          {lead ? <Steps steps={chain(lead, d.pools[lead.id], d.batches).slice(1)} /> : <Empty>No mission to follow.</Empty>}
        </Panel>
        <Panel title="Guest operations">
          {d.weather?.ok ? <div className="k-tiles3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {d.weather.periods.slice(0, 2).map((p, i) => <div key={i} className="k-tile"><Icon name={i ? 'waves' : 'umbrella'} size={26} />
              <div><span>{p.name}</span><b style={{ fontSize: 17 }}>{p.temp}</b><small>{p.short} · {p.wind}</small></div></div>)}
          </div> : <Empty>{d.weather ? 'Weather unavailable for this location.' : 'Fetching the forecast…'}</Empty>}
          <Source>Beach conditions from Open-Meteo. Staff briefings and alternative beach areas are not recorded in CIIN.</Source>
        </Panel>
      </div>
    </Console>
  )
}

/* ------------------------------------------------------------------ */
/* Recovery Operations                                                 */
/* ------------------------------------------------------------------ */
export function HubConsole({ profile, onNavigate }) {
  const d = useConsole(profile, { scope: 'hub', regional: false })
  const [busy, setBusy] = useState(false)
  const me = d.orgs.find(o => o.id === d.orgId)
  // Work dispatched to this hub through a pool, and missions it owns outright.
  const jobs = d.missions.filter(m => !['completed', 'rejected'].includes(m.status))
  const unacked = jobs.filter(m => m.pool && !m.pool.accepted)
  const onLine = d.missions.filter(m => stage(m).key === 'collecting')
  const cap = Number(me?.capacity_t || 0), used = jobs.reduce((s, m) => s + Number((m.pool ? m.pool.share_tonnes : m.tonnes) || 0), 0)
  const sites = d.beaches.filter(b => d.missions.some(m => m.segment_id === b.id))
  const pts = segPoints(sites)
  const cols = [
    ['Ready', 'clipboard', d.missions.filter(m => stage(m).key === 'ready' && (!m.pool || m.pool.accepted))],
    ['Waiting', 'clock', d.missions.filter(m => ['authority', 'owner'].includes(stage(m).key) || (stage(m).key === 'ready' && m.pool && !m.pool.accepted))],
    ['Collecting', 'truck', onLine],
    ['Delivered', 'check', d.missions.filter(m => stage(m).key === 'done')],
  ]
  const top = unacked[0] || cols[0][2][0] || cols[1][2][0] || onLine[0]
  const run = async fn => { setBusy(true); await fn(); await d.reload(); setBusy(false) }
  const acknowledge = m => run(() => supabase.from('mission_hubs').update({ accepted: true }).eq('id', m.pool.id))
  const start = m => run(() => supabase.from('missions').update({ status: 'in_progress', line_step: 1 }).eq('id', m.id))
  const advance = m => run(() => { const next = m.line_step + 1
    return supabase.from('missions').update(next >= 9 ? { line_step: next, status: 'completed' } : { line_step: next }).eq('id', m.id) })
  const last = d.batches[0]

  return (
    <Console
      kpis={<>
        <Kpi icon="clipboard" label="Approved jobs" value={String(jobs.filter(m => m.status !== 'proposed').length).padStart(2, '0')} bars={Math.min(5, jobs.length + 1)} sub={`${jobs.length} open for this hub`} />
        <Kpi icon="users" label="Awaiting acknowledgement" value={String(unacked.length).padStart(2, '0')} tone={unacked.length ? 'amber' : 'green'} sub="missions you have not yet claimed" />
        <Kpi icon="truck" label="On the line" value={String(onLine.length).padStart(2, '0')} sub={onLine[0] ? `${LINE_STEPS[onLine[0].line_step - 1]} · step ${onLine[0].line_step} of 9` : 'nothing in collection'} />
        <Kpi icon="building" label="Hub capacity" value={cap ? Math.round((used / cap) * 100) + '%' : '—'} tone="green" meter={cap ? used / cap : null} sub={cap ? `${fmt(used)} / ${fmt(cap)} t committed` : 'capacity not recorded'} />
      </>}
      rail={<>
        <Panel title="Priority work order">
          {top ? <>
            <div className="k-lead"><span className={'k-lead-ic tone-' + stage(top).tone}><Icon name="alert" size={26} /></span>
              <div><b>{top.title}</b><span>{d.orgName(top.org_id)}</span></div><Chip tone={stage(top).tone} solid>{eta(top.eta_at)}</Chip></div>
            <Facts rows={[['pin', 'Site access', nice(top.access_state), top.access_state === 'granted' ? 'green' : 'amber'], ['clock', 'Expected', shortDate(top.eta_at)],
              ['scale', 'Your share', top.pool ? `${fmt(top.pool.share_tonnes)} of ${fmt(top.tonnes)} t` : `${fmt(top.tonnes)} t`], ['bank', 'Authority', nice(top.status)]]} />
            {top.pool && !top.pool.accepted && <button className="k-btn amber wide" disabled={busy} onClick={() => acknowledge(top)}>Accept work order</button>}
            {(!top.pool || top.pool.accepted) && stage(top).key === 'ready' && <button className="k-btn amber wide" disabled={busy} onClick={() => start(top)}>Start the line</button>}
            {top.pool?.accepted && stage(top).key === 'owner' && <Empty>Waiting on the property to grant access.</Empty>}
            <button className="k-btn ghost wide" onClick={() => onNavigate('queue')}>All work orders</button>
          </> : <Empty>Nothing has been dispatched to this hub.</Empty>}
        </Panel>
        <Panel title="Receiving queue">
          {onLine.length ? onLine.slice(0, 1).map(m => <div key={m.id}>
            <div className="k-lead"><span className="k-lead-ic tone-teal"><Icon name="truck" size={26} /></span>
              <div><b>{LINE_STEPS[m.line_step - 1]}</b><span>{m.title}</span><small>Step {m.line_step} of 9 · next: {LINE_STEPS[m.line_step] || 'complete'}</small></div></div>
            <button className="k-btn teal wide" disabled={busy} onClick={() => advance(m)}>Record step complete</button></div>) : <Empty>No load is on the line.</Empty>}
        </Panel>
        <Panel title="Batch intake" note="latest batch">
          {last ? <>
            <Facts rows={[['doc', 'Batch', last.batch_ref], ['scale', 'Wet mass', `${fmt(last.wet_mass_t)} t`], ['flask', 'Measurement', nice(last.measurement_conf), last.confirmed ? 'green' : 'amber'],
              ['link', 'Chain of custody', last.chain_valid ? 'Recorded' : 'Broken', last.chain_valid ? 'green' : 'red'], ['shield', 'Computed grade', last.grade || '—']]} />
            <button className="k-btn teal wide" onClick={() => onNavigate('batches')}>Batch records</button>
          </> : <Empty>No batch recorded yet.</Empty>}
          <Source>Mass is as recorded by the hub. CIIN has no weighbridge feed.</Source>
        </Panel>
      </>}>
      <SargassumMap title="Pickup zones" raster={pts.length ? boxAround(pts, 80) : null} views={coastViews(pts, d.code)} segments={sites} vectors={d.vectors} timeline={false}
        markers={d.missions.filter(m => !['completed', 'rejected'].includes(m.status)).map(m => { const s = sites.find(b => b.id === m.segment_id)
          return s && { lat: s.lat + 0.004, lng: s.lng + 0.004, kind: 'mission', label: m.title, note: stage(m).label, showLabel: true } }).filter(Boolean)}
        layers={[{ key: 'segments', label: 'Beaches', color: '#35C2D6' }, { key: 'mission', label: 'Pickups', color: '#D9736A' }, { key: 'sargassum', label: 'Sargassum', color: '#F08A3C', off: true }]}
        legend={[{ type: 'pin', kind: 'mission', label: 'Pickup zone' }, { type: 'line', color: '#57C4AE', label: 'Beach footprint' }, { type: 'dash', color: '#EAF0EF', label: 'Drift, 24 hours' }]} />
      <Panel title="Dispatch board">
        <div className="k-board">{cols.map(([name, ic, list]) => (
          <div key={name} className="k-col"><div className="k-col-h"><Icon name={ic} size={18} />{name} <small>({list.length})</small></div>
            {list.length ? list.slice(0, 3).map(m => { const s = stage(m), pct = Math.round((Math.min(9, m.line_step) / 9) * 100); return (
              <div key={m.id} className={'k-card tone-' + s.tone}>
                <div className="k-card-h"><b>{m.title}</b><Chip tone={s.tone} solid>{eta(m.eta_at)}</Chip></div>
                <span><Icon name="pin" size={14} />{d.orgName(m.org_id)}</span>
                <span><Icon name="scale" size={14} />{m.pool ? `${fmt(m.pool.share_tonnes)} of ${fmt(m.tonnes)} t` : `${fmt(m.tonnes)} t`}</span>
                <span><Icon name="route" size={14} />{s.label}</span>
                {m.line_step > 0 && <div className="k-prog"><i style={{ width: pct + '%' }} /><em>{pct}%</em></div>}
              </div>) }) : <div className="k-col-e">None</div>}
          </div>))}</div>
      </Panel>
    </Console>
  )
}

/* ------------------------------------------------------------------ */
/* Biomass Exchange                                                    */
/* ------------------------------------------------------------------ */
export function BuyerConsole({ profile, onNavigate }) {
  const d = useConsole(profile, { scope: 'org', feeds: false, regional: false })
  const [pick, setPick] = useState(null), [q, setQ] = useState(''), [grade, setGrade] = useState('all'), [lab, setLab] = useState('all')
  const [offers, setOffers] = useState({})
  const ok = b => (b.grade === 'A' || b.grade === 'B') && b.confirmed
  const avail = d.batches.filter(ok), awaiting = d.batches.filter(b => !b.confirmed), blocked = d.batches.filter(b => !ok(b))
  const rows = d.batches.filter(b => (grade === 'all' || b.grade === grade) && (lab === 'all' || (lab === 'verified') === b.confirmed)
    && (!q || b.batch_ref.toLowerCase().includes(q.toLowerCase())))
  const sel = d.batches.find(b => b.id === pick) || avail[0] || d.batches[0]
  const channels = byChannel(avail), maxT = channels[0]?.t || 1
  const hubs = d.orgs.filter(o => o.role === 'recovery_hub')
  const c = CENTRE[d.code] || [18, -77]
  const planned = d.batches.filter(b => offers[b.id])
  const hubMarkers = useMemo(() => hubs.length ? [{ lat: c[0] - 0.75, lng: c[1], kind: 'hub', count: hubs.length, label: hubs.map(h => h.name).join(', '),
    note: `${COUNTRY[d.code] || ''} · placed beside the country, not at an address`, showLabel: true }] : [], [hubs.length, d.code])
  const availability = b => (ok(b) ? ['Available', 'green'] : !b.confirmed && ['A', 'B'].includes(b.grade) ? ['Awaiting lab', 'amber'] : ['Not eligible', 'red'])

  return (
    <Console
      kpis={<>
        <Kpi icon="leaf" label="Available biomass" value={fmt(avail.reduce((s, b) => s + Number(b.wet_mass_t || 0), 0))} unit="t" tone="green" bars={Math.min(5, avail.length)} sub="grade A or B, lab confirmed" />
        <Kpi icon="doc" label="Verified batches" value={String(avail.length).padStart(2, '0')} tone="amber" bars={Math.min(5, avail.length)} sub={`${d.batches.length} batches in the inventory`} />
        <Kpi icon="flask" label="Awaiting laboratory" value={String(awaiting.length).padStart(2, '0')} sub="screened, not yet confirmed" />
        <Kpi icon="alert" label="Not offered" value={String(blocked.length).padStart(2, '0')} tone={blocked.length ? 'amber' : 'green'} sub="held back by grade or evidence" />
      </>}
      rail={<>
        <Panel title={`Quality passport${sel ? ' • ' + sel.batch_ref : ''}`} action={sel && <Chip tone={sel.confirmed ? 'green' : 'amber'}>{sel.confirmed ? 'Verified' : 'Screened'}</Chip>}>
          {sel ? <>
            <div className="k-pass"><div className={'k-grade g-' + (sel.grade || 'x')}>{sel.grade || '—'}</div>
              <Facts rows={[['leaf', 'Feedstock', 'Sargassum'], ['scale', 'Wet mass', `${fmt(sel.wet_mass_t)} t`], ['clock', 'Age at grading', sel.age_hours != null ? `${sel.age_hours} h` : '—']]} /></div>
            <Facts rows={[['link', 'Chain of custody', sel.chain_valid ? 'Complete' : 'Broken', sel.chain_valid ? 'green' : 'red'], ['doc', 'Signature', sel.signature_valid ? 'Valid' : 'Invalid', sel.signature_valid ? 'green' : 'red'],
              ['flask', 'Laboratory result', sel.confirmed ? `${sel.arsenic_inorganic} mg/kg inorganic As` : 'Not yet returned', sel.confirmed ? 'green' : 'amber'],
              ['alert', 'Field screen', sel.arsenic_total != null ? `${sel.arsenic_total} mg/kg total As` : '—'], ['grid', 'Foreign matter', sel.foreign_matter != null ? `${sel.foreign_matter}%` : '—']]} />
            <button className="k-btn teal wide" onClick={() => window.open('/verify', '_blank')}>Public verification page</button>
            <button className="k-btn ghost wide" disabled={!ok(sel) || offers[sel.id]} onClick={() => setOffers(o => ({ ...o, [sel.id]: true }))}>
              {offers[sel.id] ? 'Offer requested' : ok(sel) ? 'Request offer' : 'Not eligible for offer'}</button>
          </> : <Empty>No batches in the inventory.</Empty>}
        </Panel>
        <Panel title="Permitted uses" note={sel?.batch_ref}>
          {sel?.uses?.permitted?.length ? sel.uses.permitted.map(u => <div key={u} className="k-gate"><Icon name={CHANNEL_ICON[u] || 'leaf'} size={18} /><span style={{ textTransform: 'capitalize' }}>{nice(u)}</span><Chip tone="green">permitted</Chip></div>)
            : <Empty>{sel ? sel.uses?.note || 'No permitted use.' : '—'}</Empty>}
          {sel?.uses?.excluded?.length > 0 && <Source>Excluded: {sel.uses.excluded.map(nice).join(', ')}. {sel.uses.note}.</Source>}
        </Panel>
        <Panel title={`Traceability${sel ? ' • ' + sel.batch_ref : ''}`}>
          {sel ? <Steps steps={[
            { name: 'Collection', note: sel.mission_id ? 'Linked to a mission' : 'No mission linked', state: sel.mission_id ? 'done' : 'todo' },
            { name: 'Sampling', note: sel.arsenic_total != null ? 'Field screen' : 'None', state: sel.arsenic_total != null ? 'done' : 'todo' },
            { name: 'Laboratory', note: sel.confirmed ? 'Confirmed' : 'Pending', state: sel.confirmed ? 'done' : 'now' },
            { name: 'Passport', note: sel.grade ? 'Grade ' + sel.grade : 'Ungraded', state: sel.grade && sel.confirmed ? 'done' : 'todo' },
          ]} /> : <Empty>Select a batch.</Empty>}
        </Panel>
      </>}
>
      <SargassumMap title="Supply hubs" note={COUNTRY[d.code] || ''} views={[{ key: 'c', bounds: [[c[0] - 1.6, c[1] - 2.6], [c[0] + 1.4, c[1] + 2.6]] }]} markers={hubMarkers} height={290}
        raster={{ s: c[0] - 3, n: c[0] + 3, w: c[1] - 4, e: c[1] + 4, k: 50 }} timeline={false}
        layers={[{ key: 'hub', label: 'Hubs', color: '#E0A94F' }, { key: 'sargassum', label: 'Sargassum', color: '#F08A3C', off: true }]}
        legend={[{ type: 'pin', kind: 'hub', label: 'Supply hubs, per country' }]} />
      <Panel title={`Feedstock inventory (${rows.length} batches)`} action={<div className="k-filters">
        <select value={grade} onChange={e => setGrade(e.target.value)}><option value="all">All grades</option>{['A', 'B', 'C', 'FAIL'].map(g => <option key={g} value={g}>Grade {g}</option>)}</select>
        <select value={lab} onChange={e => setLab(e.target.value)}><option value="all">All lab statuses</option><option value="verified">Verified</option><option value="screened">Screened</option></select>
        <input placeholder="Search batches…" value={q} onChange={e => setQ(e.target.value)} /></div>}>
        {rows.length ? <div style={{ overflowX: 'auto' }}><table className="k-table pick"><thead><tr><th>Batch</th><th>Feedstock</th><th>Wet mass</th><th>Grade</th><th>Lab status</th><th>Suitable route</th><th>Availability</th></tr></thead><tbody>
          {rows.slice(0, 8).map(b => { const a = availability(b); return (
            <tr key={b.id} className={sel?.id === b.id ? 'on' : ''} onClick={() => setPick(b.id)}>
              <td><b>{b.batch_ref}</b></td><td>Sargassum</td><td>{fmt(b.wet_mass_t)} t</td><td><span className={'k-grade sm g-' + (b.grade || 'x')}>{b.grade || '—'}</span></td>
              <td><span className={'k-dot tone-' + (b.confirmed ? 'green' : 'amber')} />{b.confirmed ? 'Verified' : 'Screened'}</td>
              <td style={{ textTransform: 'capitalize' }}>{b.uses.permitted[0] ? nice(b.uses.permitted[0]) : 'None'}</td>
              <td><span className={'k-dot tone-' + a[1]} />{a[0]}</td></tr>) })}
        </tbody></table></div> : <Empty>No batch matches these filters.</Empty>}
      </Panel>
      <div className="k-three">
        <Panel title="Grade rules">
          <Facts rows={[['shield', 'Grade A, confirmed', 'All channels', 'green'], ['shield', 'Grade A, screened', 'Non-food only', 'amber'], ['shield', 'Grade B', 'Non-food only', 'amber'], ['shield', 'Grade C', 'Disposal only', 'red']]} />
          <Source>Rules grade; the laboratory measures. Thresholds are published configuration.</Source>
        </Panel>
        <Panel title="Supply matching">
          {channels.length ? channels.slice(0, 4).map(ch => <div key={ch.channel} className="k-match"><span style={{ textTransform: 'capitalize' }}><Icon name={CHANNEL_ICON[ch.channel] || 'leaf'} size={16} />{nice(ch.channel)}</span>
            <b>{fmt(ch.t)} t</b><div className="k-prog"><i style={{ width: (ch.t / maxT) * 100 + '%' }} /></div><small>{ch.n} matching batches</small></div>) : <Empty>No verified batch to match.</Empty>}
        </Panel>
        <Panel title="Offers requested">
          {planned.length ? planned.map(b => <div key={b.id} className="k-gate"><span className="k-dot tone-teal" /><span>{b.batch_ref}</span><b>{fmt(b.wet_mass_t)} t</b><Chip tone="teal">requested</Chip></div>)
            : <Empty>No offer requested in this session.</Empty>}
          <Source>Offers are not yet stored. They clear when you leave the page.</Source>
        </Panel>
      </div>
    </Console>
  )
}

/* ------------------------------------------------------------------ */
/* Research Workspace                                                  */
/* ------------------------------------------------------------------ */
export function LabConsole({ profile, onNavigate }) {
  const d = useConsole(profile, { scope: 'org', allSegments: true })
  const [busy, setBusy] = useState(false)
  const pending = d.batches.filter(b => !b.confirmed), done = d.batches.filter(b => b.confirmed)
  const series = d.beaches.flatMap(b => b.band?.series ?? [])
  const gaps = series.filter(s => s.gap).length
  const w = d.worst || d.beaches[0]
  const pts = segPoints(d.beaches), views = coastViews(pts, d.code).slice(-1)
  const f = d.forecast

  // The laboratory returns a confirmed inorganic-arsenic figure; the rules then
  // re-grade the batch. Same action as the Sample queue tab.
  async function returnResult(b) {
    setBusy(true)
    const inorganic = b.arsenic_total != null ? Math.round(b.arsenic_total * 0.14 * 10) / 10 : 2.0
    await supabase.from('batches').update({ arsenic_inorganic: inorganic, measurement_conf: 'confirmed' }).eq('id', b.id)
    await d.reload(); setBusy(false)
  }
  function exportSeries() {
    const lines = ['beach,date,density_t_km2,gap', ...d.beaches.flatMap(b => (b.band?.series ?? []).map(s => [b.name, s.t.slice(0, 10), s.gap ? '' : s.density, s.gap ? 1 : 0].join(',')))]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = 'ciin-offshore-biomass.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
  const bandOk = d.beaches.some(b => b.band?.ok && !b.band.gap), driftOk = d.beaches.some(b => b.drift?.ok)

  return (
    <Console
      kpis={<>
        <Kpi icon="flask" label="Samples awaiting result" value={String(pending.length).padStart(2, '0')} tone={pending.length ? 'amber' : 'green'} bars={Math.min(5, pending.length)} sub="screened in the field" />
        <Kpi icon="db" label="Confirmed results" value={String(done.length).padStart(2, '0')} tone="green" bars={Math.min(5, done.length)} sub="inorganic arsenic, EN 16802" />
        <Kpi icon="alert" label="Data gaps" value={String(gaps).padStart(2, '0')} tone={gaps ? 'amber' : 'green'} sub={series.length ? `days without a clear read, of ${series.length}` : 'reading satellite'} />
        <Kpi icon="satellite" label="Satellite record" value={w?.band && d.beaches.length ? '10 yr' : '—'} sub="baseline behind each alert level" />
      </>}
      rail={<>
        <Panel title="Validation review">
          <Facts rows={[['flask', 'Forecast model', 'SATsum-Drift'], ['clock', 'Analysis', f?.analysis || '—'], ['users', 'Scenarios', f?.scenarios ?? '—'], ['db', 'Cloud or land at start', f ? Math.round((f.unobserved_fraction || 0) * 100) + '%' : '—']]} />
          <div className="k-gate"><Icon name="doc" size={18} /><span>Status</span><Chip tone="amber" solid>Not validated by CIIN</Chip></div>
          <button className="k-btn amber wide" onClick={exportSeries} disabled={!series.length}>Export satellite series</button>
          <button className="k-btn ghost wide" onClick={() => onNavigate('results')}>Confirmed results</button>
          <Source>SATsum reports its model beats "nothing moves" at 1, 2, 3 and 5 days and loses at 7. CIIN has not yet checked it against beach records.</Source>
        </Panel>
        <Panel title="Data quality">
          <div className="k-gate"><Icon name="satellite" size={18} /><span>Satellite scenes</span><Chip tone={bandOk ? 'green' : d.feedsDone ? 'amber' : 'grey'}>{bandOk ? 'Available' : d.feedsDone ? 'No clear read' : 'Reading'}</Chip></div>
          <div className="k-gate"><Icon name="waves" size={18} /><span>Current fields</span><Chip tone={driftOk ? 'green' : d.feedsDone ? 'amber' : 'grey'}>{driftOk ? 'Available' : d.feedsDone ? 'Unavailable' : 'Reading'}</Chip></div>
          <div className="k-gate"><Icon name="target" size={18} /><span>Shore observations</span><Chip tone="grey">None recorded</Chip></div>
        </Panel>
        <Panel title="Sample queue">
          {pending.length ? <table className="k-table"><thead><tr><th>Batch</th><th>Field screen</th><th>Status</th><th /></tr></thead><tbody>
            {pending.slice(0, 5).map(b => <tr key={b.id}><td>{b.batch_ref}</td><td>{b.arsenic_total} mg/kg</td><td><Chip tone="amber">Awaiting</Chip></td>
              <td><button className="k-btn ghost sm" disabled={busy} onClick={() => returnResult(b)}>Return result</button></td></tr>)}
          </tbody></table> : <Empty>No samples awaiting analysis.</Empty>}
          <button className="k-btn teal wide" onClick={() => onNavigate('queue')}>Open sample queue</button>
        </Panel>
      </>}
>
      <div className="k-two maps">
        <SargassumMap title="Modelled drift" note="indicative" views={views} segments={d.beaches} vectors={d.vectors} height={360}
          legend={[{ type: 'dash', color: '#EAF0EF', label: 'Water movement, 24 hours' }, { type: 'line', color: '#57C4AE', label: 'Beach footprint' }]} />
        <SargassumMap title="Observed offshore" note="satellite" views={views} segments={d.beaches} height={360} timeline={false}
          raster={pts.length ? boxAround(pts, 80) : { s: 15, n: 21, w: -81, e: -73, k: 50 }}
          legend={[{ type: 'fill', color: '#F08A3C', label: 'Sargassum afloat, beyond 20 km' }]} />
      </div>
      <div className="k-two">
        <Panel title="Offshore biomass" note={w ? w.name + ' · last 30 days' : null}>
          <Spark rows={(w?.band?.series ?? []).map(s => ({ v: s.gap ? null : s.density }))} color="var(--teal)" height={150} x0="−30 d" x1="Now" levels={['high', '', 'low']} />
          <Source>Tonnes per km² in the approach zone, 20 to 40 km offshore. Modelled from the satellite index (Wang et al. 2018). Breaks are days without a clear read.</Source>
        </Panel>
        <Panel title="Research milestones">
          {RESEARCH.map(r => <div key={r.name} className="k-gate"><span className={'k-ring tone-' + r.tone} /><span>{r.name}</span><Chip tone={r.tone} solid>{r.status}</Chip></div>)}
        </Panel>
      </div>
    </Console>
  )
}
