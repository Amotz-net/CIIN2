import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { isOrgAdmin } from './lib/scope.js'
import './styles.css'

import Login from './pages/Login.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Manage from './pages/Manage.jsx'
import AdminOrgs from './pages/AdminOrgs.jsx'
import PublicVerify from './pages/PublicVerify.jsx'

function RequireAuth({ children }) {
  const { loading, user } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Org-admin (or platform admin) only — the management section.
function RequireOrgAdmin({ children }) {
  const { loading, profile } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!isOrgAdmin(profile)) return <Navigate to="/" replace />
  return children
}

function RequireAdmin({ children }) {
  const { loading, profile } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!profile?.is_platform_admin) return <Navigate to="/" replace />
  return children
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept" element={<AcceptInvite />} />
      <Route path="/verify" element={<PublicVerify />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/manage" element={<RequireAuth><RequireOrgAdmin><Manage /></RequireOrgAdmin></RequireAuth>} />
      <Route path="/admin/orgs" element={<RequireAuth><RequireAdmin><AdminOrgs /></RequireAdmin></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
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
