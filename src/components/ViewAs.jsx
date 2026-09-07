import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_LABELS } from '../lib/roleViews.js'

// Platform-admin "view as organization" switcher.
//
// A super-user is confined to their own org's role view otherwise: RoleLayout
// derives nav and view from profile.organizations.role, so CIIN Platform being
// a government org meant the other six dashboards were unreachable — not
// forbidden (RLS already grants platform admin cross-org SELECT on every
// operational table), just not routed to.
//
// READ-ONLY by design. The write policies have no `or is_platform_admin()`, so
// acting as another org would be rejected by RLS anyway; RoleLayout disables
// the controls rather than leaving buttons that fail. Letting an admin act AS
// an operator is a deliberate policy change, not something to slip in here.

const ROLE_ORDER = ['government', 'hotel', 'recovery_hub', 'processor', 'university_lab', 'buyer', 'finance']

export function ViewAs({ profile, viewAsId, onChange }) {
  const [orgs, setOrgs] = useState([])
  useEffect(() => {
    let alive = true
    supabase.from('organizations').select('id, name, role, country_code, approved')
      .then(({ data }) => { if (alive) setOrgs(data ?? []) })
    return () => { alive = false }
  }, [])

  const grouped = ROLE_ORDER
    .map(r => ({ role: r, list: orgs.filter(o => o.role === r).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter(g => g.list.length)

  return (
    <div className="viewas">
      <span className="viewas-lbl">View as</span>
      <select className="viewas-sel" value={viewAsId || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">My organization — {profile?.organizations?.name}</option>
        {grouped.map(g => (
          <optgroup key={g.role} label={ROLE_LABELS[g.role] || g.role}>
            {g.list.map(o => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.country_code}{o.approved ? '' : ' · pending'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

export function ViewAsBanner({ org, onExit }) {
  return (
    <div className="viewas-banner">
      <span className="pill amber" style={{ fontSize: 10 }}>read-only</span>
      <span>
        Viewing as <b>{org?.name}</b> ({ROLE_LABELS[org?.role] || org?.role}) — not your own organization.
        Actions are disabled: a platform admin can see every org's data, but cannot act on its behalf.
      </span>
      <button className="btn ghost sm" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={onExit}>Exit</button>
    </div>
  )
}
