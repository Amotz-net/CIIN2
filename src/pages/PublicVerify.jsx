// Public certificate verification — NO login required.
// Stage 1 placeholder: the search UI and the public, read-only path.
// Later stages wire this to the certificates table (also via a public RLS policy).
export default function PublicVerify() {
  return (
    <div className="wrap">
      <div className="logo-lg" style={{ marginTop: 20 }}>CIIN<span>.</span></div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>Public certificate verification</p>
      <div className="card" style={{ maxWidth: 520, margin: '20px auto' }}>
        <h2>Verify a processor</h2>
        <label>Search by name, country, or certificate ID</label>
        <input placeholder="e.g. Negril, Barbados, or CIIN-2026-JM-0007" />
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Public verification requires no account. Certificate lookup activates once the
          certification stage is built; this confirms the public, login-free route.
        </p>
        <a href="/login">Sign in →</a>
      </div>
    </div>
  )
}
