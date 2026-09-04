import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'

// Org admin: invite and see their own organization's members + pending invites.
// RLS guarantees they can only touch their own org.
export default function Members() {
  const { profile } = useAuth()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState('member')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data: m } = await supabase.from('profiles')
      .select('id, full_name, level').order('created_at', { ascending: true })
    setMembers(m ?? [])
    const { data: i } = await supabase.from('invitations')
      .select('id, email, level, status, created_at').order('created_at', { ascending: false })
    setInvites(i ?? [])
  }
  useEffect(() => { load() }, [])

  async function invite(e) {
    e.preventDefault()
    setErr(''); setMsg('')
    const { data: inv, error } = await supabase.from('invitations')
      .insert({ email, org_id: profile.org_id, level })
      .select('token').single()
    if (error) { setErr(error.message); return }
    const link = `${window.location.origin}/accept?token=${inv.token}`
    setMsg(`Invite created. Send this link to ${email}: ${link}`)
    setEmail('')
    load()
  }

  async function revoke(id) {
    await supabase.from('invitations').update({ status: 'revoked' }).eq('id', id)
    load()
  }

  return (
    <>
      <TopBar />
      <div className="wrap">
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
            {msg && <div className="ok" style={{ wordBreak:'break-all' }}>{msg}</div>}
            {err && <div className="err">{err}</div>}
          </form>
        </div>

        <div className="card">
          <h2>Members</h2>
          <table>
            <thead><tr><th>Name</th><th>Level</th></tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}><td>{m.full_name || '—'}</td><td>{m.level === 'org_admin' ? <span className="pill amber">org admin</span> : <span className="pill grey">member</span>}</td></tr>
              ))}
              {members.length === 0 && <tr><td colSpan="2" className="muted">No members yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Pending & past invites</h2>
          <table>
            <thead><tr><th>Email</th><th>Level</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invites.map(i => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.level}</td>
                  <td><span className={'pill ' + (i.status==='pending'?'amber':i.status==='accepted'?'':'grey')}>{i.status}</span></td>
                  <td>{i.status==='pending' && <button className="btn sm red" onClick={() => revoke(i.id)}>Revoke</button>}</td>
                </tr>
              ))}
              {invites.length === 0 && <tr><td colSpan="4" className="muted">No invites yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
