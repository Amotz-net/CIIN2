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

export function AgentButton({ profile, role, rail = false }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const esc = e => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [open])
  return (<>
    {rail
      ? <a className={'rail-item rail-agent' + (open ? ' active' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Open the CIIN agent">
          <span className="rail-ic"><Icon name="agent" size={20} /></span><span className="rail-lbl">Agent</span><i className="rail-dot" /></a>
      : <button className={'k-agent-btn' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Open the CIIN agent">
          <Icon name="agent" size={20} /><span>Agent</span><i />
        </button>}
    {open && <div className="k-agent-veil" onClick={() => setOpen(false)} />}
    {open && <aside className="k-agent" role="dialog" aria-label="CIIN agent">
      <header><span className="k-agent-mark"><Icon name="agent" size={22} /></span><div><b>CIIN Agent</b><small>Six layers over grounded facts</small></div>
        <button className="k-agent-x" onClick={() => setOpen(false)} aria-label="Close">×</button></header>
      <div className="k-agent-body"><Layers profile={profile} role={role} /></div>
    </aside>}
  </>)
}
