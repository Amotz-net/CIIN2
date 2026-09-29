import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Chip, Empty, Source, Icon } from './kit.jsx'

// Clean-up visits: the dates both sides work from.
// The hub proposes arrival and finish; the property confirms or asks for
// another time. Every change emails the other side.

const STATE = {
  proposed: ['Awaiting the property', 'amber'], confirmed: ['Confirmed', 'green'], change_requested: ['Another time requested', 'red'],
  completed: ['Completed', 'teal'], cancelled: ['Cancelled', 'grey'],
}
const day = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const span = v => (day(v.arrives_at) === day(v.finishes_at) ? `${day(v.arrives_at)} · ${time(v.arrives_at)} to ${time(v.finishes_at)}`
  : `${day(v.arrives_at)} ${time(v.arrives_at)} to ${day(v.finishes_at)} ${time(v.finishes_at)}`)
const local = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const tell = (visit_id, event) => supabase.functions.invoke('visit-notify', { body: { visit_id, event } }).catch(() => {})
const upcoming = list => [...list].sort((a, b) => a.arrives_at.localeCompare(b.arrives_at))

function Row({ v, title, who, children }) {
  const [label, tone] = STATE[v.status]
  return (
    <div className={'k-visit tone-' + tone}>
      <div className="k-visit-d"><b>{new Date(v.arrives_at).getDate()}</b><span>{new Date(v.arrives_at).toLocaleDateString(undefined, { month: 'short' })}</span></div>
      <div className="k-visit-b">
        <div className="k-visit-t"><b>{title}</b><Chip tone={tone}>{label}</Chip></div>
        <span><Icon name="clock" size={14} />{span(v)}</span>
        <span><Icon name="truck" size={14} />{who}{v.crew ? ` · crew of ${v.crew}` : ''}{v.trucks ? ` · ${v.trucks} truck${v.trucks > 1 ? 's' : ''}` : ''}</span>
        {v.note && <span><Icon name="doc" size={14} />Hub: {v.note}</span>}
        {v.reply && <span><Icon name="building" size={14} />Property: {v.reply}</span>}
        {children && <div className="k-actions">{children}</div>}
      </div>
    </div>
  )
}

/* ---------- recovery hub: propose and manage dates ---------- */
export function HubSchedule({ d, mission, profile }) {
  const start = new Date(Date.now() + 24 * 3.6e6); start.setHours(7, 0, 0, 0)
  const end = new Date(start); end.setHours(15, 0, 0, 0)
  const [f, setF] = useState({ arrives: local(start), finishes: local(end), crew: '', trucks: '', note: '' })
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [edit, setEdit] = useState(null)
  const mine = upcoming(d.visits.filter(v => v.org_id === d.orgId && v.status !== 'cancelled'))
  const canSchedule = mission && (!mission.pool || mission.pool.accepted) && !['completed', 'rejected', 'proposed'].includes(mission.status)
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault(); setErr('')
    const a = new Date(f.arrives), b = new Date(f.finishes)
    if (!(b > a)) { setErr('The finish must be after the arrival.'); return }
    setBusy(true)
    const row = { arrives_at: a.toISOString(), finishes_at: b.toISOString(), crew: f.crew ? Number(f.crew) : null, trucks: f.trucks ? Number(f.trucks) : null, note: f.note.trim() || null }
    const res = edit
      ? await supabase.from('cleanup_visits').update(row).eq('id', edit).select('id').single()
      : await supabase.from('cleanup_visits').insert({ ...row, mission_id: mission.id, org_id: d.orgId, created_by: profile?.id ?? null }).select('id').single()
    if (res.error) setErr(res.error.message)
    else { await tell(res.data.id, edit ? 'changed' : 'proposed'); setEdit(null); await d.reload() }
    setBusy(false)
  }
  async function mark(v, status) {
    setBusy(true); setErr('')
    const { error } = await supabase.from('cleanup_visits').update({ status }).eq('id', v.id)
    if (error) setErr(error.message); else { await tell(v.id, status); await d.reload() }
    setBusy(false)
  }
  const begin = v => { setEdit(v.id); setF({ arrives: local(new Date(v.arrives_at)), finishes: local(new Date(v.finishes_at)), crew: v.crew ?? '', trucks: v.trucks ?? '', note: v.note ?? '' }) }

  return (
    <Panel title="Clean-up schedule" action={<span className="k-hint">The property sees these dates and is emailed each change</span>}>
      <div className="k-two">
        <div>
          {mine.length ? mine.map(v => { const m = d.missions.find(x => x.id === v.mission_id); return (
            <Row key={v.id} v={v} title={m?.title || 'Mission'} who={d.orgName(m?.org_id)}>
              {['proposed', 'confirmed', 'change_requested'].includes(v.status) && <>
                <button className="k-btn ghost sm" disabled={busy} onClick={() => begin(v)}>Change dates</button>
                {v.status === 'confirmed' && <button className="k-btn teal sm" disabled={busy} onClick={() => mark(v, 'completed')}>Mark completed</button>}
                <button className="k-btn ghost sm" disabled={busy} onClick={() => mark(v, 'cancelled')}>Cancel</button></>}
            </Row>) }) : <Empty>No clean-up dates sent yet.</Empty>}
        </div>
        <form onSubmit={save} className="k-sched">
          <b>{edit ? 'Change the dates' : mission ? `Send dates for ${mission.title}` : 'Select a mission on the board'}</b>
          <label>Arrival<input type="datetime-local" required value={f.arrives} onChange={set('arrives')} /></label>
          <label>Removal finished by<input type="datetime-local" required value={f.finishes} onChange={set('finishes')} /></label>
          <div className="k-pair"><label>Crew<input type="number" min="1" placeholder="people" value={f.crew} onChange={set('crew')} /></label>
            <label>Trucks<input type="number" min="0" placeholder="number" value={f.trucks} onChange={set('trucks')} /></label></div>
          <label>Note for the property<input placeholder="Gate, equipment, anything they should know" value={f.note} onChange={set('note')} /></label>
          <div className="k-pair"><button className="k-btn amber" disabled={busy || (!edit && !canSchedule)}>{edit ? 'Send new dates' : 'Send dates'}</button>
            {edit ? <button type="button" className="k-btn ghost" onClick={() => setEdit(null)}>Keep as is</button> : <span />}</div>
          {!edit && mission && !canSchedule && <Empty>{mission.pool && !mission.pool.accepted ? 'Accept the work order first.' : 'This mission cannot be scheduled yet.'}</Empty>}
          {err && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{err}</span>}
        </form>
      </div>
    </Panel>
  )
}

