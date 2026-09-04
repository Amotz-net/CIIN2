import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/auth.jsx'

// Stage 1 dashboard: confirms who you are, your org, and your access.
// The role-specific value screens (scores, alerts, missions) arrive in later stages;
// this proves the multi-tenant auth spine end-to-end.
export default function Dashboard() {
  const { profile, user } = useAuth()
  const nav = useNavigate()
  const org = profile?.organizations

  // Profile exists but not yet linked to an org (edge case): guide them.
  if (profile && !profile.org_id) {
    return (
      <>
        <TopBar />
        <div className="wrap">
          <div className="card">
            <h2>Account created</h2>
            <p className="muted">Your account isn't linked to an organization yet. If you signed up outside an invitation, ask your CIIN administrator to invite you.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="card">
          <h2>Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            You're signed in to <b>{org?.name}</b>.
          </p>
          <table>
            <tbody>
              <tr><th>Organization</th><td>{org?.name}</td></tr>
              <tr><th>Role</th><td><span className="pill">{org?.role}</span></td></tr>
              <tr><th>Country</th><td>{org?.country_code}</td></tr>
              <tr><th>Your level</th><td>{profile?.level === 'org_admin' ? <span className="pill amber">org admin</span> : <span className="pill grey">member</span>}</td></tr>
              <tr><th>Org approved</th><td>{org?.approved ? <span className="pill">approved</span> : <span className="pill red">pending CIIN approval</span>}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Manage</h2>
          <div className="row-actions">
            {(profile?.level === 'org_admin' || profile?.is_platform_admin) &&
              <button className="btn" onClick={() => nav('/members')}>Invite & manage team</button>}
            {profile?.is_platform_admin &&
              <button className="btn ghost" onClick={() => nav('/admin/orgs')}>Platform admin — organizations</button>}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
            Stage 1 establishes accounts, organizations, invitations and data isolation.
            Role dashboards (risk scores, alerts, missions, reporting) build on this spine in later stages.
          </p>
        </div>
      </div>
    </>
  )
}
