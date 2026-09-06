// Public certificate verification — NO login required.
// Public certificate verification — read-only, no login.
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
          Public verification requires no account. Search a processor to confirm its CIIN certificate status, tier, and validity.
        </p>
        <a href="/login">Sign in →</a>
      </div>
    </div>
  )
}
