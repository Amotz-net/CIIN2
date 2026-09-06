import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { isOrgAdmin } from './lib/scope.js'
import { defaultSection } from './lib/nav.js'
import './styles.css'

import Login from './pages/Login.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import RoleLayout from './pages/RoleLayout.jsx'
import Manage from './pages/Manage.jsx'
import AdminOrgs from './pages/AdminOrgs.jsx'
import PublicVerify from './pages/PublicVerify.jsx'

function RequireAuth({ children }) {
  const { loading, user } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}
function RequireOrgAdmin({ children }) {
  const { loading, profile } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!isOrgAdmin(profile)) return <Navigate to="/app" replace />
  return children
}
function RequireAdmin({ children }) {
  const { loading, profile } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!profile?.is_platform_admin) return <Navigate to="/app" replace />
  return children
}
// /app with no section -> redirect to the role's default section.
function AppIndex() {
  const { loading, profile } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  const role = profile?.organizations?.role
  return <Navigate to={'/app/' + defaultSection(role)} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept" element={<AcceptInvite />} />
      <Route path="/verify" element={<PublicVerify />} />
      <Route path="/app" element={<RequireAuth><AppIndex /></RequireAuth>} />
      <Route path="/app/:section" element={<RequireAuth><RoleLayout /></RequireAuth>} />
      <Route path="/manage" element={<RequireAuth><RequireOrgAdmin><Manage /></RequireOrgAdmin></RequireAuth>} />
      <Route path="/admin/orgs" element={<RequireAuth><RequireAdmin><AdminOrgs /></RequireAdmin></RequireAuth>} />
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
