import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { ROLE_LABELS } from '../lib/roleViews.js'

// Organization settings — the admin SECTION within the role view (§11.1).
// Reached from the role dashboard's "Organization settings" button.
// Org-admin only (route-guarded). Members, invites, and org profile.
function fmtLevel(l) { return l === 'org_admin' ? 'Org admin' : 'Member' }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—' }

export default function Manage() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const org = profile?.organizations
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState('member')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data: m } = await supabase.from('profiles')
      .select('id, full_name, level, created_at').order('created_at', { ascending: true })
    setMembers(m ?? [])
    const { data: i } = await supabase.from('invitations')
      .select('id, email, level, status, created_at, expires_at').order('created_at', { ascending: false })
    setInvites(i ?? [])
  }
  useEffect(() => { load() }, [])

  async function invite(e) {
    e.preventDefault()
    setErr(''); setMsg('')
    if (!profile?.org_id) { setErr('Your account is not linked to an organization.'); return }
    const { data: inv, error } = await supabase.from('invitations')
      .insert({ email, org_id: profile.org_id, level, invited_by: profile.id })
      .select('token').single()
    if (error) { setErr(error.message); return }
    const link = `${window.location.origin}/accept?token=${inv.token}`
    setMsg(`Invite created. Send this link to ${email}: ${link}`)
    setEmail(''); load()
  }

  async function revoke(id) {
    await supabase.from('invitations').update({ status: 'revoked' }).eq('id', id)
    load()
  }
  async function resend(inv) {
    // "resend" = surface the invite link again
    const { data } = await supabase.from('invitations').select('token').eq('id', inv.id).single()
    if (data) setMsg(`Invite link for ${inv.email}: ${window.location.origin}/accept?token=${data.token}`)
  }

  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="dash-head">
          <div>
            <div className="muted" style={{ fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {ROLE_LABELS[org?.role]} · organization settings
            </div>
            <h1 style={{ margin: '2px 0 0' }}>{org?.name}</h1>
          </div>
          <button className="btn ghost" onClick={() => nav('/')}>← Back to dashboard</button>
        </div>

        <div className="card">
          <h2>Organization profile</h2>
          <table><tbody>
            <tr><th>Name</th><td>{org?.name}</td></tr>
            <tr><th>Role</th><td><span className="pill">{ROLE_LABELS[org?.role]}</span></td></tr>
            <tr><th>Country</th><td>{org?.country_code}</td></tr>
            <tr><th>Approved</th><td>{org?.approved ? <span className="pill">approved</span> : <span className="pill amber">pending</span>}</td></tr>
          </tbody></table>
        </div>

        <div className="card">
          <h2>Invite a team member</h2>
          <form onSubmit={invite}>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
            <label>Level</label>
            <select value={level} onChange={e => setLevel(e.target.value)}>
              <option value="member">Member</option>
              <option value="org_admin">Org admin</option>
            </select>
            <button className="btn" style={{ marginTop: 14 }}>Create invite</button>
            {msg && <div className="ok" style={{ wordBreak: 'break-all' }}>{msg}</div>}
            {err && <div className="err">{err}</div>}
          </form>
          <p className="muted" style={{ fontSize: 12 }}>Members are auto-approved via their invite and inherit this org's status.</p>
        </div>

        <div className="card">
          <h2>Members</h2>
          <table>
            <thead><tr><th>Name</th><th>Level</th><th>Joined</th></tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}><td>{m.full_name || '—'}</td><td>{fmtLevel(m.level)}</td><td>{fmtDate(m.created_at)}</td></tr>
              ))}
              {members.length === 0 && <tr><td colSpan="3" className="muted">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Invitations</h2>
          <table>
            <thead><tr><th>Email</th><th>Level</th><th>Invited</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invites.map(i => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{fmtLevel(i.level)}</td>
                  <td>{fmtDate(i.created_at)}</td>
                  <td>{fmtDate(i.expires_at)}</td>
                  <td><span className={'pill ' + (i.status === 'pending' ? 'amber' : i.status === 'accepted' ? '' : 'grey')}>{i.status}</span></td>
                  <td>{i.status === 'pending' && (
                    <span className="row-actions">
                      <button className="btn sm ghost" onClick={() => resend(i)}>Resend</button>
                      <button className="btn sm red" onClick={() => revoke(i.id)}>Revoke</button>
                    </span>
                  )}</td>
                </tr>
              ))}
              {invites.length === 0 && <tr><td colSpan="6" className="muted">No invitations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