/* ---------- hotel: see the dates, confirm or ask for another time ---------- */
export function HotelSchedule({ d }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [asking, setAsking] = useState(null), [reply, setReply] = useState('')
  const ids = new Set(d.missions.map(m => m.id))
  const list = upcoming(d.visits.filter(v => ids.has(v.mission_id) && v.status !== 'cancelled'))

  async function answer(v, status, text) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('visit_respond', { p_visit: v.id, p_status: status, p_reply: text || null })
    if (error) setErr(error.message); else { await tell(v.id, status); setAsking(null); setReply(''); await d.reload() }
    setBusy(false)
  }

  return (
    <Panel title="Clean-up schedule" action={<span className="k-hint">Dates sent by the recovery hub</span>}>
      {list.length ? list.map(v => { const m = d.missions.find(x => x.id === v.mission_id), seg = d.beaches.find(b => b.id === m?.segment_id); return (
        <Row key={v.id} v={v} title={seg?.name || m?.title || 'Your frontage'} who={d.orgName(v.org_id)}>
          {['proposed', 'change_requested', 'confirmed'].includes(v.status) && asking !== v.id && <>
            {v.status !== 'confirmed' && <button className="k-btn amber sm" disabled={busy} onClick={() => answer(v, 'confirmed')}>Confirm dates</button>}
            <button className="k-btn ghost sm" disabled={busy} onClick={() => { setAsking(v.id); setReply(v.reply || '') }}>Ask for another time</button></>}
          {asking === v.id && <form className="k-form" style={{ width: '100%' }} onSubmit={e => { e.preventDefault(); answer(v, 'change_requested', reply) }}>
            <input required autoFocus placeholder="When would suit? e.g. after 10 am, guests at breakfast" value={reply} onChange={e => setReply(e.target.value)} />
            <button className="k-btn amber sm" disabled={busy}>Send</button></form>}
        </Row>) }) : <Empty>No clean-up dates have been sent for your frontage.</Empty>}
      {err && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{err}</span>}
      <Source>Confirming dates does not grant access. Access to your frontage is granted separately, under Priority action.</Source>
    </Panel>
  )
}

export const visitLabel = v => (v ? `${span(v)} · ${STATE[v.status][0].toLowerCase()}` : 'Not scheduled')
