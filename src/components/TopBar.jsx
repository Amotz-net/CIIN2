import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function TopBar() {
  const { profile, user, signOut } = useAuth()
  const nav = useNavigate()
  const org = profile?.organizations
  return (
    <div className="top">
      <span className="logo">CIIN<span>.</span></span>
      {org && <span className="pill">{org.role}</span>}
      {profile?.is_platform_admin && <span className="pill amber">platform admin</span>}
      <span className="muted" style={{ marginLeft: 'auto' }}>{profile?.full_name || user?.email}</span>
      <a onClick={async () => { await signOut(); nav('/login') }} className="muted" style={{ fontSize: 12 }}>Sign out</a>
    </div>
  )
}
