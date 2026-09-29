import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Chip, Empty, Source, Icon, Facts, fmt } from './kit.jsx'
import { useNow, span } from './Live.jsx'

// Coordination on the beach: the landing report and its 48-hour clock, the
// removal record and its sign-off, site access, beach rules, and the sample
// handed to the laboratory. Each action tells the other parties.

const HOURS = 48
const day = t => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const local = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
export const tell = (event, id) => supabase.functions.invoke('notify', { body: { event, id } }).catch(() => {})
const Err = ({ children }) => (children ? <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6 }}>{children}</div> : null)

// Photographs are filed under the organisation that took them.
async function upload(orgId, kind, file) {
  if (!file) return null
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${orgId}/${kind}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type || 'image/jpeg' })
  if (error) throw new Error('The photograph could not be saved: ' + error.message)
  return path
}
export function Photo({ path, label }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let on = true
    if (path) supabase.storage.from('evidence').createSignedUrl(path, 3600).then(({ data }) => on && setUrl(data?.signedUrl ?? null))
    return () => { on = false } }, [path])
  if (!path) return null
  return url ? <a className="k-photo" href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} /><span>{label}</span></a>
    : <span className="k-photo wait">{label}</span>
}

/* ------------------------------------------------------------------ */
/* 1. The landing and its clock                                        */
/* ------------------------------------------------------------------ */
export function clockOf(l, now = Date.now()) {
  const gone = (now - new Date(l.landed_at)) / 3.6e6, left = HOURS - gone
  return { gone, left, overdue: left <= 0, tone: left <= 0 ? 'red' : left <= 12 ? 'amber' : 'teal',
    label: left <= 0 ? `Overdue by ${span(-left * 3.6e6)}` : `${span(left * 3.6e6)} left`, pct: Math.min(100, (gone / HOURS) * 100) }
}
export const activeLandings = d => d.landings.filter(l => !l.cleared_at).sort((a, b) => a.landed_at.localeCompare(b.landed_at))

export function LandingClock({ d, title = '48-hour clock' }) {
  const now = useNow()
  const list = activeLandings(d)
  return (
    <Panel title={title} action={<span className="k-hint">From landing to signed-off removal</span>}>
      {list.length ? list.map(l => { const c = clockOf(l, now), seg = d.segments.find(s => s.id === l.segment_id); return (
        <div key={l.id} className={'k-clock tone-' + c.tone}>
          <div className="k-clock-h"><b>{seg?.name || 'Beach'}</b><span className={'k-clock-t' + (c.overdue ? ' over' : '')}>{c.label}</span></div>
          <div className="k-prog"><i style={{ width: c.pct + '%', background: 'var(--t)' }} /></div>
          <span>Landed {day(l.landed_at)} · {l.extent} · reported by {d.orgName(l.org_id)}</span>
          {l.note && <span>“{l.note}”</span>}
          <Photo path={l.photo} label="Photograph at landing" />
        </div>) }) : <Empty>No landing is waiting to be cleared.</Empty>}
      <Source>After about two days on the beach sargassum rots, releases hydrogen sulphide and loses its value. The clock stops when the property signs off a removal.</Source>
    </Panel>
  )
}

