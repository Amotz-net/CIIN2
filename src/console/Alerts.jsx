import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Chip, Empty, Source, Icon, Kpi } from './kit.jsx'

// Notifications: how this person is reached, and what they have been sent.
// The phone number and choices are readable by that person only.

const LEVEL = { urgent: ['Urgent', 'red'], action: ['Action needed', 'amber'], info: ['For information', 'grey'] }
const STATUS = { sent: ['Sent', 'green'], held: ['In the next summary', 'grey'], summarised: ['In a summary', 'teal'], failed: ['Not delivered', 'red'],
  not_configured: ['Channel not set up', 'amber'], queued: ['Queued', 'grey'] }
const CHANNEL = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', summary: 'Daily summary' }
const when = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function Alerts({ profile, onNavigate, actOn }) {
  const [p, setP] = useState(null), [list, setList] = useState(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('alert_prefs').select('*').eq('profile_id', profile.id).maybeSingle()
      .then(({ data }) => setP({ phone: data?.phone || '', sms: !!data?.sms, whatsapp: !!data?.whatsapp, summary: data ? data.summary : true }))
    supabase.from('alerts').select('id, subject, body, level, channel, status, detail, created_at').eq('profile_id', profile.id)
      .order('created_at', { ascending: false }).limit(60).then(({ data }) => setList(data ?? []))
  }, [profile?.id])

  async function save(e) {
    e.preventDefault(); setErr(''); setMsg('')
    const phone = p.phone.replace(/[\s()-]/g, '')
    if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) { setErr('Enter the number in international form, starting with + and the country code. For Jamaica: +1876…'); return }
    if ((p.sms || p.whatsapp) && !phone) { setErr('Add a phone number to receive SMS or WhatsApp.'); return }
    setBusy(true)
    const { error } = await supabase.from('alert_prefs').upsert({ profile_id: profile.id, phone: phone || null, sms: p.sms, whatsapp: p.whatsapp, summary: p.summary, updated_at: new Date().toISOString() })
    if (error) setErr(error.message); else { setMsg('Saved.'); setP(x => ({ ...x, phone })) }
    setBusy(false)
  }
  const set = (k, v) => { setMsg(''); setP(x => ({ ...x, [k]: v })) }
  const recent = list ?? [], week = recent.filter(a => Date.now() - new Date(a.created_at) < 7 * 86400000)

  return (
    <div className="k-console">
      <div className="k-kpis">
        <Kpi icon="bell" label="Alerts this week" value={week.length} sub="sent to you" />
        <Kpi icon="alert" label="Urgent" value={week.filter(a => a.level === 'urgent').length} tone="red" sub="severe level, landing, overdue" />
        <Kpi icon="doc" label="Held for the summary" value={recent.filter(a => a.status === 'held').length} tone="grey" sub="sent together each morning" />
        <Kpi icon="users" label="Second channel" value={p?.sms || p?.whatsapp ? [p.sms && 'SMS', p.whatsapp && 'WhatsApp'].filter(Boolean).join(' + ') : 'Off'}
             tone={p?.sms || p?.whatsapp ? 'green' : 'amber'} sub="for urgent alerts only" />
      </div>
      <div className="k-body" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
        <div className="k-main">
          <Panel title="What you have been sent" action={actOn && <a className="k-link" onClick={() => onNavigate(actOn)}>Go to what is waiting on you ›</a>}>
            {list === null ? <Empty>Loading…</Empty> : recent.length ? recent.map(a => { const [ll, lt] = LEVEL[a.level] || LEVEL.action, [sl, st] = STATUS[a.status] || [a.status, 'grey']; return (
              <div key={a.id} className="k-alertrow" onClick={() => setOpen(open === a.id ? null : a.id)}>
                <div className="k-visit-t"><b>{a.subject}</b><span style={{ display: 'flex', gap: 6 }}><Chip tone={lt}>{ll}</Chip><Chip tone={st}>{sl}</Chip></span></div>
                <span>{when(a.created_at)} · {CHANNEL[a.channel] || a.channel}{a.status === 'failed' && a.detail ? ` · ${a.detail}` : ''}</span>
                {open === a.id && <pre>{a.body}</pre>}
              </div>) }) : <Empty>Nothing has been sent to you yet.</Empty>}
          </Panel>
        </div>
        <aside className="k-rail">
          <Panel title="How to reach you">
            {p ? <form onSubmit={save} className="k-sched" style={{ background: 'transparent', border: 0, padding: 0 }}>
              <label>Mobile number<input type="tel" placeholder="+18765550123" value={p.phone} onChange={e => set('phone', e.target.value)} /></label>
              <label className="k-check"><input type="checkbox" checked={p.sms} onChange={e => set('sms', e.target.checked)} />Send urgent alerts by SMS</label>
              <label className="k-check"><input type="checkbox" checked={p.whatsapp} onChange={e => set('whatsapp', e.target.checked)} />Send urgent alerts by WhatsApp</label>
              <label className="k-check"><input type="checkbox" checked={p.summary} onChange={e => set('summary', e.target.checked)} />Send me a daily summary</label>
              <button className="k-btn teal" disabled={busy}>Save</button>
              {msg && <span style={{ color: 'var(--green)', fontSize: 12.5 }}>{msg}</span>}
              {err && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{err}</span>}
            </form> : <Empty>Loading…</Empty>}
            <Source>Your number is visible to you only. Email always goes to the address you sign in with.</Source>
          </Panel>
          <Panel title="What each level means">
            <div className="k-gate"><Icon name="alert" size={18} /><span><b>Urgent</b><br /><span className="k-sub">A severe offshore level, a landing, or a beach not cleared in time. Email at once, plus SMS or WhatsApp if you have turned them on.</span></span></div>
            <div className="k-gate"><Icon name="doc" size={18} /><span><b>Action needed</b><br /><span className="k-sub">Something is waiting on you. Email at once.</span></span></div>
            <div className="k-gate"><Icon name="clock" size={18} /><span><b>For information</b><br /><span className="k-sub">Nothing to do. Kept for the daily summary at 6 am Jamaica time. With the summary off, these reach you at once.</span></span></div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
