// =====================================================================
// CIIN — next-inundation ("landfall") projection.
//
// HONEST SCOPE. This does not invent an arrival time. It reads the drift
// feed's own `arrival_window` — a first-order projection from NOAA
// geostrophic currents + windage over a 3-day horizon — and turns that
// window into a countdown anchored on the feed's observation time.
//
// The model cannot see past 3 days, so when drift says "beyond 3 days" we
// say exactly that rather than ticking toward a fabricated moment. When a
// segment is already at high inundation risk we count UP from the read
// instead of down: the event is not pending, it is happening.
// =====================================================================

// Drift returns a coarse arrival window. Map it to [earliest, latest] days.
const WINDOW_DAYS = {
  '1–2 days': [1, 2],
  '2–4 days': [2, 4],
  '3–5 days': [3, 5],
}
const DAY_MS = 86_400_000

// SIR severity ordering — worst segment drives the jurisdiction headline.
const SIR_RANK = { high: 3, medium: 2, low: 1 }

function anchorOf(read, drift) {
  const raw = drift?.asOf || read?.asOf
  const t = raw ? Date.parse(raw) : NaN
  return Number.isNaN(t) ? Date.now() : t
}

// Score a candidate so the most urgent segment wins the headline slot:
// an active inundation outranks anything inbound; among inbound, soonest first.
function urgency(c) {
  if (c.state === 'active') return 1e12 + (SIR_RANK[c.sir] || 0)
  if (c.state === 'inbound') return 1e9 - c.opens
  return 0
}

// segments: beach_segment rows · reads: {segId: afai} · drifts: {segId: drift}
export function computeLandfall({ segments = [], reads = {}, drifts = {} }) {
  const candidates = []

  for (const seg of segments) {
    const read = reads[seg.id]
    const drift = drifts[seg.id]
    if (!read?.ok || read.gap) continue          // no clear satellite read → no claim

    const anchor = anchorOf(read, drift)

    // Already inundated: count up from the observation, don't pretend it's coming.
    if (read.sir === 'high') {
      candidates.push({
        state: 'active', segment: seg, sir: read.sir, read, drift, anchor,
        basis: 'Live satellite read (SIR method) at high inundation risk now.',
        confidence: 'observed',
      })
      continue
    }

    if (!drift?.ok) continue                      // no current vector → no projection
    const span = WINDOW_DAYS[drift.arrival_window]

    // Beyond the model's 3-day horizon: say so, tick nothing.
    if (!span) {
      candidates.push({
        state: 'beyond', segment: seg, sir: read.sir, read, drift, anchor,
        basis: 'Drift over the 3-day horizon does not carry a patch to this coast.',
        confidence: drift.confidence || 'moderate',
      })
      continue
    }

    candidates.push({
      state: 'inbound', segment: seg, sir: read.sir, read, drift, anchor,
      opens: anchor + span[0] * DAY_MS,
      closes: anchor + span[1] * DAY_MS,
      basis: `Drifting ${drift.bearing} at ${drift.speed_km_day} km/day; arrival window ${drift.arrival_window}.`,
      confidence: drift.confidence || 'moderate',
    })
  }

  if (!candidates.length) return { state: 'unknown' }
  candidates.sort((a, b) => urgency(b) - urgency(a))
  return { ...candidates[0], watching: candidates.length }
}

// Split a millisecond duration into padded countdown parts.
export function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(s / 86400),
    hours: String(Math.floor(s / 3600) % 24).padStart(2, '0'),
    mins: String(Math.floor(s / 60) % 60).padStart(2, '0'),
    secs: String(s % 60).padStart(2, '0'),
  }
}
