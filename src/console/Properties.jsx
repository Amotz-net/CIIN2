import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Chip, Empty, Source, Icon, Kpi } from './kit.jsx'
import { useConsole } from './useConsole.js'

// An owner's properties. One owner may hold several hotels in several places;
// each has its own frontage and can have its own manager, who sees that
// property and nothing else.
export function Properties({ profile }) {
  const d = useConsole(profile, { scope: 'org', feeds: false, regional: false, catalogue: true })
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [note, setNote] = useState('')
  const [email, setEmail] = useState(''), [forProp, setForProp] = useState(''), [link, setLink] = useState('')
  const [people, setPeople] = useState(null)
  const isAdmin = profile?.level === 'org_admin' || profile?.is_platform_admin
  const taken = new Set(d.properties.map(p => p.hotel_id).filter(Boolean))
  const found = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t.length < 2 ? [] : d.hotelList.filter(h => h.name.toLowerCase().includes(t) && !taken.has(h.id)).slice(0, 12)
  }, [q, d.hotelList, d.properties])

  if (people === null && d.orgId) {
    setPeople([])
    supabase.from('profiles').select('id, full_name, level, property_id').eq('org_id', d.orgId).then(({ data }) => setPeople(data ?? []))
  }

  async function add(h) {
    setBusy(true); setErr(''); setNote('')
    const { data: p, error } = await supabase.from('properties')
      .insert({ org_id: d.orgId, hotel_id: h?.id ?? null, name: h ? h.name : q.trim(), country_code: d.code, lat: h?.lat ?? null, lng: h?.lng ?? null })
      .select('id, name').single()
    if (error) { setErr(error.message); setBusy(false); return }
    if (h) {
      // The frontage CIIN will watch. It starts as the hotel's position; the
      // satellite is read 20 to 40 km offshore of it.
      const { error: e2 } = await supabase.from('beach_segments')
        .insert({ org_id: d.orgId, property_id: p.id, name: `${h.name} — frontage`, lat: h.lat, lng: h.lng, length_m: 200 })
      if (e2) setErr('Property added, but its frontage could not be created: ' + e2.message)
      // Ten years of satellite history for the new frontage. Takes a few minutes.
      else { supabase.functions.invoke('baseline', { body: {} }); setNote(`${p.name} added. Its ten-year baseline is being computed; the alert level appears once that finishes.`) }
    } else setNote(`${p.name} added without a position, so CIIN cannot watch its frontage yet.`)
    setQ(''); await d.reload(); setBusy(false)
  }

  async function invite(e) {
    e.preventDefault(); setErr(''); setLink('')
    const { data, error } = await supabase.from('invitations')
      .insert({ email, org_id: d.orgId, level: 'member', invited_by: profile.id, property_id: forProp || null }).select('token').single()
    if (error) { setErr(error.message); return }
    setLink(`${window.location.origin}/accept?token=${data.token}`); setEmail('')
  }

  return (
    <div className="k-console">
      <div className="k-kpis">
        <Kpi icon="building" label="Properties" value={d.properties.length} sub={`${d.country}`} />
        <Kpi icon="waves" label="Beach frontages" value={d.segments.length} sub="watched by satellite" tone="green" />
        <Kpi icon="users" label="Property managers" value={(people ?? []).filter(p => p.property_id).length} sub="each sees one property" />
        <Kpi icon="db" label="Hotels on the list" value={d.hotelList.length} sub={`${d.country}, from OpenStreetMap`} />
      </div>
      <div className="k-two">
        <Panel title="Your properties">
          {d.properties.length ? <table className="k-table"><thead><tr><th>Property</th><th>Frontages</th><th>Managers</th></tr></thead><tbody>
            {d.properties.map(p => <tr key={p.id}><td><span className="k-cellic"><Icon name="building" size={17} />{p.name}</span></td>
              <td>{d.segments.filter(s => s.property_id === p.id).map(s => s.name).join(', ') || <Chip tone="amber">none yet</Chip>}</td>
              <td>{(people ?? []).filter(x => x.property_id === p.id).map(x => x.full_name).join(', ') || '—'}</td></tr>)}
          </tbody></table> : <Empty>{d.loading ? 'Loading…' : 'No property on record yet.'}</Empty>}
        </Panel>
        {isAdmin ? <Panel title="Add a property">
          <div className="k-form" style={{ gridTemplateColumns: '1fr' }}><input placeholder="Search the hotel list by name…" value={q} onChange={e => setQ(e.target.value)} /></div>
          {found.length > 0 && <div className="k-pick">{found.map(h => <button key={h.id} disabled={busy} onClick={() => add(h)}>
            <span>{h.name}</span><small>{[h.place, h.kind?.replace('_', ' ')].filter(Boolean).join(' · ')}</small></button>)}</div>}
          {q.trim().length >= 2 && !found.length && <Empty>Not on the list. <a className="k-link" onClick={() => !busy && add(null)}>Add “{q.trim()}” anyway</a>, without a position.</Empty>}
          {note && <Empty><span style={{ color: 'var(--green)' }}>{note}</span></Empty>}
          <Source>The hotel list is from OpenStreetMap contributors (ODbL). A property not on it can still be added by name.</Source>
        </Panel> : <Panel title="Your access"><Empty>You manage one property. Adding properties and inviting managers is done by your organisation's administrator.</Empty></Panel>}
      </div>
      {isAdmin && <Panel title="Invite a property manager">
        <form onSubmit={invite} className="k-form" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) auto' }}>
          <input type="email" required placeholder="manager@hotel.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select value={forProp} onChange={e => setForProp(e.target.value)}>
            <option value="">All properties (owner's team)</option>
            {d.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className="k-btn teal">Create invitation</button>
        </form>
        {link && <div className="k-link-out">Send this link to the manager: {link}</div>}
        <Source>A manager invited to one property sees that property's beaches, alerts and missions, and nothing from your other properties.</Source>
      </Panel>}
      {err && <Panel><span style={{ color: 'var(--red)' }}>{err}</span></Panel>}
    </div>
  )
}
