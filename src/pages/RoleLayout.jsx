import { useEffect, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ViewAs, ViewAsBanner } from '../components/ViewAs.jsx'
import { Tour } from '../components/Tour.jsx'
import { CommandConsole, AdminConsole } from '../console/consolesA.jsx'
import { Icon } from '../console/kit.jsx'
import { hasTour } from '../lib/tour.js'
import { useAuth } from '../lib/auth.jsx'
import { ROLE_VIEWS, ROLE_LABELS } from '../lib/roleViews.js'
import { ROLE_NAV, ADMIN_NAV, ROLE_TITLE, ACT_ON, defaultSection } from '../lib/nav.js'
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

  // The tour runs once, on first landing. Never while impersonating: it would
  // walk a platform admin through someone else's dashboard and then mark the
  // admin's own onboarding complete.
  const [tourOpen, setTourOpen] = useState(false)
  const [tourReady, setTourReady] = useState(false)
  useEffect(() => {
    if (!profile || tourReady) return
    setTourReady(true)
    if (!profile.onboarded_at && !viewAsId && hasTour(profile.organizations?.role)) setTourOpen(true)
  }, [profile, viewAsId, tourReady])

  async function endTour() {
    setTourOpen(false)
    if (!profile?.id || profile.onboarded_at) return
    // Best effort: a failed write means the tour offers itself again, which is
    // a far better failure than blocking the dashboard behind it.
    await supabase.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', profile.id)
  }

  function chooseViewAs(id) {
    setViewAsId(id)
    try { id ? sessionStorage.setItem('ciin.viewAs', id) : sessionStorage.removeItem('ciin.viewAs') } catch (_) {}
    // Where to land depends on the new org's role, which the effect above
    // resolves; exiting returns to the admin's own default immediately.
    if (!id) nav('/app/' + defaultSection(profile?.organizations?.role), { replace: true })
  }

  // The impersonated context substitutes the org AND its id, because the role
  // views scope their own queries by profile.org_id.
  // Choosing your own organisation is not impersonation: it must not lock the
  // dashboard read-only or claim you are viewing someone else's data.
  const impersonating = isPlatformAdmin && !!viewAsOrg && viewAsOrg.id !== profile?.org_id
  const effective = impersonating
    ? { ...profile, org_id: viewAsOrg.id, organizations: viewAsOrg }
    : profile
  const org = effective?.organizations
  const role = org?.role
  // Hooks must run on every render, so this sits above the early returns below.
  const waiting = useWaiting(role, effective?.org_id)

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

  // The administrator, when not viewing as someone else, gets the two
  // administration consoles ahead of their own organisation's tabs.
  const adminMode = isPlatformAdmin && !impersonating
  const base = ROLE_NAV[role] || [{ key: 'overview', label: 'Overview', icon: 'home' }]
  const items = adminMode ? [...ADMIN_NAV, ...base.filter(i => !ADMIN_NAV.some(a => a.key === i.key))] : base
  // A section from the previous role (e.g. 'knowledge') may not exist in this
  // one's nav — fall back rather than render a blank screen.
  const requested = section || defaultSection(role)
  const active = items.some(i => i.key === requested) ? requested : items[0].key
  const go = (sec) => nav('/app/' + sec)
  const [title, strap] = ROLE_TITLE[adminMode ? (active === 'admin' ? 'admin' : 'command') : role] || ['Dashboard', '']
  const RoleView = ROLE_VIEWS[role]
  const admin = isOrgAdmin(profile)

  return (
    <div className="theme-command" style={{ display: 'flex', minHeight: '100vh' }}>
      {/* left sidebar */}
      <nav className="rail">
        <div className="rail-logo"><Mark /><div><b>CIIN</b><small>Coastal intelligence<br />infrastructure network</small></div></div>
        {items.map(it => (
          <a key={it.key}
             className={'rail-item' + (it.key === active ? ' active' : '')}
             onClick={() => go(it.key)}>
            <span className="rail-ic"><Icon name={it.icon} size={20} /></span>
            <span className="rail-lbl">{it.label}</span>
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <div className="rail-rule" />
        <a className="rail-item" onClick={() => go(ACT_ON[role] || items[0].key)}>
          <span className="rail-ic"><Icon name="bell" size={20} /></span><span className="rail-lbl">Notifications</span>
          {waiting > 0 && <span className="rail-badge">{waiting}</span>}
        </a>
        {admin && <a className="rail-item" onClick={() => nav('/manage')}><span className="rail-ic"><Icon name="gear" size={20} /></span><span className="rail-lbl">Settings</span></a>}
        {profile?.is_platform_admin && <a className="rail-item" onClick={() => nav('/admin/orgs')}><span className="rail-ic"><Icon name="shield" size={20} /></span><span className="rail-lbl">Organisations</span></a>}
        {hasTour(role) && !impersonating && (
          <a className="rail-item" onClick={() => setTourOpen(true)}>
            <span className="rail-ic"><Icon name="help" size={20} /></span><span className="rail-lbl">Help &amp; support</span>
          </a>
        )}
        <a className="rail-item" onClick={async () => { await signOut(); nav('/login') }}><span className="rail-ic"><Icon name="power" size={20} /></span><span className="rail-lbl">Sign out</span></a>
      </nav>

      {/* main */}
      <main style={{ flex: 1, minWidth: 0 }}>
        <div className="wrap wide">
          <div className="dash-head">
            <div>
              <h1 className="cc-brand">CIIN <i>•</i> {title}</h1>
              <div className="cc-strap">{strap}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <Clock org={org?.name} role={ROLE_LABELS[role]} />
              {isPlatformAdmin && <ViewAs profile={profile} viewAsId={viewAsId} onChange={chooseViewAs} />}
            </div>
          </div>

          {impersonating && <ViewAsBanner org={viewAsOrg} onExit={() => chooseViewAs(null)} />}

          {adminMode && active === 'overview' ? <CommandConsole profile={effective} onNavigate={go} />
           : adminMode && active === 'admin' ? <AdminConsole profile={effective}
               onOpen={(t) => (t.orgs ? nav('/admin/orgs') : t.org && chooseViewAs(t.org))} />
           : !RoleView ? <div className="card"><p className="muted">No dashboard for this role.</p></div>
           : impersonating ? (
            /* A disabled fieldset really disables every control inside it, so
               this is an actual lock rather than a styling of one. */
            <fieldset className="viewas-lock" disabled>
              <RoleView profile={effective} section={active} onNavigate={go} />
            </fieldset>
           ) : <RoleView profile={effective} section={active} onNavigate={go} />}

          {tourOpen && !impersonating && (
            <Tour
              role={role}
              section={active}
              onNavigate={(sec) => nav('/app/' + sec)}
              onFinish={endTour}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// The CIIN mark: three currents.
function Mark() {
  return (
    <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true">
      <path d="M2 12C9 3 17 3 24 9s12 5 18-2" fill="none" stroke="#57C4AE" strokeWidth="4" strokeLinecap="round" />
      <path d="M2 20c7-9 15-9 22-3s12 5 18-2" fill="none" stroke="#35C2D6" strokeWidth="4" strokeLinecap="round" />
      <path d="M6 29c6-7 12-7 18-2s11 4 16-2" fill="none" stroke="#2B7FA8" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

// How many things are waiting on this organisation. Row-level security and the
// organisation filter decide what is counted.
function useWaiting(role, orgId) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!orgId) return
    let alive = true
    ;(async () => {
      let count = 0
      if (role === 'government') count = (await supabase.from('missions').select('id', { count: 'exact', head: true }).eq('status', 'proposed')).count
      else if (role === 'hotel') count = (await supabase.from('missions').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('access_state', 'pending').eq('status', 'authority_approved')).count
      else if (role === 'recovery_hub') count = (await supabase.from('mission_hubs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('accepted', false)).count
      else if (role === 'university_lab') count = (await supabase.from('batches').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('measurement_conf', 'screened')).count
      if (alive) setN(count || 0)
    })()
    return () => { alive = false }
  }, [role, orgId])
  return n
}

function Clock({ org, role }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return (
    <div className="cc-clock">
      {org && <span className="cc-org"><small>{role}</small>{org}</span>}
      <span>{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
      <span className="cc-live"><i />Caribbean region</span>
    </div>
  )
}

function Shell({ children, profile, onOut }) {
  return (
    <div className="theme-command" style={{ display: 'flex', minHeight: '100vh' }}>
      <nav className="rail">
        <div className="rail-logo"><Mark /><div><b>CIIN</b></div></div>
        <div style={{ flex: 1 }} />
        <a className="rail-item" onClick={onOut}><span className="rail-ic">⏻</span><span className="rail-lbl">Sign out</span></a>
      </nav>
      <main style={{ flex: 1 }}><div className="wrap">{children}</div></main>
    </div>
  )
}
