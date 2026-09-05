import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// The invite-only account-creation flow.
// A person arrives at /accept?token=UUID from their invitation email.
// We look up the invite, let them set a password, create their auth user,
// create their profile linked to the invite's org, and mark the invite accepted.
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [invite, setInvite] = useState(null)
  const [fullName, setFullName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | invalid | done
  const nav = useNavigate()

  useEffect(() => {
    if (!token) { setStatus('invalid'); return }
    // Anyone can read an invite by its token (RLS allows email/token match paths;
    // for a clean UX this read is also fine as the token is the secret).
    supabase.from('invitations')
      .select('id, email, level, status, expires_at, org_id, organizations(name, role)')
      .eq('token', token)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || data.status !== 'pending' || new Date(data.expires_at) < new Date()) {
          setStatus('invalid')
        } else if (!data.org_id) {
          // A malformed invite with no organization must not create an orphan profile.
          setStatus('invalid')
        } else {
          // normalize to-one join (object vs 1-element array)
          if (Array.isArray(data.organizations)) data.organizations = data.organizations[0] ?? null
          setInvite(data)
          setStatus('ready')
        }
      })
  }, [token])

  async function accept(e) {
    e.preventDefault()
    setErr('')
    // 1) create the auth user with the invited email + chosen password
    const { data: signUp, error: suErr } = await supabase.auth.signUp({
      email: invite.email,
      password: pw,
    })
    if (suErr) { setErr(suErr.message); return }
    const userId = signUp.user?.id
    if (!userId) { setErr('Could not create account. Please try again.'); return }

    // We can only create the profile row if we have an active session, because
    // RLS requires the insert to run as this user (id = auth.uid()).
    // If "Confirm email" is ON in Supabase, signUp does NOT create a session —
    // the account exists but is unconfirmed. Detect that and guide the user,
    // rather than silently failing the profile insert.
    if (!signUp.session) {
      setStatus('confirm')   // show "check your email to confirm" screen
      return
    }

    // 2) create the profile row, linked to the org from the invite
    const { error: pErr } = await supabase.from('profiles').insert({
      id: userId,
      full_name: fullName,
      org_id: invite.org_id,
      level: invite.level,
    })
    if (pErr) {
      setErr('Account created but profile setup failed: ' + pErr.message +
             ' — please tell your CIIN administrator.')
      return
    }

    // 3) mark the invite accepted
    await supabase.from('invitations').update({ status: 'accepted' }).eq('id', invite.id)

    setStatus('done')
    setTimeout(() => nav('/', { replace: true }), 1200)
  }

  if (status === 'loading') return <div className="center muted">Checking your invitation…</div>
  if (status === 'invalid') return (
    <div className="center"><div className="loginbox card">
      <h2>Invitation not valid</h2>
      <p className="muted">This invite link is missing, already used, revoked, or expired. Ask your CIIN administrator for a new one.</p>
      <a href="/login">Back to sign in</a>
    </div></div>
  )
  if (status === 'done') return <div className="center ok">Account created — taking you in…</div>
  if (status === 'confirm') return (
    <div className="center"><div className="loginbox card">
      <h2>Confirm your email</h2>
      <p className="muted">Your account was created. Supabase requires email confirmation before you can finish setup. Check <b>{invite?.email}</b> for a confirmation link, click it, then return here and sign in — your profile will finish setting up automatically.</p>
      <a href="/login">Go to sign in</a>
    </div></div>
  )

  return (
    <div className="center">
      <div className="loginbox">
        <div className="logo-lg">CIIN<span>.</span></div>
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Accept your invitation</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            You've been invited to join <b>{invite.organizations?.name}</b> as{' '}
            <span className="pill">{invite.organizations?.role}</span>{' '}
            {invite.level === 'org_admin' && <span className="pill amber">org admin</span>}
          </p>
          <form onSubmit={accept}>
            <label>Email</label>
            <input value={invite.email} disabled />
            <label>Your full name</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)} required />
            <label>Choose a password</label>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" minLength={8} required />
            <button className="btn" style={{ width: '100%', marginTop: 14 }}>Create account & enter</button>
            {err && <div className="err">{err}</div>}
          </form>
        </div>
      </div>
    </div>
  )
}
