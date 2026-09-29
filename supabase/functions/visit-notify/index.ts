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
import { alertPeople } from '../_shared/mail.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const FROM_HUB = ['proposed', 'changed', 'cancelled', 'completed']
const FROM_OWNER = ['confirmed', 'change_requested']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { visit_id, event } = await req.json()
    if (!visit_id || ![...FROM_HUB, ...FROM_OWNER].includes(event)) return json({ ok: false, reason: 'bad request' }, 400)
    const base = Deno.env.get('SUPABASE_URL')!
    
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
    const body = `${lead}\n\n${facts}`
    // Done and agreed are for information; anything that needs an answer is sent at once.
    const level = ['completed', 'confirmed'].includes(event) ? 'info' : 'action'
    const log = await alertPeople(admin, { orgs: [target!.id], property: toOwner ? seg?.property_id : null },
      { audience: toOwner ? 'owner' : 'hub', level, kind: 'visit_' + event, ref: visit_id, mission: m.id, subject, body })
    return json({ ok: true, notified: log.length, results: log })
  } catch (e) {
    return json({ ok: false, reason: String(e).slice(0, 200) }, 500)
  }
})
