import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Chip, Empty, Icon, fmt } from './kit.jsx'
import { useConsole } from './useConsole.js'
import { activeLandings, clockOf } from './Coordination.jsx'
import { stage } from './mission.js'

// The agent, one click away on every screen.
// Six layers, each saying one thing it can support and naming where it came
// from. The facts are gathered here from what this person is allowed to see;
// the agent reasons over those and nothing else. It recommends. It decides
// nothing, dispatches nobody, and never prefers a hub.

const LAYER = {
  'Forecast': ['satellite', 'Reads the sea'], 'Beach Arrival': ['waves', 'Watches for landings'], 'Mission Prioritization': ['target', 'Ranks what comes first'],
  'Logistics/Routing': ['truck', 'Counts capacity'], 'Economic Impact': ['leaf', 'Values what was cleared'], 'Governance/Learning': ['shield', 'Tracks decisions and evidence'],
}
const TIER = { satellite: 'teal', reported: 'green', indicative: 'amber', computed: 'blue', record: 'grey', directional: 'amber' }
const SCOPE = { hotel: 'org', recovery_hub: 'hub' }

function Layers({ profile, role }) {
  const d = useConsole(profile, { scope: SCOPE[role] || 'all' })
  const [out, setOut] = useState(null), [busy, setBusy] = useState(false), [open, setOpen] = useState(null)
  const facts = useMemo(() => {
    const spare = h => Math.max(0, Number(h.capacity_t || 0) - Object.values(d.pools).flat().filter(p => p.org_id === h.id && p.accepted)
      .reduce((s, p) => s + Number(d.missions.find(m => m.id === p.mission_id && !['completed', 'rejected'].includes(m.status))?.tonnes || 0), 0))
    const signed = d.removals.filter(r => r.status === 'signed')
    return {
      beaches: d.beaches.filter(b => b.band?.ok && !b.band.gap).map(b => ({ name: b.name, level: b.level?.key ?? 'low', rank: Math.max(0, b.rank), density: b.latest?.density, date: b.latest?.t,
        drift_bearing: b.drift?.ok ? b.drift.bearing : null, drift_speed: b.drift?.ok ? b.drift.speed_km_day : null, window: b.drift?.ok ? b.drift.arrival_window : null,
        tonnes: d.open.find(m => m.segment_id === b.id)?.tonnes })),
      landings: activeLandings(d).map(l => ({ name: d.segments.find(s => s.id === l.segment_id)?.name || 'A beach', hours_left: clockOf(l).left, extent: l.extent })),
      missions: { open: d.open.length, awaiting_owner: d.open.filter(m => stage(m).key === 'owner').length, awaiting_government: d.open.filter(m => stage(m).key === 'authority').length,
        unaccepted: d.open.filter(m => (d.pools[m.id] || []).length && !(d.pools[m.id] || []).some(p => p.accepted)).length, collecting: d.open.filter(m => stage(m).key === 'collecting').length },
      hubs: d.orgs.filter(o => o.role === 'recovery_hub').map(h => ({ name: h.name, spare_t: spare(h) })),
      removed: { tonnes: Math.round(d.removals.reduce((s, r) => s + Number(r.tonnes || 0), 0) * 10) / 10, signed_tonnes: Math.round(signed.reduce((s, r) => s + Number(r.tonnes || 0), 0) * 10) / 10 },
      samples: { waiting: d.samples.filter(s => s.status !== 'resulted').length },
      regional: d.waterLevel ? { country: d.country, level: d.waterLevel.label.toLowerCase(), tonnes: d.mine?.t } : null,
    }
  }, [d.beaches, d.landings, d.open, d.pools, d.orgs, d.removals, d.samples, d.waterLevel])

  async function run() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('agent', { body: facts })
    setOut(error ? { ok: false, reason: error.message } : { ...data, at: new Date() }); setBusy(false)
  }
  // Reason as soon as the records are in, then once more when the satellite
  // and current readings have all arrived, so the picture completes itself.
  const ran = useState({ first: false, full: false })[0]
  useEffect(() => {
    if (d.loading || busy) return
    if (!ran.first) { ran.first = true; run(); return }
    if (d.feedsDone && !ran.full) { ran.full = true; run() }
  }, [d.loading, d.feedsDone, busy])

  if (!out) return <Empty>{d.loading ? 'Gathering what you are allowed to see…' : 'Reasoning…'}</Empty>
  if (!out.ok) return <Empty>The agent is unavailable{out.reason ? ` (${out.reason})` : ''}.</Empty>
  return (<>
    <div className="k-agent-rec">
      <span>Recommendation · confidence {out.confidence}</span>
      <p>{out.narration || out.recommendation}</p>
      <small>{out.ai ? `Written by ${out.model} over the six statements below. Check it against them.`
        : out.ai_status === 'no_key' ? 'From rules only. No language model is connected on this environment.'
        : `From rules only. The language model did not answer${out.reason ? ` (${out.reason})` : ''}.`}</small>
    </div>
    <div className="k-agent-h">Agent layers</div>
    {(out.agents || []).map((a, i) => { const [ic, does] = LAYER[a.agent] || ['grid', '']; return (
      <button key={a.agent} className={'k-layer' + (open === i ? ' on' : '')} onClick={() => setOpen(open === i ? null : i)}>
        <span className="k-layer-n">{i + 1}</span>
        <span className="k-layer-ic"><Icon name={ic} size={20} /></span>
        <span className="k-layer-b"><b>{a.agent}<small>{does}</small></b><span>{a.says}</span>
          {open === i && <span className="k-layer-x"><em>Reads</em>{a.reads}<em>Source</em>{a.source}</span>}</span>
        <Chip tone={TIER[a.tier] || 'grey'}>{a.tier || 'record'}</Chip>
      </button>) })}
    <div className="k-agent-f">
      <button className="k-btn ghost sm" disabled={busy} onClick={run}>{busy ? 'Reasoning…' : 'Run again'}</button>
      <span>{!d.feedsDone ? 'Still reading the satellite and the currents; will run again when they arrive.' : out.at ? 'Last run ' + out.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
    </div>
    <p className="k-agent-note">The agent recommends. It decides nothing, dispatches nobody and never prefers a hub. It sees only what your account is allowed to see.</p>
  </>)
}

