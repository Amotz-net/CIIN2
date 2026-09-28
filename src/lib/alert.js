// =====================================================================
// Five-level sargassum alert, cut from each beach's OWN history.
//
// Thresholds are the 75th / 90th / 95th / 99th percentiles of biomass density
// in the beach's approach zone over ten years (segment_baselines, 0029) — the
// per-zone method SATsum (CONABIO) uses. A level therefore says how unusual
// today is FOR THIS BEACH. It is not comparable between beaches.
// =====================================================================
export const LEVELS = [
  { key: 'low',      label: 'Low',      tone: 'green', hex: '#6FC08C', means: 'within the usual range for this beach' },
  { key: 'moderate', label: 'Moderate', tone: 'teal',  hex: '#57C4AE', means: 'above 3 weeks in 4 of its record' },
  { key: 'high',     label: 'High',     tone: 'amber', hex: '#E0A94F', means: 'above 9 weeks in 10 of its record' },
  { key: 'severe',   label: 'Severe',   tone: 'red',   hex: '#D9736A', means: 'above 19 weeks in 20 of its record' },
  { key: 'extreme',  label: 'Extreme',  tone: 'red',   hex: '#C2453B', means: 'in the top 1% of its record' },
]

export function levelFor(density, base) {
  if (density == null || !base) return null
  const d = Number(density)
  const i = d >= Number(base.p99) ? 4 : d >= Number(base.p95) ? 3 : d >= Number(base.p90) ? 2 : d >= Number(base.p75) ? 1 : 0
  return LEVELS[i]
}
