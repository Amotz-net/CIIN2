import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'

// Invite-only: there is no public sign-up form here. New users arrive via an
// invitation link (/accept). This page only signs EXISTING users in.
export default function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const { user } = useAuth()

  if (user) { nav('/', { replace: true }) }

  async function signIn(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    setBusy(false)
    if (error) { setErr(error.message); return }
    nav('/', { replace: true })
  }

  return (
    <div className="center">
      <div className="loginbox">
        <div className="logo-lg">CIIN<span>.</span></div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
          Caribbean Sargassum Network
        </p>
        <div className="card" style={{ marginTop: 20 }}>
          <form onSubmit={signIn}>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
            <label>Password</label>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" required />
            <button className="btn" style={{ width: '100%', marginTop: 14 }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {err && <div className="err">{err}</div>}
          </form>
          <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
            CIIN is invite-only. If you were invited, use the link in your email to set up your account.
          </p>
        </div>
        <p style={{ textAlign: 'center' }}>
          <a href="/verify">Public certificate verification →</a>
        </p>
      </div>
    </div>
  )
}