// The agent's own screen: the recommendation, the six layers, what was read,
// and the reasoning frozen against each mission it raised.
export function AgentPage({ profile, role }) {
  return (
    <div className="k-console">
      <div className="k-agent-page">
        <div className="k-panel"><div className="k-agent-head"><span className="k-agent-mark"><Icon name="agent" size={24} /></span>
          <div><b>CIIN Agent</b><small>Six layers over grounded facts. It recommends; people decide.</small></div></div>
          <Layers profile={profile} role={role} />
        </div>
        <Proposals profile={profile} />
      </div>
    </div>
  )
}

function Proposals({ profile }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('agent_proposals').select('id, mission_id, recommendation, confidence, narration, ai_model, feed_as_of, created_at, missions(title, status)')
      .order('created_at', { ascending: false }).limit(12).then(({ data }) => setRows(data ?? []))
  }, [profile?.org_id])
  return (
    <div className="k-panel">
      <div className="k-panel-h"><h3>What it said when each mission was raised<small>frozen at the time</small></h3></div>
      {rows === null ? <Empty>Loading…</Empty> : rows.length ? rows.map(r => (
        <div key={r.id} className="k-prop">
          <div className="k-visit-t"><b>{r.missions?.title || 'Mission'}</b><Chip tone={r.confidence === 'high' ? 'red' : 'amber'}>confidence {r.confidence}</Chip></div>
          <p>{r.narration || r.recommendation}</p>
          <small>{new Date(r.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {r.ai_model ? ` · written by ${r.ai_model}` : ' · rules only'}{r.feed_as_of?.band ? ` · satellite ${String(r.feed_as_of.band).slice(0, 10)}` : ''}
            {r.missions?.status ? ` · mission now ${r.missions.status.replace(/_/g, ' ')}` : ''}</small>
        </div>)) : <Empty>No mission has been raised by the agent yet, so nothing is on record.</Empty>}
      <p className="k-agent-note">Each entry is what the agent put in front of people at the moment the mission was raised. It is never edited afterwards.</p>
    </div>
  )
}
