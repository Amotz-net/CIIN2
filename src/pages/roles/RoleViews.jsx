// =====================================================================
// Role dashboard views — real structure with shaped empty states.
// Each renders the panels that role will have, with an "awaiting data" empty
// state rather than a paragraph explaining what's not built. When the data
// these panels fill from selectOperational(...) once wired per role.
// =====================================================================

// A shaped empty panel — shows what WILL be here, honestly empty for now.
function Panel({ title, hint }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="empty">
        <span className="muted">{hint}</span>
      </div>
    </div>
  )
}

function Grid({ children }) {
  return <div className="dash-grid">{children}</div>
}





export function LabView() {
  return (
    <Grid>
      <Panel title="Sample queue" hint="Inbound samples for testing, with inherited origin." />
      <Panel title="Results" hint="Return confirmed Tier-3 results here." />
      <Panel title="Validation" hint="Throughput and methods." />
    </Grid>
  )
}

export function BuyerView() {
  return (
    <Grid>
      <Panel title="Verified biomass" hint="Certified, passported biomass matched to your demand." />
      <Panel title="Matches" hint="Your contracted and proposed matches." />
    </Grid>
  )
}

export function FinanceView() {
  return (
    <Grid>
      <Panel title="Instruments" hint="Credits, performance-based finance, offtake insurance." />
      <Panel title="Underwriting" hint="Verified missions available to underwrite." />
    </Grid>
  )
}
