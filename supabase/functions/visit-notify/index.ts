// =====================================================================
// CIIN visit-notify — tells the other side when a clean-up date changes.
//
// Called by the app after a hub schedules, moves, cancels or completes a
// visit, or after a property confirms one or asks for another time.
// The caller must be signed in and must be able to see the visit; the
// function then emails the OTHER party and records each email in `alerts`.
//
// Deploy: supabase functions deploy visit-notify
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const FROM_HUB = ['proposed', 'changed', 'cancelled', 'completed']
const FROM_OWNER = ['confirmed', 'change_requested']

async function send(to: string, subject: string, text: string) {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { visit_id, event } = await req.json()
    if (!visit_id || ![...FROM_HUB, ...FROM_OWNER].includes(event)) return json({ ok: false, reason: 'bad request' }, 400)
    const base = Deno.env.get('SUPABASE_URL')!
    const app = Deno.env.get('APP_URL') ?? 'https://ciin-dev.vercel.app'

    // As the caller: can they see this visit at all?
    const asUser = createClient(base, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: seen } = await asUser.from('cleanup_visits').select('id').eq('id', visit_id).maybeSingle()
    if (!seen) return json({ ok: false, reason: 'visit not found' }, 404)

    const admin = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: v } = await admin.from('cleanup_visits').select('*, missions(id, title, org_id, segment_id)').eq('id', visit_id).single()
    const m = v.missions
    const [{ data: hub }, { data: owner }, { data: seg }] = await Promise.all([
      admin.from('organizations').select('id, name').eq('id', v.org_id).single(),
      admin.from('organizations').select('id, name').eq('id', m.org_id).single(),
      m.segment_id ? admin.from('beach_segments').select('name, property_id').eq('id', m.segment_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const toOwner = FROM_HUB.includes(event)
    const target = toOwner ? owner : hub
    let { data: people } = await admin.from('profiles').select('id, full_name, property_id').eq('org_id', target!.id)
    // A property manager hears only about their own property.
    if (toOwner) people = (people ?? []).filter(p => !p.property_id || p.property_id === seg?.property_id)

    const when = (t: string) => new Date(t).toLocaleString('en-GB', { timeZone: 'America/Jamaica', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const where = seg?.name ?? m.title
    const facts = [`Beach: ${where}`, `Arrival: ${when(v.arrives_at)}`, `Removal finished by: ${when(v.finishes_at)}`,
      v.crew ? `Crew: ${v.crew}` : null, v.trucks ? `Trucks: ${v.trucks}` : null, v.note ? `From the hub: ${v.note}` : null,
      v.reply ? `From the property: ${v.reply}` : null, '(Times are Jamaica time.)'].filter(Boolean).join('\n')
    const subject = {
      proposed: `Clean-up proposed for ${where}: ${when(v.arrives_at)}`,
      changed: `Clean-up dates changed for ${where}`,
      cancelled: `Clean-up cancelled for ${where}`,
      completed: `Clean-up completed at ${where}`,
      confirmed: `${owner!.name} confirmed the clean-up at ${where}`,
      change_requested: `${owner!.name} asked for another time at ${where}`,
    }[event as string]!
    const lead = {
      proposed: `${hub!.name} proposes the following clean-up visit. Please confirm it, or ask for another time.`,
      changed: `${hub!.name} has changed the dates of this clean-up visit. Please confirm the new dates.`,
      cancelled: `${hub!.name} has cancelled this clean-up visit.`,
      completed: `${hub!.name} reports this clean-up visit as completed.`,
      confirmed: `${owner!.name} has confirmed this clean-up visit. Access is expected at the arrival time.`,
      change_requested: `${owner!.name} cannot accept these dates and asks for another time.`,
    }[event as string]!
    const body = `${lead}\n\n${facts}\n\nOpen CIIN: ${app}/app/overview`

    const log: any[] = []
    for (const p of people ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(p.id)
      const email = u?.user?.email
      const res = email ? await send(email, subject, `Hello ${p.full_name || ''},\n\n${body}`) : { status: 'failed', detail: 'no email address on the account' }
      await admin.from('alerts').insert({ mission_id: m.id, org_id: target!.id, profile_id: p.id, audience: toOwner ? 'owner' : 'hub',
        subject, body, status: res.status, detail: res.detail, sent_at: res.status === 'sent' ? new Date().toISOString() : null })
      log.push({ status: res.status })
    }
    return json({ ok: true, notified: log.length, results: log })
  } catch (e) {
    return json({ ok: false, reason: String(e).slice(0, 200) }, 500)
  }
})
