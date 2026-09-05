import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/auth.jsx'
import { ROLE_VIEWS, ROLE_LABELS } from '../lib/roleViews.js'
import { isOrgAdmin, orgApproved } from '../lib/scope.js'

// The LANDING is the ROLE view (Spec v1.3 §11.1). Org management is a section
// within it, shown only to org_admin. Approval gates the org (§11.3): an
// unapproved org's users see a restricted pending state, evaluated live.
export default function Dashboard() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const org = profile?.organizations

  if (profile && !profile.org_id) {
    return (
      <>
        <TopBar />
        <div className="wrap">
          <div className="card">
            <h2>Account not linked</h2>
            <p className="muted">Your account isn't linked to an organization yet. Ask your CIIN administrator to invite you.</p>
          </div>
        </div>
      </>
    )
  }

  if (!orgApproved(profile)) {
    return (
      <>
        <TopBar />
        <div className="wrap">
          <div className="card pending-card">
            <span className="pill amber">pending approval</span>
            <h2 style={{ marginTop: 10 }}>{org?.name} is awaiting CIIN approval</h2>
            <p className="muted">
              Your organization has been registered. A CIIN administrator will review and approve it,
              after which your {ROLE_LABELS[org?.role] || 'role'} dashboard unlocks. You'll see it here automatically once approved.
            </p>
          </div>
        </div>
      </>
    )
  }

  const RoleView = ROLE_VIEWS[org?.role]
  const admin = isOrgAdmin(profile)

  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="dash-head">
          <div>
            <div className="muted" style={{ fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {ROLE_LABELS[org?.role]}
            </div>
            <h1 style={{ margin: '2px 0 0' }}>{org?.name}</h1>
          </div>
          {admin && (
            <button className="btn ghost" onClick={() => nav('/manage')}>Organization settings</button>
          )}
        </div>

        {RoleView
          ? <RoleView profile={profile} />
          : <div className="card"><p className="muted">No dashboard configured for this role yet.</p></div>}
      </div>
    </>
  )
}
