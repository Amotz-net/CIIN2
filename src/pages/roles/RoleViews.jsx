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



export function ProcessorView() {
  return (
    <Grid>
      <Panel title="Certification status" hint="Your CIIN certificate and what maintains it." />
      <Panel title="Quality passports" hint="Batch passports — screened / verified, grades." />
      <Panel title="Closure ledger" hint="Mass-balance reconciliation for your loads." />
      <Panel title="Usage & limits" hint="Permitted vs excluded destinations per grade." />
    </Grid>
  )
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
