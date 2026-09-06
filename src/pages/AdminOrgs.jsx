import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import { supabase } from '../lib/supabase'

const ROLES = ['government','hotel','recovery_hub','processor','university_lab','buyer','finance']
const COUNTRIES = ['JM','BB','DO']

// Platform admin: create an organization, approve it, and invite its org-admin.
// This is the top of the invite chain (CIIN admin -> org-admin -> members).
export default function AdminOrgs() {
  const [orgs, setOrgs] = useState([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('hotel')
  const [country, setCountry] = useState('JM')
  const [adminEmail, setAdminEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('organizations')
      .select('id, name, role, country_code, approved, created_at')
      .order('created_at', { ascending: false })
    setOrgs(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function createOrgAndInvite(e) {
    e.preventDefault()
    setErr(''); setMsg('')
    // 1) create + approve the org
    const { data: org, error: oErr } = await supabase.from('organizations')
      .insert({ name, role, country_code: country, approved: true })
      .select('id').single()
    if (oErr) { setErr(oErr.message); return }
    // 2) invite its org-admin
    const { data: inv, error: iErr } = await supabase.from('invitations')
      .insert({ email: adminEmail, org_id: org.id, level: 'org_admin', invited_by: null })
      .select('token').single()
    if (iErr) { setErr(iErr.message); return }
    const link = `${window.location.origin}/accept?token=${inv.token}`
    setMsg(`Org created. Send this invite link to ${adminEmail}: ${link}`)
    setName(''); setAdminEmail('')
    load()
  }

  async function toggleApproved(o) {
    await supabase.from('organizations').update({ approved: !o.approved }).eq('id', o.id)
    load()
  }

  return (
    <>
      <TopBar />
      <div className="wrap">
        <div className="card">
          <h2>Create organization & invite its admin</h2>
          <form onSubmit={createOrgAndInvite}>
            <label>Organization name</label>
            <input value={name} onChange={e => setName(e.target.value)} required />
            <div style={{ display:'flex', gap:12 }}>
              <div style={{ flex:1 }}>
                <label>Role</label>
                <select value={role} onChange={e => setRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ flex:1 }}>
                <label>Country</label>
                <select value={country} onChange={e => setCountry(e.target.value)}>
                  {COUNTRIES.map(cc => <option key={cc} value={cc}>{cc}</option>)}
                </select>
              </div>
            </div>
            <label>Org admin email (they'll receive an invite link)</label>
            <input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} type="email" required />
            <button className="btn" style={{ marginTop: 14 }}>Create & generate invite</button>
            {msg && <div className="ok" style={{ wordBreak:'break-all' }}>{msg}</div>}
            {err && <div className="err">{err}</div>}
          </form>
          <p className="muted" style={{ fontSize:12 }}>
            Copy the invite link and send it to the new organization admin. Automated email invitations are configured separately.
          </p>
        </div>

        <div className="card">
          <h2>Organizations</h2>
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Country</th><th>Approved</th><th></th></tr></thead>
            <tbody>
              {orgs.map(o => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td><span className="pill">{o.role}</span></td>
                  <td>{o.country_code}</td>
                  <td>{o.approved ? <span className="pill">yes</span> : <span className="pill red">no</span>}</td>
                  <td><button className="btn sm ghost" onClick={() => toggleApproved(o)}>{o.approved ? 'Revoke' : 'Approve'}</button></td>
                </tr>
              ))}
              {orgs.length === 0 && <tr><td colSpan="5" className="muted">No organizations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
