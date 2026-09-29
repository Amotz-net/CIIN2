// =====================================================================
// Sending an alert, and writing down that it was sent.
//
// Every alert is one row per person in `alerts`, whether or not the email
// went. `kind` and `ref` identify what the alert is about, so a reminder can
// be sent once and not again an hour later.
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

export const when = (t: string) => new Date(t).toLocaleString('en-GB', { timeZone: 'America/Jamaica',
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' (Jamaica time)'

type Target = { orgs?: string[], admins?: boolean, property?: string | null }
type Msg = { audience: string, subject: string, body: string, mission?: string | null, kind: string, ref: string, once?: boolean }

// Alert everyone in the given organisations. With `once`, does nothing if an
// alert of this kind about this thing has already been written.
export async function alertPeople(admin: any, target: Target, msg: Msg) {
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
  const log: any[] = []
  for (const p of people) {
    const { data: u } = await admin.auth.admin.getUserById(p.id)
    const email = u?.user?.email
    const res = email ? await send(email, msg.subject, `Hello ${p.full_name || ''},\n\n${msg.body}\n\nOpen CIIN: ${APP()}/app`)
      : { status: 'failed', detail: 'no email address on the account' }
    await admin.from('alerts').insert({ mission_id: msg.mission ?? null, org_id: p.org_id, profile_id: p.id, audience: msg.audience,
      subject: msg.subject, body: msg.body, kind: msg.kind, ref: msg.ref, status: res.status, detail: res.detail,
      sent_at: res.status === 'sent' ? new Date().toISOString() : null })
    log.push({ audience: msg.audience, status: res.status })
  }
  return log
}

export async function orgsIn(admin: any, country: string, role: string) {
  const { data } = await admin.from('organizations').select('id').eq('country_code', country).eq('role', role).eq('approved', true)
  return (data ?? []).map((o: any) => o.id)
}
