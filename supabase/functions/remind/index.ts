// =====================================================================
// CIIN remind — chases what nobody has answered, and escalates.
//
// Runs hourly. Each reminder is sent once: it is recorded in `alerts` with a
// kind and the record it concerns, and is not sent again.
//
//   mission, no hub accepted      6 h -> hubs        12 h -> CIIN admin
//                                24 h -> government and the property: public safety
//   offshore high for 3 days, no landing reported -> government; property asked to confirm
//   government decision waiting  12 h -> government and CIIN admin
//   clean-up dates unanswered    12 h -> property
//   landing not yet removed      36 h -> hub, property, government
//                                48 h -> the same, and CIIN admin (overdue), naming the hubs that did not respond
//   removal not signed off       24 h -> property
//   sample not received          48 h -> laboratory
//
// ?dry=1 lists what is due and sends nothing.
//
// Deploy: supabase functions deploy remind --no-verify-jwt
// =====================================================================
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { alertPeople, orgsIn, when } from '../_shared/mail.ts'

const H = 3600_000
const older = (t: string, hours: number) => Date.now() - new Date(t).getTime() >= hours * H
const OPEN = ['raised', 'proposed', 'authority_approved', 'access_granted', 'in_progress']

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const due: any[] = [], log: any[] = []
    const { data: orgs } = await admin.from('organizations').select('id, name, role, country_code')
    const org = (id: string) => (orgs ?? []).find((o: any) => o.id === id)
    const fire = async (target: any, msg: any) => {
      due.push({ kind: msg.kind, ref: msg.ref, subject: msg.subject })
      if (!dry) log.push(...await alertPeople(admin, target, { ...msg, once: true }))
    }

    // ---- missions ----
    const { data: missions } = await admin.from('missions').select('*').in('status', OPEN)
    const { data: pools } = await admin.from('mission_hubs').select('*')
    for (const m of missions ?? []) {
      const owner = org(m.org_id); if (!owner) continue
      const pool = (pools ?? []).filter((p: any) => p.mission_id === m.id)
      const hubOwned = owner.role === 'recovery_hub'
      if (m.status === 'proposed' && m.authority_required) {
        // The original alert was urgent; one reminder, to government itself, at 12 hours.
        if (older(m.created_at, 12)) await fire({ orgs: await orgsIn(admin, owner.country_code, 'government') },
          { audience: 'government', kind: 'gov_decision_12h_gov', ref: m.id, mission: m.id, subject: `Reminder: decision needed on ${m.title}`,
            body: `This mission has waited 12 hours for a government decision. The offshore level is ${m.alert_level ?? 'severe'}.\n\nProperty: ${owner.name}` })
        if (older(m.created_at, 12)) await fire({ admins: true },
          { audience: 'admin', kind: 'gov_decision_12h', ref: m.id, mission: m.id, subject: `No government decision after 12 hours: ${m.title}`,
            body: `Government in ${owner.country_code} has not decided this mission.\n\nProperty: ${owner.name}` })
      } else if (!hubOwned && pool.length && !pool.some((p: any) => p.accepted)) {
        if (older(m.created_at, 6)) await fire({ orgs: pool.map((p: any) => p.org_id) },
          { audience: 'hub', kind: 'hub_accept_6h', ref: m.id, mission: m.id, subject: `Reminder: no hub has accepted ${m.title}`,
            body: `This mission has been open more than 6 hours and no hub has accepted it.\n\nProperty: ${owner.name}` })
        if (older(m.created_at, 12)) await fire({ admins: true },
          { audience: 'admin', kind: 'hub_accept_12h', ref: m.id, mission: m.id, subject: `No hub after 12 hours: ${m.title}`,
            body: `${pool.length} hub(s) were alerted and none has accepted.\n\nProperty: ${owner.name}` })
        // A day without a hub is no longer a logistics problem. Sargassum that
        // nobody will remove becomes a public-safety matter, so government hears.
        if (older(m.created_at, 24)) {
          const names = pool.map((p: any) => p.hub_name).join(', ')
          await fire({ orgs: await orgsIn(admin, owner.country_code, 'government') },
            { audience: 'government', kind: 'hub_accept_24h_gov', ref: m.id, mission: m.id, subject: `No hub has taken ${m.title} after 24 hours`,
              body: `A recovery mission has been open for a day and no hub has accepted it. If the sargassum lands it will not be removed.\n\nProperty: ${owner.name}\nOffshore level when raised: ${m.alert_level ?? 'high'}\nHubs alerted: ${names || 'none in this country'}` })
          await fire({ orgs: [owner.id] },
            { audience: 'owner', kind: 'hub_accept_24h_owner', ref: m.id, mission: m.id, subject: `No hub has taken the mission for ${m.title}`,
              body: `A day after the alert, no recovery hub has accepted. Government has been told. If sargassum has landed, report it in CIIN so the 48-hour clock starts.\n\nHubs alerted: ${names || 'none in this country'}` })
        }
      }
    }

    // ---- offshore high for three days, and nobody has said whether it landed ----
    const { data: reports } = await admin.from('landing_reports').select('segment_id, landed_at')
    const { data: bases } = await admin.from('segment_baselines').select('*').eq('afai_window', '7D')
    const { data: segs } = await admin.from('beach_segments').select('id, name, lat, lng, path')
    for (const m of (missions ?? []).filter((x: any) => x.source === 'live_feed' && x.segment_id && older(x.created_at, 72))) {
      const owner = org(m.org_id); const seg = (segs ?? []).find((s: any) => s.id === m.segment_id); const base = (bases ?? []).find((b: any) => b.segment_id === m.segment_id)
      if (!owner || !seg || !base) continue
      if ((reports ?? []).some((r: any) => r.segment_id === m.segment_id && r.landed_at >= m.created_at)) continue
      // Is it still high out there? Read the zone now rather than trust the level at raising.
      let band: any = null
      try {
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/feeds?feed=band&lat=${seg.lat}&lng=${seg.lng}&days=1&window=7D`, {
          method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ feed: 'band', lat: seg.lat, lng: seg.lng, days: 1, window: '7D', path: seg.path ?? null }) })
        band = r.ok ? await r.json() : null
      } catch (_) { band = null }
      if (!band?.ok || band.gap || !band.latest) continue
      const density = Number(band.latest.density)
      const rank = [base.p75, base.p90, base.p95, base.p99].filter((p: any) => density >= Number(p)).length
      if (rank < 2) continue
      const level = ['low', 'moderate', 'high', 'severe', 'extreme'][rank]
      const facts = `Beach: ${seg.name}\nProperty: ${owner.name}\nOffshore now: ${density} t/km², ${level} on the beach's own scale\nMission raised: ${when(m.created_at)}`
      await fire({ orgs: await orgsIn(admin, owner.country_code, 'government') },
        { audience: 'government', kind: 'high_3d_gov', ref: m.id, mission: m.id, subject: `${seg.name}: high offshore for three days, no word from the beach`,
          body: `The offshore level has stayed at high or above for three days and the property has not reported whether sargassum has landed. It may be on the beach unrecorded.\n\n${facts}` })
      await fire({ orgs: [owner.id] },
        { audience: 'owner', kind: 'high_3d_owner', ref: m.id, mission: m.id, subject: `Has sargassum landed at ${seg.name}?`,
          body: `The offshore level has been high or above for three days. Please report in CIIN whether it has landed, so the hubs and the 48-hour clock can start. Government has been told the beach is unconfirmed.\n\n${facts}` })
    }

    // ---- clean-up dates the property has not answered ----
    const { data: visits } = await admin.from('cleanup_visits').select('*, missions(id, title, org_id, segment_id)').eq('status', 'proposed')
    for (const v of visits ?? []) {
      if (!older(v.created_at, 12) || !v.missions) continue
      await fire({ orgs: [v.missions.org_id] },
        { audience: 'owner', kind: 'visit_answer_12h', ref: v.id, mission: v.mission_id, subject: `Reminder: clean-up dates need your answer`,
          body: `${org(v.org_id)?.name} proposed these dates more than 12 hours ago.\n\nMission: ${v.missions.title}\nArrival: ${when(v.arrives_at)}\nRemoval finished by: ${when(v.finishes_at)}\n\nConfirm them, or ask for another time.` })
    }

    // ---- the 48-hour clock ----
    const { data: landings } = await admin.from('landing_reports').select('*, beach_segments(name, property_id)').is('cleared_at', null)
    for (const l of landings ?? []) {
      const owner = org(l.org_id); if (!owner) continue
      const pool = (pools ?? []).filter((p: any) => p.mission_id === l.mission_id)
      const hubs = pool.filter((p: any) => p.accepted).map((p: any) => p.org_id)
      const hubTarget = hubs.length ? hubs : await orgsIn(admin, owner.country_code, 'recovery_hub')
      const responders = hubs.length ? `Hub responding: ${pool.filter((p: any) => p.accepted).map((p: any) => p.hub_name).join(', ')}`
        : pool.length ? `No hub has accepted this mission. Alerted and silent: ${pool.map((p: any) => p.hub_name).join(', ')}` : 'No recovery hub is registered in this country.'
      const gov = await orgsIn(admin, owner.country_code, 'government')
      const facts = `Beach: ${l.beach_segments?.name}\nProperty: ${owner.name}\nLanded: ${when(l.landed_at)}\nExtent: ${l.extent}\n${responders}`
      for (const [hours, kind, lead] of [[36, 'landing_36h', '36 hours have passed since this landing and no removal has been signed off. 12 hours remain.'],
                                         [48, 'landing_48h', 'OVERDUE. 48 hours have passed since this landing and no removal has been signed off.']] as [number, string, string][]) {
        if (!older(l.landed_at, hours)) continue
        const subject = hours === 48 ? `Overdue: ${l.beach_segments?.name} not cleared after 48 hours` : `12 hours left to clear ${l.beach_segments?.name}`
        await fire({ orgs: hubTarget }, { audience: 'hub', level: 'urgent', kind, ref: l.id, mission: l.mission_id, subject, body: `${lead}\n\n${facts}` })
        await fire({ orgs: [owner.id], property: l.beach_segments?.property_id }, { audience: 'owner', level: 'urgent', kind: kind + '_owner', ref: l.id, mission: l.mission_id, subject, body: `${lead}\n\n${facts}` })
        await fire({ orgs: gov }, { audience: 'government', level: hours === 48 ? 'urgent' : 'action', kind: kind + '_gov', ref: l.id, mission: l.mission_id, subject, body: `${lead}\n\n${facts}` })
        if (hours === 48) await fire({ admins: true }, { audience: 'admin', level: 'urgent', kind: kind + '_admin', ref: l.id, mission: l.mission_id, subject, body: `${lead}\n\n${facts}` })
      }
    }

    // ---- removals nobody has signed ----
    const { data: removals } = await admin.from('removals').select('*, missions(id, title, org_id)').eq('status', 'recorded')
    for (const r of removals ?? []) {
      if (!older(r.created_at, 24) || !r.missions) continue
      await fire({ orgs: [r.missions.org_id] },
        { audience: 'owner', kind: 'removal_sign_24h', ref: r.id, mission: r.mission_id, subject: `Reminder: a removal needs your sign-off`,
          body: `${org(r.org_id)?.name} recorded this removal more than 24 hours ago.\n\nMission: ${r.missions.title}\nTonnes: ${r.tonnes} (${r.tonnes_basis})\nRemoved: ${when(r.removed_at)}` })
    }

    // ---- samples that have not arrived ----
    const { data: samples } = await admin.from('samples').select('*').eq('status', 'sent')
    for (const s of samples ?? []) {
      if (!older(s.sent_at, 48)) continue
      await fire({ orgs: [s.lab_org_id] },
        { audience: 'lab', kind: 'sample_receive_48h', ref: s.id, mission: s.mission_id, subject: `Reminder: sample ${s.sample_ref} not yet recorded as received`,
          body: `${org(s.org_id)?.name} sent this sample more than 48 hours ago. Record it as received, or tell the sender it has not arrived.` })
    }

    return new Response(JSON.stringify({ ok: true, dry, due: due.length, sent: log.length, items: dry ? due : undefined,
      email: Deno.env.get('RESEND_API_KEY') ? 'configured' : 'not configured' }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: String(e).slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
