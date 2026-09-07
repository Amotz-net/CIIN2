import { useEffect, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ViewAs, ViewAsBanner } from '../components/ViewAs.jsx'
import { useAuth } from '../lib/auth.jsx'
import { ROLE_VIEWS, ROLE_LABELS } from '../lib/roleViews.js'
import { ROLE_NAV, defaultSection } from '../lib/nav.js'
import { isOrgAdmin, orgApproved } from '../lib/scope.js'

// Shell: left sidebar (role nav + admin) + the active section of the role view.
// Real routes: /app/:section. The role view renders only the active section.
export default function RoleLayout() {
  const { profile, user, signOut } = useAuth()
  const nav = useNavigate()
  const { section } = useParams()
  const isPlatformAdmin = !!profile?.is_platform_admin

  // Platform admin may view any org's dashboard. Kept in sessionStorage so a
  // refresh does not silently drop you back into your own context mid-task,
  // but it never outlives the tab.
  const [viewAsId, setViewAsId] = useState(() =>
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ciin.viewAs')) || null)
  const [viewAsOrg, setViewAsOrg] = useState(null)

  useEffect(() => {
    if (!isPlatformAdmin || !viewAsId) { setViewAsOrg(null); return }
    let alive = true
    supabase.from('organizations').select('id, name, role, country_code, approved')
      .eq('id', viewAsId).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setViewAsOrg(data ?? null)
        if (data) nav('/app/' + defaultSection(data.role), { replace: true })
      })
    return () => { alive = false }
  }, [isPlatformAdmin, viewAsId])

  function chooseViewAs(id) {
    setViewAsId(id)
    try { id ? sessionStorage.setItem('ciin.viewAs', id) : sessionStorage.removeItem('ciin.viewAs') } catch (_) {}
    // Where to land depends on the new org's role, which the effect above
    // resolves; exiting returns to the admin's own default immediately.
    if (!id) nav('/app/' + defaultSection(profile?.organizations?.role), { replace: true })
  }

  // The impersonated context substitutes the org AND its id, because the role
  // views scope their own queries by profile.org_id.
  const impersonating = isPlatformAdmin && !!viewAsOrg
  const effective = impersonating
    ? { ...profile, org_id: viewAsOrg.id, organizations: viewAsOrg }
    : profile
  const org = effective?.organizations
  const role = org?.role

  if (profile && !profile.org_id) {
    return <Shell profile={profile} onOut={async () => { await signOut(); nav('/login') }}>
      <div className="card"><h2>Account not linked</h2><p className="muted">Ask your CIIN administrator to invite you.</p></div>
    </Shell>
  }
  if (!orgApproved(profile)) {
    return <Shell profile={profile} onOut={async () => { await signOut(); nav('/login') }}>
      <div className="card pending-card"><span className="pill amber">pending approval</span>
        <h2 style={{ marginTop: 10 }}>{org?.name} is awaiting CIIN approval</h2>
        <p className="muted">Your {ROLE_LABELS[role] || 'role'} dashboard unlocks once approved.</p></div>
    </Shell>
  }

  const items = ROLE_NAV[role] || [{ key: 'overview', label: 'Overview', icon: '▦' }]
  // A section from the previous role (e.g. 'knowledge') may not exist in this
  // one's nav — fall back rather than render a blank screen.
  const requested = section || defaultSection(role)
  const active = items.some(i => i.key === requested) ? requested : defaultSection(role)
  const RoleView = ROLE_VIEWS[role]
  const admin = isOrgAdmin(profile)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* left sidebar */}
      <nav className="rail">
        <div className="rail-logo">CIIN<span>.</span></div>
        {items.map(it => (
          <a key={it.key}
             className={'rail-item' + (it.key === active ? ' active' : '')}
             onClick={() => nav('/app/' + it.key)}>
            <span className="rail-ic">{it.icon}</span>
            <span className="rail-lbl">{it.label}</span>
          </a>
        ))}
        <div style={{ flex: 1 }} />
        {admin && <a className="rail-item" onClick={() => nav('/manage')}><span className="rail-ic">⚙</span><span className="rail-lbl">Settings</span></a>}
        {profile?.is_platform_admin && <a className="rail-item" onClick={() => nav('/admin/orgs')}><span className="rail-ic">◱</span><span className="rail-lbl">Orgs</span></a>}
        <a className="rail-item" onClick={async () => { await signOut(); nav('/login') }}><span className="rail-ic">⏻</span><span className="rail-lbl">Sign out</span></a>
      </nav>

      {/* main */}
      <main style={{ flex: 1, minWidth: 0 }}>
        <div className="wrap">
          <div className="dash-head">
            <div>
              <div className="muted" style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{ROLE_LABELS[role]}</div>
              <h1 style={{ margin: '2px 0 0' }}>{org?.name}</h1>
            </div>
            {isPlatformAdmin && <ViewAs profile={profile} viewAsId={viewAsId} onChange={chooseViewAs} />}
          </div>

          {impersonating && <ViewAsBanner org={viewAsOrg} onExit={() => chooseViewAs(null)} />}

          {!RoleView ? <div className="card"><p className="muted">No dashboard for this role.</p></div>
           : impersonating ? (
            /* A disabled fieldset really disables every control inside it, so
               this is an actual lock rather than a styling of one. */
            <fieldset className="viewas-lock" disabled>
              <RoleView profile={effective} section={active} />
            </fieldset>
           ) : <RoleView profile={effective} section={active} />}
        </div>
      </main>
    </div>
  )
}

function Shell({ children, profile, onOut }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav className="rail">
        <div className="rail-logo">CIIN<span>.</span></div>
        <div style={{ flex: 1 }} />
        <a className="rail-item" onClick={onOut}><span className="rail-ic">⏻</span><span className="rail-lbl">Sign out</span></a>
      </nav>
      <main style={{ flex: 1 }}><div className="wrap">{children}</div></main>
    </div>
  )
}
