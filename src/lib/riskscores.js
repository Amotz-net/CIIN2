// =====================================================================
// CIIN risk scores (Government dashboard) — each at its HONEST tier.
// Coastal Health  = LIVE (from AFAI / inundation-risk feeds)
// Carbon Credit   = LIVE-INFORMED (inundation live; carbon value directional)
// Public Health   = DIRECTIONAL (no live H2S/population feed — estimated, labelled)
// Scores are 0–100, higher = worse. Every score returns its tier so the UI
// can label it truthfully. Scores trend DOWN as sargassum clears.
// =====================================================================

// Map an inundation risk level (low/medium/high) to a 0–100 base.
function riskBase(level) {
  return level === 'high' ? 80 : level === 'medium' ? 50 : level === 'low' ? 20 : 0
}

// segAfai: { segId: {ok, gap, level, sir, afai} }  — the live per-segment reads
// beaches: array of segment rows (for count/weighting)
export function computeScores(segReads) {
  const reads = Object.values(segReads || {}).filter(r => r && r.ok && !r.gap)
  if (!reads.length) {
    return {
      coastal_health: { value: null, tier: 'live', note: 'awaiting satellite read' },
      carbon_credit:  { value: null, tier: 'live-informed', note: 'awaiting satellite read' },
      public_health:  { value: null, tier: 'directional', note: 'awaiting satellite read' },
    }
  }
  // Coastal Health: worst SIR risk across segments drives it (LIVE).
  const sirBases = reads.map(r => riskBase(r.sir))
  const coastal = Math.round(Math.max(...sirBases))

  // Carbon Credit: rises with inundation risk (live) — the carbon *value* it maps
  // to is directional, so the score is live-informed. Weighted mean of SIR bases.
  const carbon = Math.round(sirBases.reduce((s, b) => s + b, 0) / sirBases.length)

  // Public Health: DIRECTIONAL — estimated from inundation proximity, no live
  // H2S or population feed. We scale coastal risk down (health impact is a
  // fraction of, and lags, coastal presence) and label it clearly.
  const publicH = Math.round(coastal * 0.7)

  return {
    coastal_health: { value: coastal, tier: 'live',
      note: 'from live satellite inundation risk (SIR method)' },
    carbon_credit:  { value: carbon, tier: 'live-informed',
      note: 'inundation live; carbon value directional' },
    public_health:  { value: publicH, tier: 'directional',
      note: 'estimated from inundation proximity — no live H₂S/population feed' },
  }
}

export function scoreTone(v) {
  if (v == null) return 'grey'
  return v >= 66 ? 'red' : v >= 33 ? 'amber' : 'green'
}
