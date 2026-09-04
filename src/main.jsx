import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import './styles.css'

import Login from './pages/Login.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import Dashboard from './pages/Dashboard.jsx'
import AdminOrgs from './pages/AdminOrgs.jsx'
import Members from './pages/Members.jsx'
import PublicVerify from './pages/PublicVerify.jsx'

// Gate: require a logged-in user with a profile; otherwise send to login.
function RequireAuth({ children }) {
  const { loading, user } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Gate: platform-admin only.
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
      <Route path="/verify" element={<PublicVerify />} />{/* public, no login */}
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/members" element={<RequireAuth><Members /></RequireAuth>} />
      <Route path="/admin/orgs" element={<RequireAdmin><AdminOrgs /></RequireAdmin>} />
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