export function ReportLanding({ d, profile }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [done, setDone] = useState('')
  const [f, setF] = useState({ segment: '', landed: local(new Date()), extent: 'moderate', note: '', file: null })
  const beaches = d.segments
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function save(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const photo = await upload(d.orgId, 'landing', f.file)
      const { data, error } = await supabase.rpc('report_landing', { p_segment: f.segment || beaches[0]?.id, p_landed_at: new Date(f.landed).toISOString(),
        p_extent: f.extent, p_note: f.note || null, p_photo: photo })
      if (error) throw new Error(error.message)
      await tell('landing', data.report)
      setDone(data.mission_raised ? 'Reported. A mission has been raised and the recovery hubs have been told.' : 'Reported. The hubs on the open mission have been told.')
      setOpen(false); await d.reload()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  if (!beaches.length) return null
  return (
    <Panel title="Report a landing">
      {!open ? <>
        <button className="k-btn amber wide" style={{ marginTop: 0 }} onClick={() => { setOpen(true); setDone('') }}>Sargassum has landed</button>
        {done && <Empty><span style={{ color: 'var(--green)' }}>{done}</span></Empty>}
        <Source>The satellite sees sargassum offshore, not on your beach. Your report is what tells the hubs it has arrived and starts the 48-hour clock.</Source>
      </> : <form onSubmit={save} className="k-sched">
        <label>Beach<select value={f.segment || beaches[0].id} onChange={set('segment')}>{beaches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>When it landed<input type="datetime-local" required max={local(new Date())} value={f.landed} onChange={set('landed')} /></label>
        <label>How much<select value={f.extent} onChange={set('extent')}>
          <option value="light">Light: scattered, beach usable</option><option value="moderate">Moderate: a continuous line</option><option value="heavy">Heavy: piled, beach unusable</option></select></label>
        <label>Photograph<input type="file" accept="image/*" onChange={e => setF(x => ({ ...x, file: e.target.files?.[0] ?? null }))} /></label>
        <label>Note<input placeholder="Where on the beach, smell, anything the hub should know" value={f.note} onChange={set('note')} /></label>
        <div className="k-pair"><button className="k-btn amber" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
          <button type="button" className="k-btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        <Err>{err}</Err>
      </form>}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Removal record and sign-off                                      */
/* ------------------------------------------------------------------ */
const R_STATE = { recorded: ['Awaiting sign-off', 'amber'], signed: ['Signed off', 'green'], disputed: ['Disputed', 'red'] }
const destination = (d, r) => (r.destination_org ? d.orgName(r.destination_org) : r.destination_text || 'Not stated')

export function RemovalForm({ d, mission, profile }) {
  const [f, setF] = useState({ removed: local(new Date()), tonnes: '', basis: 'estimated', dest: '', destText: '', note: '', before: null, after: null })
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [ok, setOk] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const processors = d.orgs.filter(o => o.role === 'processor')
  const can = mission && (!mission.pool || mission.pool.accepted) && ['access_granted', 'in_progress', 'completed', 'raised', 'authority_approved'].includes(mission.status)
    && ['granted', 'granted_conditions'].includes(mission.access_state)
  async function save(e) {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true)
    try {
      const [photo_before, photo_after] = [await upload(d.orgId, 'removal', f.before), await upload(d.orgId, 'removal', f.after)]
      const visit = d.visits.find(v => v.mission_id === mission.id && ['confirmed', 'completed'].includes(v.status))
      const { data, error } = await supabase.from('removals').insert({ mission_id: mission.id, visit_id: visit?.id ?? null, org_id: d.orgId,
        removed_at: new Date(f.removed).toISOString(), tonnes: Number(f.tonnes), tonnes_basis: f.basis, destination_org: f.dest && f.dest !== 'other' ? f.dest : null,
        destination_text: f.dest === 'other' || !f.dest ? f.destText.trim() || null : null, photo_before, photo_after, note: f.note.trim() || null, created_by: profile?.id ?? null })
        .select('id').single()
      if (error) throw new Error(error.message)
      await tell('removal_recorded', data.id)
      setOk('Recorded. The property has been asked to sign it off.'); setF(x => ({ ...x, tonnes: '', note: '', before: null, after: null })); await d.reload()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <form onSubmit={save} className="k-sched">
      <b>{mission ? `Record a removal: ${mission.title}` : 'Select a mission on the board'}</b>
      <div className="k-pair"><label>Removed at<input type="datetime-local" required max={local(new Date())} value={f.removed} onChange={set('removed')} /></label>
        <label>Tonnes<input type="number" required min="0" step="0.1" placeholder="wet tonnes" value={f.tonnes} onChange={set('tonnes')} /></label></div>
      <div className="k-pair"><label>How it was measured<select value={f.basis} onChange={set('basis')}><option value="estimated">Estimated</option><option value="weighed">Weighed</option></select></label>
        <label>Taken to<select value={f.dest} onChange={set('dest')}><option value="">Choose…</option>{processors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="other">Somewhere else</option></select></label></div>
      {(f.dest === 'other') && <label>Where<input required placeholder="Name of the site" value={f.destText} onChange={set('destText')} /></label>}
      <div className="k-pair"><label>Photograph before<input type="file" accept="image/*" onChange={e => setF(x => ({ ...x, before: e.target.files?.[0] ?? null }))} /></label>
        <label>Photograph after<input type="file" accept="image/*" onChange={e => setF(x => ({ ...x, after: e.target.files?.[0] ?? null }))} /></label></div>
      <label>Note<input placeholder="Anything the property should know" value={f.note} onChange={set('note')} /></label>
      <button className="k-btn amber" disabled={busy || !can || !f.dest}>{busy ? 'Saving…' : 'Record removal'}</button>
      {mission && !can && <Empty>A removal can be recorded once you have accepted the mission and the property has granted access.</Empty>}
      {ok && <Empty><span style={{ color: 'var(--green)' }}>{ok}</span></Empty>}
      <Err>{err}</Err>
    </form>
  )
}

export function RemovalList({ d, mode = 'view', limit = 6 }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [asking, setAsking] = useState(null), [why, setWhy] = useState('')
  const list = [...d.removals].sort((a, b) => b.removed_at.localeCompare(a.removed_at)).slice(0, limit)
  async function sign(r, agree, note) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('removal_sign', { p_removal: r.id, p_agree: agree, p_note: note || null })
    if (error) setErr(error.message); else { await tell(agree ? 'removal_signed' : 'removal_disputed', r.id); setAsking(null); setWhy(''); await d.reload() }
    setBusy(false)
  }
  if (!list.length) return <Empty>No removal has been recorded.</Empty>
  return (<>
    {list.map(r => { const m = d.missions.find(x => x.id === r.mission_id), seg = d.segments.find(s => s.id === m?.segment_id), [label, tone] = R_STATE[r.status]; return (
      <div key={r.id} className={'k-visit tone-' + tone}>
        <div className="k-visit-d"><b>{fmt(r.tonnes)}</b><span>tonnes</span></div>
        <div className="k-visit-b">
          <div className="k-visit-t"><b>{seg?.name || m?.title || 'Removal'}</b><Chip tone={tone}>{label}</Chip></div>
          <span><Icon name="clock" size={14} />{day(r.removed_at)} · {r.tonnes_basis}</span>
          <span><Icon name="truck" size={14} />{d.orgName(r.org_id)} → {destination(d, r)}</span>
          {r.note && <span><Icon name="doc" size={14} />Hub: {r.note}</span>}
          {r.sign_note && <span><Icon name="building" size={14} />Property: {r.sign_note}</span>}
          <div className="k-photos"><Photo path={r.photo_before} label="Before" /><Photo path={r.photo_after} label="After" /></div>
          {mode === 'sign' && r.status === 'recorded' && asking !== r.id && <div className="k-actions">
            <button className="k-btn amber sm" disabled={busy} onClick={() => sign(r, true)}>Sign off</button>
            <button className="k-btn ghost sm" disabled={busy} onClick={() => setAsking(r.id)}>This is not right</button></div>}
          {asking === r.id && <form className="k-form" onSubmit={e => { e.preventDefault(); sign(r, false, why) }}>
            <input required autoFocus placeholder="What is wrong with the record?" value={why} onChange={e => setWhy(e.target.value)} />
            <button className="k-btn amber sm" disabled={busy}>Send</button></form>}
        </div>
      </div>) })}
    <Err>{err}</Err>
  </>)
}

/* ------------------------------------------------------------------ */
/* 4. Site access and beach rules                                      */
/* ------------------------------------------------------------------ */
export function SiteAccessEdit({ d }) {
  const [pid, setPid] = useState(null), [f, setF] = useState(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const p = d.properties.find(x => x.id === pid) || d.properties[0]
  useEffect(() => { if (p) setF({ access_gate: p.access_gate || '', access_hours: p.access_hours || '', contact_name: p.contact_name || '', contact_phone: p.contact_phone || '', access_notes: p.access_notes || '' }) }, [p?.id])
  if (!p || !f) return <Panel title="Site access"><Empty>Add a property to record how a crew gets on site.</Empty></Panel>
  const set = k => e => { setMsg(''); setF(x => ({ ...x, [k]: e.target.value })) }
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    const { error } = await supabase.from('properties').update(row).eq('id', p.id)
    if (error) setErr(error.message); else { setMsg('Saved.'); await d.reload() }
    setBusy(false)
  }
  return (
    <Panel title="Site access" action={d.properties.length > 1 && <select className="k-select" value={p.id} onChange={e => setPid(e.target.value)}>
      {d.properties.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}>
      <form onSubmit={save} className="k-sched" style={{ background: 'transparent', border: 0, padding: 0 }}>
        <label>Gate or entrance<input placeholder="Main service gate, south" value={f.access_gate} onChange={set('access_gate')} /></label>
        <label>Permitted working hours<input placeholder="6:00 am to 6:00 pm" value={f.access_hours} onChange={set('access_hours')} /></label>
        <div className="k-pair"><label>Contact on site<input placeholder="Name" value={f.contact_name} onChange={set('contact_name')} /></label>
          <label>Phone<input type="tel" placeholder="+1 876 …" value={f.contact_phone} onChange={set('contact_phone')} /></label></div>
        <label>Anything else<input placeholder="Guests at breakfast until 10, no vehicles on the lawn" value={f.access_notes} onChange={set('access_notes')} /></label>
        <button className="k-btn teal" disabled={busy}>Save access details</button>
        {msg && <span style={{ color: 'var(--green)', fontSize: 12.5 }}>{msg}</span>}<Err>{err}</Err>
      </form>
      <Source>Shown only to a recovery hub that has accepted a mission on this property.</Source>
    </Panel>
  )
}

export function SiteAccessView({ mission }) {
  const [a, setA] = useState(undefined)
  useEffect(() => { let on = true; setA(undefined)
    if (mission?.id) supabase.rpc('site_access', { p_mission: mission.id }).then(({ data }) => on && setA(data?.[0] ?? null))
    return () => { on = false } }, [mission?.id, mission?.pool?.accepted])
  if (!mission) return null
  if (a === undefined) return <Empty>Loading site access…</Empty>
  if (!a) return <Empty>Site access details appear once you have accepted the mission.</Empty>
  const has = a.access_gate || a.access_hours || a.contact_name || a.contact_phone || a.access_notes
  return has ? <Facts rows={[a.access_gate && ['pin', 'Gate', a.access_gate], a.access_hours && ['clock', 'Working hours', a.access_hours],
    a.contact_name && ['users', 'Contact', a.contact_name], a.contact_phone && ['bell', 'Phone', a.contact_phone], a.access_notes && ['doc', 'Note', a.access_notes]]} />
    : <Empty>{a.property_name} has not recorded how to get on site.</Empty>
}

const RULE_KIND = { turtle_nesting: 'Turtle nesting', machinery: 'Machinery', hours: 'Working hours', protected_area: 'Protected area', other: 'Other' }
const inForce = (r, at = new Date()) => r.active && (!r.from_date || new Date(r.from_date) <= at) && (!r.to_date || new Date(r.to_date + 'T23:59:59') >= at)
export const rulesFor = (d, mission) => d.rules.filter(r => inForce(r) && (!r.segment_id || r.segment_id === mission?.segment_id))

export function RulesNotice({ d, mission }) {
  const list = rulesFor(d, mission)
  if (!list.length) return null
  return <div className="k-rules">{list.map(r => <div key={r.id}><Icon name="shield" size={16} /><span><b>{RULE_KIND[r.kind]}</b>{r.rule}
    {(r.from_date || r.to_date) && <small> · {r.from_date || 'now'} to {r.to_date || 'until lifted'}</small>}</span></div>)}</div>
}

export function BeachRules({ d, profile }) {
  const [f, setF] = useState({ segment: '', kind: 'turtle_nesting', rule: '', from: '', to: '' }), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  async function add(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.from('beach_rules').insert({ country_code: d.code, segment_id: f.segment || null, kind: f.kind, rule: f.rule.trim(),
      from_date: f.from || null, to_date: f.to || null, created_by: profile?.id ?? null })
    if (error) setErr(error.message); else { setF(x => ({ ...x, rule: '' })); await d.reload() }
    setBusy(false)
  }
  async function lift(r) { setBusy(true); await supabase.from('beach_rules').update({ active: false }).eq('id', r.id); await d.reload(); setBusy(false) }
  const live = d.rules.filter(r => r.active)
  return (
    <Panel title="Beach rules" action={<span className="k-hint">A hub must read these before it sends dates</span>}>
      <div className="k-two">
        <div>{live.length ? live.map(r => <div key={r.id} className="k-gate"><Icon name="shield" size={18} />
          <span><b>{RULE_KIND[r.kind]}</b> · {r.segment_id ? d.segments.find(s => s.id === r.segment_id)?.name || 'one beach' : `all of ${d.country}`}<br />
            <span style={{ color: 'var(--mute)', fontSize: 12 }}>{r.rule}{(r.from_date || r.to_date) ? ` · ${r.from_date || 'now'} to ${r.to_date || 'until lifted'}` : ''}</span></span>
          <button className="k-btn ghost sm" disabled={busy} onClick={() => lift(r)}>Lift</button></div>) : <Empty>No rule is in force.</Empty>}</div>
        <form onSubmit={add} className="k-sched">
          <b>Add a rule</b>
          <div className="k-pair"><label>Applies to<select value={f.segment} onChange={set('segment')}><option value="">All beaches in {d.country}</option>
            {d.segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>About<select value={f.kind} onChange={set('kind')}>{Object.entries(RULE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
          <label>The rule<input required placeholder="No machinery on the sand between sunset and sunrise" value={f.rule} onChange={set('rule')} /></label>
          <div className="k-pair"><label>From<input type="date" value={f.from} onChange={set('from')} /></label><label>Until<input type="date" value={f.to} onChange={set('to')} /></label></div>
          <button className="k-btn teal" disabled={busy}>Add rule</button><Err>{err}</Err>
        </form>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Samples                                                          */
/* ------------------------------------------------------------------ */
const S_STATE = { sent: ['On its way', 'amber'], received: ['At the laboratory', 'teal'], resulted: ['Result returned', 'green'] }

export function SampleSend({ d, profile }) {
  const labs = d.orgs.filter(o => o.role === 'university_lab')
  const waiting = d.batches.filter(b => !b.confirmed && b.org_id === d.orgId && !d.samples.some(s => s.batch_id === b.id))
  const [f, setF] = useState({ batch: '', lab: '', taken: local(new Date()), note: '' }), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const mine = d.samples.filter(s => s.org_id === d.orgId)
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const b = d.batches.find(x => x.id === (f.batch || waiting[0]?.id))
    const { data, error } = await supabase.from('samples').insert({ sample_ref: `S-${b.batch_ref}`, batch_id: b.id, mission_id: b.mission_id, org_id: d.orgId,
      lab_org_id: f.lab || labs[0].id, taken_at: new Date(f.taken).toISOString(), note: f.note.trim() || null, created_by: profile?.id ?? null }).select('id').single()
    if (error) setErr(error.message); else { await tell('sample_sent', data.id); setF(x => ({ ...x, batch: '', note: '' })); await d.reload() }
    setBusy(false)
  }
  return (
    <Panel title="Samples to the laboratory">
      {mine.slice(0, 4).map(s => <div key={s.id} className="k-gate"><Icon name="flask" size={18} /><span>{s.sample_ref}<br /><span style={{ color: 'var(--mute)', fontSize: 11.5 }}>{d.orgName(s.lab_org_id)}
        {s.status === 'resulted' ? ` · ${s.arsenic_inorganic} mg/kg` : ''}</span></span><Chip tone={S_STATE[s.status][1]}>{S_STATE[s.status][0]}</Chip></div>)}
      {waiting.length && labs.length ? <form onSubmit={save} className="k-sched" style={{ marginTop: 8 }}>
        <label>Batch<select value={f.batch || waiting[0].id} onChange={set('batch')}>{waiting.map(b => <option key={b.id} value={b.id}>{b.batch_ref} · {fmt(b.wet_mass_t)} t</option>)}</select></label>
        <label>Laboratory<select value={f.lab || labs[0].id} onChange={set('lab')}>{labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Sample taken<input type="datetime-local" required max={local(new Date())} value={f.taken} onChange={set('taken')} /></label>
        <label>Note<input placeholder="Courier, seal number" value={f.note} onChange={set('note')} /></label>
        <button className="k-btn teal" disabled={busy}>Send sample</button><Err>{err}</Err>
      </form> : <Empty>{!labs.length ? 'No laboratory has joined in this country.' : 'Every batch has a sample sent or a result.'}</Empty>}
    </Panel>
  )
}

export function SampleInbox({ d }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [val, setVal] = useState({})
  const list = d.samples.filter(s => s.lab_org_id === d.orgId).sort((a, b) => a.sent_at.localeCompare(b.sent_at))
  const run = async (fn, event, id) => { setBusy(true); setErr(''); const { error } = await fn(); if (error) setErr(error.message); else { await tell(event, id); await d.reload() } setBusy(false) }
  return (
    <Panel title="Incoming samples" action={<span className="k-hint">{list.filter(s => s.status !== 'resulted').length} waiting</span>}>
      {list.length ? <table className="k-table"><thead><tr><th>Sample</th><th>From</th><th>Sent</th><th>Status</th><th /></tr></thead><tbody>
        {list.map(s => <tr key={s.id}><td><b>{s.sample_ref}</b>{s.note && <div style={{ color: 'var(--mute)', fontSize: 11.5 }}>{s.note}</div>}</td><td>{d.orgName(s.org_id)}</td><td>{day(s.sent_at)}</td>
          <td><Chip tone={S_STATE[s.status][1]}>{S_STATE[s.status][0]}</Chip></td>
          <td>{s.status === 'sent' && <button className="k-btn ghost sm" disabled={busy} onClick={() => run(() => supabase.rpc('sample_receive', { p_sample: s.id }), 'sample_received', s.id)}>Record as received</button>}
            {s.status === 'received' && <form className="k-form" style={{ marginTop: 0, gridTemplateColumns: '120px auto' }} onSubmit={e => { e.preventDefault()
              run(() => supabase.rpc('sample_result', { p_sample: s.id, p_inorganic: Number(val[s.id]) }), 'sample_resulted', s.id) }}>
              <input type="number" required min="0" step="0.01" placeholder="mg/kg" value={val[s.id] ?? ''} onChange={e => setVal(v => ({ ...v, [s.id]: e.target.value }))} />
              <button className="k-btn amber sm" disabled={busy}>Return result</button></form>}
            {s.status === 'resulted' && <span>{s.arsenic_inorganic} mg/kg</span>}</td></tr>)}
      </tbody></table> : <Empty>No sample has been sent to this laboratory.</Empty>}
      <Err>{err}</Err>
      <Source>Enter the measured inorganic arsenic (EN 16802). The laboratory measures; the rules then re-grade the sender's batch.</Source>
    </Panel>
  )
}
