// =====================================================================
// Sending an alert, and writing down that it was sent.
//
// Three levels:
//   urgent   email at once, and SMS or WhatsApp to anyone who has asked for it
//   action   email at once
//   info     held for that person's daily summary
//
// Every alert is one row per person and channel in `alerts`, whether or not
// it went. `kind` and `ref` say what the alert is about, so a reminder is
// sent once and not again an hour later.
// =====================================================================
// deno-lint-ignore-file no-explicit-any

export const APP = () => Deno.env.get('APP_URL') ?? 'https://ciin-dev.vercel.app'

export async function send(to: string, subject: string, text: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { status: 'not_configured', detail: 'No email service key is set.' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('ALERT_FROM') ?? 'CIIN alerts <onboarding@resend.dev>', to: [to], subject, text }),
    })
    if (r.ok) return { status: 'sent', detail: null }
    return { status: 'failed', detail: `${r.status} ${(await r.text()).slice(0, 200)}` }
  } catch (e) {
    return { status: 'failed', detail: String(e).slice(0, 200) }
  }
}

// SMS or WhatsApp through Twilio. WhatsApp needs its own sender number, and
// outside a 24-hour conversation WhatsApp only delivers approved templates.
export async function text(channel: 'sms' | 'whatsapp', to: string, body: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get(channel === 'sms' ? 'TWILIO_SMS_FROM' : 'TWILIO_WHATSAPP_FROM')
  if (!sid || !token || !from) return { status: 'not_configured', detail: `No ${channel === 'sms' ? 'SMS' : 'WhatsApp'} service is set up.` }
  const wa = (n: string) => (channel === 'whatsapp' ? 'whatsapp:' + n.replace(/^whatsapp:/, '') : n)
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: wa(to), From: wa(from), Body: body.slice(0, 600) }),
    })
    if (r.ok) return { status: 'sent', detail: null }
    return { status: 'failed', detail: `${r.status} ${(await r.text()).slice(0, 200)}` }
  } catch (e) {
    return { status: 'failed', detail: String(e).slice(0, 200) }
  }
}

export const when = (t: string) => new Date(t).toLocaleString('en-GB', { timeZone: 'America/Jamaica',
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' (Jamaica time)'

type Target = { orgs?: string[], admins?: boolean, property?: string | null }
type Msg = { audience: string, subject: string, body: string, mission?: string | null, kind: string, ref: string,
             level?: 'urgent' | 'action' | 'info', once?: boolean }

// Alert everyone in the given organisations. With `once`, does nothing if an
// alert of this kind about this thing has already been written.
export async function alertPeople(admin: any, target: Target, msg: Msg) {
  const level = msg.level ?? 'action'
  if (msg.once) {
    const { data: prior } = await admin.from('alerts').select('id').eq('kind', msg.kind).eq('ref', msg.ref).limit(1)
    if (prior?.length) return []
  }
  let people: any[] = []
  if (target.orgs?.length) {
    const { data } = await admin.from('profiles').select('id, full_name, org_id, property_id').in('org_id', target.orgs)
    // A property manager hears only about their own property.
    people = (data ?? []).filter((p: any) => !p.property_id || !target.property || p.property_id === target.property)
  }
  if (target.admins) {
    const { data } = await admin.from('profiles').select('id, full_name, org_id, property_id').eq('is_platform_admin', true)
    people = [...people, ...(data ?? []).filter((a: any) => !people.some(p => p.id === a.id))]
  }
  if (!people.length) return []
  const { data: prefs } = await admin.from('alert_prefs').select('*').in('profile_id', people.map(p => p.id))
  const prefOf = (id: string) => (prefs ?? []).find((x: any) => x.profile_id === id)

  const log: any[] = []
  const row = (p: any, channel: string, res: any) => admin.from('alerts').insert({
    mission_id: msg.mission ?? null, org_id: p.org_id, profile_id: p.id, audience: msg.audience, channel, level,
    subject: msg.subject, body: msg.body, kind: msg.kind, ref: msg.ref, status: res.status, detail: res.detail,
    sent_at: res.status === 'sent' ? new Date().toISOString() : null })

  for (const p of people) {
    const pref = prefOf(p.id)
    // For information only: keep it for the daily summary, unless they have turned the summary off.
    if (level === 'info' && pref?.summary !== false) {
      await row(p, 'summary', { status: 'held', detail: null }); log.push({ audience: msg.audience, channel: 'summary', status: 'held' }); continue
    }
    const { data: u } = await admin.auth.admin.getUserById(p.id)
    const email = u?.user?.email
    const res = email ? await send(email, msg.subject, `Hello ${p.full_name || ''},\n\n${msg.body}\n\nOpen CIIN: ${APP()}/app`)
      : { status: 'failed', detail: 'no email address on the account' }
    await row(p, 'email', res); log.push({ audience: msg.audience, channel: 'email', status: res.status })

    if (level === 'urgent' && pref?.phone) {
      const short = `CIIN URGENT: ${msg.subject}. ${APP()}/app`
      for (const ch of ['sms', 'whatsapp'] as const) {
        if (!pref[ch]) continue
        const r2 = await text(ch, pref.phone, short)
        await row(p, ch, r2); log.push({ audience: msg.audience, channel: ch, status: r2.status })
      }
    }
  }
  return log
}

export async function orgsIn(admin: any, country: string, role: string) {
  const { data } = await admin.from('organizations').select('id').eq('country_code', country).eq('role', role).eq('approved', true)
  return (data ?? []).map((o: any) => o.id)
}
