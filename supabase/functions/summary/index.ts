// =====================================================================
// CIIN summary — one email a day, per person, if there is anything to say.
//
// It carries two things:
//   1. what is waiting on that person today
//   2. what happened since the last summary that needed no action
//      (the alerts held at level `info`)
//
// Nobody is sent an empty summary. A person can turn it off, in which case
// information alerts reach them at once instead.
//
// ?dry=1 reports who would be written to and sends nothing.
//
// Deploy: supabase functions deploy summary --no-verify-jwt
// =====================================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { send, when, APP } from '../_shared/mail.ts'

const OPEN = ['raised', 'proposed', 'authority_approved', 'access_granted', 'in_progress']
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const [people, orgs, prefs, missions, pools, visits, removals, landings, samples, segs, held, recent] = (await Promise.all([
      admin.from('profiles').select('id, full_name, org_id, property_id, is_platform_admin'),
      admin.from('organizations').select('id, name, role, country_code, approved'),
      admin.from('alert_prefs').select('*'),
      admin.from('missions').select('*').in('status', OPEN),
      admin.from('mission_hubs').select('*'),
      admin.from('cleanup_visits').select('*').in('status', ['proposed', 'change_requested', 'confirmed']),
      admin.from('removals').select('*').in('status', ['recorded', 'disputed']),
      admin.from('landing_reports').select('*').is('cleared_at', null),
      admin.from('samples').select('*').neq('status', 'resulted'),
      admin.from('beach_segments').select('id, name, property_id, org_id'),
      admin.from('alerts').select('id, profile_id, subject, created_at').eq('status', 'held').order('created_at'),
      admin.from('alerts').select('profile_id').eq('kind', 'daily_summary').gte('created_at', new Date(Date.now() - 20 * 3600_000).toISOString()),
    ])).map((r: any) => r.data ?? [])

    const org = (id: string) => orgs.find((o: any) => o.id === id)
    const seg = (id: string) => segs.find((s: any) => s.id === id)
    const already = new Set(recent.map((r: any) => r.profile_id))
    const out: any[] = []

    for (const p of people) {
      const pref = prefs.find((x: any) => x.profile_id === p.id)
      if (pref?.summary === false || already.has(p.id)) continue
      const o = org(p.org_id); if (!o) continue
      const mineSeg = (sid: string) => !p.property_id || seg(sid)?.property_id === p.property_id
      const country = (oid: string) => org(oid)?.country_code === o.country_code
      const left = (l: any) => 48 - (Date.now() - new Date(l.landed_at).getTime()) / 3600_000
      const clock = (l: any) => `${seg(l.segment_id)?.name}: ${left(l) <= 0 ? `OVERDUE by ${Math.ceil(-left(l))}h` : `${Math.floor(left(l))}h left to clear`}`
      const todo: string[] = []

      if (o.role === 'hotel') {
        const ms = missions.filter((m: any) => m.org_id === o.id && mineSeg(m.segment_id))
        const ids = new Set(ms.map((m: any) => m.id))
        const access = ms.filter((m: any) => m.access_state === 'pending' && m.status !== 'proposed')
        const dates = visits.filter((v: any) => v.status === 'proposed' && ids.has(v.mission_id))
        const sign = removals.filter((r: any) => r.status === 'recorded' && ids.has(r.mission_id))
        if (access.length) todo.push(`${n(access.length, 'mission needs', 'missions need')} your decision on access: ${access.map((m: any) => m.title).join('; ')}`)
        for (const v of dates) todo.push(`Clean-up dates to confirm: ${org(v.org_id)?.name}, arriving ${when(v.arrives_at)}`)
        if (sign.length) todo.push(`${n(sign.length, 'removal record is', 'removal records are')} waiting for your sign-off`)
        for (const l of landings.filter((l: any) => l.org_id === o.id && mineSeg(l.segment_id))) todo.push(clock(l))
      }
      if (o.role === 'recovery_hub') {
        const mine = pools.filter((x: any) => x.org_id === o.id)
        const open = mine.filter((x: any) => !x.accepted && missions.some((m: any) => m.id === x.mission_id && m.status !== 'proposed'))
        if (open.length) todo.push(`${n(open.length, 'mission is', 'missions are')} open for you to accept: ${open.map((x: any) => missions.find((m: any) => m.id === x.mission_id)?.title).join('; ')}`)
        for (const v of visits.filter((v: any) => v.org_id === o.id && v.status === 'change_requested'))
          todo.push(`The property asked for another time: ${missions.find((m: any) => m.id === v.mission_id)?.title ?? 'a mission'}${v.reply ? ` ("${v.reply}")` : ''}`)
        for (const v of visits.filter((v: any) => v.org_id === o.id && v.status === 'confirmed' && new Date(v.arrives_at).getTime() - Date.now() < 36 * 3600_000 && new Date(v.arrives_at).getTime() > Date.now()))
          todo.push(`Visit confirmed: ${missions.find((m: any) => m.id === v.mission_id)?.title ?? 'a mission'}, arriving ${when(v.arrives_at)}`)
        const disputed = removals.filter((r: any) => r.org_id === o.id && r.status === 'disputed')
        if (disputed.length) todo.push(`${n(disputed.length, 'removal record is', 'removal records are')} disputed by the property`)
        const accepted = new Set(mine.filter((x: any) => x.accepted).map((x: any) => x.mission_id))
        for (const l of landings.filter((l: any) => accepted.has(l.mission_id))) todo.push(clock(l))
      }
      if (o.role === 'government') {
        const decide = missions.filter((m: any) => m.status === 'proposed' && m.authority_required && country(m.org_id))
        if (decide.length) todo.push(`${n(decide.length, 'mission is', 'missions are')} waiting for your decision: ${decide.map((m: any) => m.title).join('; ')}`)
        for (const l of landings.filter((l: any) => country(l.org_id))) todo.push(clock(l))
      }
      if (o.role === 'university_lab') {
        const mine = samples.filter((s: any) => s.lab_org_id === o.id)
        const sent = mine.filter((s: any) => s.status === 'sent'), got = mine.filter((s: any) => s.status === 'received')
        if (sent.length) todo.push(`${n(sent.length, 'sample is', 'samples are')} on the way to you`)
        if (got.length) todo.push(`${n(got.length, 'sample is', 'samples are')} waiting for a result: ${got.map((s: any) => s.sample_ref).join('; ')}`)
      }
      if (p.is_platform_admin) {
        const over = landings.filter((l: any) => left(l) <= 0)
        if (over.length) todo.push(`${n(over.length, 'landing is', 'landings are')} overdue across the network`)
      }

      const news = held.filter((a: any) => a.profile_id === p.id)
      if (!todo.length && !news.length) continue

      const body = [
        todo.length ? 'WAITING ON YOU\n' + todo.map(t => '  - ' + t).join('\n') : 'Nothing is waiting on you today.',
        news.length ? 'SINCE YOUR LAST SUMMARY\n' + news.map((a: any) => `  - ${a.subject} (${when(a.created_at)})`).join('\n') : null,
      ].filter(Boolean).join('\n\n')
      const subject = todo.length ? `CIIN today: ${n(todo.length, 'item', 'items')} waiting on you` : `CIIN today: ${n(news.length, 'update', 'updates')}`
      out.push({ person: p.full_name, org: o.name, waiting: todo.length, updates: news.length })
      if (dry) continue

      const { data: u } = await admin.auth.admin.getUserById(p.id)
      const email = u?.user?.email
      const res = email ? await send(email, subject, `Hello ${p.full_name || ''},\n\n${body}\n\nOpen CIIN: ${APP()}/app\n\nTo stop this summary, open Notifications in CIIN.`)
        : { status: 'failed', detail: 'no email address on the account' }
      await admin.from('alerts').insert({ org_id: p.org_id, profile_id: p.id, audience: o.role === 'hotel' ? 'owner' : o.role === 'recovery_hub' ? 'hub' : o.role === 'university_lab' ? 'lab' : o.role === 'government' ? 'government' : 'admin',
        channel: 'email', level: 'info', subject, body, kind: 'daily_summary', ref: p.id, status: res.status, detail: res.detail,
        sent_at: res.status === 'sent' ? new Date().toISOString() : null })
      // Held alerts are released only once the summary carrying them has gone.
      if (res.status === 'sent' && news.length) await admin.from('alerts').update({ status: 'summarised', sent_at: new Date().toISOString() }).in('id', news.map((a: any) => a.id))
    }
    return new Response(JSON.stringify({ ok: true, dry, summaries: out.length, people: out }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: String(e).slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
