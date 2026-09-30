import { useMemo } from 'react'
import { Panel, Chip, Empty, Source, Spark, Steps, Icon, fmt } from './kit.jsx'
import { useConsole } from './useConsole.js'
import { BeachRules, RemovalList } from './Coordination.jsx'
import { PROGRAMME, GATES } from './program.js'

// Evidence and reports: what has been recovered, the removal record, the
// beach list and the rules in force. Nothing here needs a decision today.
export function GovReports({ profile, admin = false }) {
  const d = useConsole(profile, { scope: 'all', feeds: false, regional: false, catalogue: true })
  const recovered = useMemo(() => { let sum = 0
    return [...d.removals].filter(r => r.status === 'signed').sort((a, b) => a.removed_at.localeCompare(b.removed_at)).map(r => ({ v: (sum += Number(r.tonnes || 0)) })) }, [d.removals])
  const total = recovered.length ? recovered[recovered.length - 1].v : 0
  const parishes = useMemo(() => Object.values(d.listed.reduce((a, b) => { const k = b.parish || 'Unknown'
    a[k] = a[k] || { parish: k, n: 0, licensed: 0, located: 0 }; a[k].n++; if (b.licensed) a[k].licensed++; if (b.lat != null) a[k].located++; return a }, {}))
    .sort((x, y) => y.n - x.n), [d.listed])
  return (
    <div className="k-console">
      <div className="k-two">
        <Panel title="Recovered and signed off" note={`${fmt(total)} t · ${d.removals.filter(r => r.status === 'signed').length} removals`}>
          <Spark rows={recovered} color="var(--green)" height={150} x0="first" x1="latest" />
          <Source>Cumulative wet tonnes removed and signed off by the property. Recorded by the hub, agreed by the property; not weighed by CIIN.</Source>
        </Panel>
        <Panel title="Removal record" action={<span className="k-hint">What was taken, by whom, and where it went</span>}><RemovalList d={d} limit={8} /></Panel>
      </div>
      <BeachRules d={d} profile={profile} />
      <Panel title="Listed beaches by parish" action={<span className="k-hint">{d.listed.length} beaches · {d.listed.filter(b => b.lat == null).length} not yet located</span>}>
        {parishes.length ? <table className="k-table"><thead><tr><th>Parish</th><th>Beaches</th><th>Licensed</th><th>On the map</th></tr></thead><tbody>
          {parishes.map(p => <tr key={p.parish}><td>{p.parish}</td><td>{p.n}</td><td>{p.licensed}</td><td>{p.located} of {p.n}</td></tr>)}
        </tbody></table> : <Empty>No beach list is loaded for this country yet.</Empty>}
        <Source>NEPA Jamaica Beach Guide. Where OpenStreetMap has a beach of the same name, that is the position; otherwise the shore nearest the place that carries its name.</Source>
      </Panel>
      {admin && <div className="k-two">
        <Panel title="Human approval gates">
          {GATES.map(g => <div key={g.name} className="k-gate"><Icon name={g.icon} size={19} /><span>{g.name}</span><Chip tone={g.tone} solid>{g.rule}</Chip><small>{g.covers}</small></div>)}
        </Panel>
        <Panel title="Programme milestones"><Steps steps={PROGRAMME} /></Panel>
      </div>}
    </div>
  )
}
