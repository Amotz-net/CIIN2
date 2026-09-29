// =====================================================================
// CIIN notify — tells the other parties when something happens on a beach.
//
//   landing            property reported a landing   -> hubs, government
//   removal_recorded   hub recorded a removal        -> property (to sign off)
//   removal_signed     property signed it off        -> hub
//   removal_disputed   property disputes it          -> hub, government
//   sample_sent        hub sent a sample             -> laboratory
//   sample_received    laboratory has it             -> sender
//   sample_resulted    result returned               -> sender; government if over the limit
//
// The caller must be signed in and able to see the record. The function then
// alerts the OTHER parties and logs each alert.
//
// Deploy: supabase functions deploy notify
// =====================================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { alertPeople, orgsIn, when } from '../_shared/mail.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TABLE: Record<string, string> = {
  landing: 'landing_reports', removal_recorded: 'removals', removal_signed: 'removals', removal_disputed: 'removals',
  sample_sent: 'samples', sample_received: 'samples', sample_resulted: 'samples',
}
const ARSENIC_LIMIT = 40   // mg/kg, the ceiling in the grading rules

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { event, id } = await req.json()
    const table = TABLE[event]
    if (!table || !id) return json({ ok: false, reason: 'bad request' }, 400)
    const base = Deno.env.get('SUPABASE_URL')!
    const asUser = createClient(base, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: seen } = await asUser.from(table).select('id').eq('id', id).maybeSingle()
    if (!seen) return json({ ok: false, reason: 'not found' }, 404)

    const admin = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const org = async (oid: string) => (await admin.from('organizations').select('id, name, country_code').eq('id', oid).single()).data
    const log: any[] = []

    if (table === 'landing_reports') {
      const { data: r } = await admin.from('landing_reports').select('*, beach_segments(name, property_id)').eq('id', id).single()
      const owner = await org(r.org_id)
      const due = new Date(new Date(r.landed_at).getTime() + 48 * 3600_000).toISOString()
      const facts = `Beach: ${r.beach_segments?.name}\nProperty: ${owner.name}\nLanded: ${when(r.landed_at)}\nExtent: ${r.extent}`
        + (r.note ? `\nFrom the property: ${r.note}` : '') + `\nRemoval due by: ${when(due)}`
      log.push(...await alertPeople(admin, { orgs: await orgsIn(admin, owner.country_code, 'recovery_hub') },
        { audience: 'hub', level: 'urgent', kind: 'landing', ref: id, mission: r.mission_id, subject: `Sargassum has landed at ${r.beach_segments?.name}`,
          body: `${owner.name} reports that sargassum has landed. After about 48 hours it rots and loses its value.\n\n${facts}\n\nAccept the mission if you can respond, and send the property your dates.` }))
      log.push(...await alertPeople(admin, { orgs: await orgsIn(admin, owner.country_code, 'government') },
        { audience: 'government', level: 'info', kind: 'landing', ref: id, mission: r.mission_id, subject: `Landing reported at ${r.beach_segments?.name}`,
          body: `For your information. No decision is needed from you.\n\n${facts}` }))
    }

    if (table === 'removals') {
      const { data: r } = await admin.from('removals').select('*, missions(id, title, org_id, segment_id)').eq('id', id).single()
      const [hub, owner] = [await org(r.org_id), await org(r.missions.org_id)]
      const dest = r.destination_org ? (await org(r.destination_org)).name : r.destination_text
      const { data: seg } = r.missions.segment_id ? await admin.from('beach_segments').select('name, property_id').eq('id', r.missions.segment_id).maybeSingle() : { data: null }
      const where = seg?.name ?? r.missions.title
      const facts = `Beach: ${where}\nRemoved: ${when(r.removed_at)}\nTonnes: ${r.tonnes} (${r.tonnes_basis})\nTaken to: ${dest ?? 'not stated'}`
        + (r.note ? `\nFrom the hub: ${r.note}` : '') + (r.sign_note ? `\nFrom the property: ${r.sign_note}` : '')
      if (event === 'removal_recorded') log.push(...await alertPeople(admin, { orgs: [owner.id], property: seg?.property_id },
        { audience: 'owner', kind: event, ref: id, mission: r.mission_id, subject: `Removal recorded at ${where}: please sign off`,
          body: `${hub.name} has recorded a removal on your frontage. Sign it off if it is right, or say what is wrong.\n\n${facts}` }))
      else {
        log.push(...await alertPeople(admin, { orgs: [hub.id] },
          { audience: 'hub', level: event === 'removal_signed' ? 'info' : 'action', kind: event, ref: id, mission: r.mission_id,
            subject: event === 'removal_signed' ? `${owner.name} signed off the removal at ${where}` : `${owner.name} disputes the removal at ${where}`,
            body: `${event === 'removal_signed' ? 'The record is now agreed by both sides.' : 'The property does not agree with the record. A correction is made by recording the removal again.'}\n\n${facts}` }))
        if (event === 'removal_disputed') log.push(...await alertPeople(admin, { orgs: await orgsIn(admin, owner.country_code, 'government') },
          { audience: 'government', level: 'info', kind: event, ref: id, mission: r.mission_id, subject: `Removal disputed at ${where}`,
            body: `The property and the hub do not agree on what was removed.\n\n${facts}` }))
      }
    }

    if (table === 'samples') {
      const { data: s } = await admin.from('samples').select('*, batches(batch_ref, arsenic_total)').eq('id', id).single()
      const [sender, lab] = [await org(s.org_id), await org(s.lab_org_id)]
      const facts = `Sample: ${s.sample_ref}` + (s.batches?.batch_ref ? `\nBatch: ${s.batches.batch_ref}` : '') + `\nTaken: ${when(s.taken_at)}\nSent by: ${sender.name}\nLaboratory: ${lab.name}`
        + (s.note ? `\nNote: ${s.note}` : '')
      if (event === 'sample_sent') log.push(...await alertPeople(admin, { orgs: [lab.id] },
        { audience: 'lab', kind: event, ref: id, mission: s.mission_id, subject: `Sample on its way: ${s.sample_ref}`,
          body: `${sender.name} has sent you a sample. Please record it as received when it arrives.\n\n${facts}` }))
      if (event === 'sample_received') log.push(...await alertPeople(admin, { orgs: [sender.id] },
        { audience: 'hub', level: 'info', kind: event, ref: id, mission: s.mission_id, subject: `${lab.name} has received sample ${s.sample_ref}`,
          body: `The laboratory has the sample.\n\n${facts}` }))
      if (event === 'sample_resulted') {
        const over = Number(s.arsenic_inorganic) > ARSENIC_LIMIT || Number(s.batches?.arsenic_total) > ARSENIC_LIMIT
        const result = `\nInorganic arsenic: ${s.arsenic_inorganic} mg/kg` + (s.batches?.arsenic_total != null ? `\nTotal arsenic, field screen: ${s.batches.arsenic_total} mg/kg` : '')
        log.push(...await alertPeople(admin, { orgs: [sender.id] },
          { audience: 'hub', kind: event, ref: id, mission: s.mission_id, subject: `Result returned for sample ${s.sample_ref}`,
            body: `The batch has been re-graded on the confirmed value. Its permitted uses follow from the grade.\n\n${facts}${result}` }))
        if (over) log.push(...await alertPeople(admin, { orgs: await orgsIn(admin, sender.country_code, 'government') },
          { audience: 'government', kind: 'arsenic_over_limit', ref: id, mission: s.mission_id, subject: `Arsenic above ${ARSENIC_LIMIT} mg/kg: sample ${s.sample_ref}`,
            body: `A batch has tested above the ceiling and is for controlled disposal only.\n\n${facts}${result}` }))
      }
    }
    return json({ ok: true, notified: log.length, results: log })
  } catch (e) {
    return json({ ok: false, reason: String(e).slice(0, 200) }, 500)
  }
})
