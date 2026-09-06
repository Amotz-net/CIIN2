import { useEffect, useState } from 'react'
import { parts } from '../lib/landfall.js'

// Landfall countdown — the Overview's living centrepiece.
// Ticks once a second against the drift feed's own arrival window. Every
// state is labelled with what it rests on; nothing here is a guess dressed
// up as a forecast. See lib/landfall.js for the honest-scope note.

const R = 58, C = 2 * Math.PI * R
const PILL = { active: 'observed', beyond: 'clear', unknown: 'no data', inbound: 'projected', open: 'projected' }

const TONE = {
  active:  { key: 'red',   hex: '#D9736A', label: 'Inundation underway' },
  open:    { key: 'amber', hex: '#E0A94F', label: 'Arrival window open' },
  inbound: { key: 'teal',  hex: '#57C4AE', label: 'Next inundation window opens in' },
  beyond:  { key: 'green', hex: '#6FC08C', label: 'No landfall inside model horizon' },
  unknown: { key: 'grey',  hex: '#9AA6A3', label: 'Awaiting a clear read' },
}

function Digit({ value, unit }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 52 }}>
      <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 5 }}>{unit}</div>
    </div>
  )
}
const Sep = () => <div style={{ fontSize: 30, fontWeight: 300, color: 'var(--line)', paddingBottom: 16 }}>:</div>

// Dial: depleting ring + a needle pointing along the drift bearing.
function Dial({ tone, progress, bearing, spin }) {
  return (
    <svg width={132} height={132} viewBox="0 0 132 132" style={{ flexShrink: 0 }}>
      <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle
        cx="66" cy="66" r={R} fill="none" stroke={tone.hex} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
        transform="rotate(-90 66 66)"
        style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 6px ${tone.hex}66)` }}
      />
      {bearing != null && (
        /* Two groups on purpose: the CSS wobble would otherwise OVERRIDE the
           bearing rotation and leave the needle pointing at north. Outer group
           holds the real bearing; inner one only sways. */
        <g transform={`rotate(${bearing} 66 66)`}>
          <g className={spin ? 'lf-drift' : undefined} style={{ transformOrigin: '66px 66px' }}>
            <path d="M66 30 L74 52 L66 46 L58 52 Z" fill={tone.hex} opacity=".95" stroke={tone.hex} strokeWidth="1.5" strokeLinejoin="round" />
          </g>
        </g>
      )}
      <circle cx="66" cy="66" r="4" fill={tone.hex} className="lf-pulse" />
    </svg>
  )
}

// Window band: where we are between the window opening and closing.
function Band({ opens, closes, now, hex }) {
  const span = closes - opens
  const pct = Math.max(0, Math.min(1, (now - opens) / (span || 1)))
  const fmt = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${hex}00, ${hex}cc)` }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct * 100}%`, width: 2, background: 'var(--ink)' }} />
      </div>
      <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 5 }}>
        <span>opens {fmt(opens)}</span><span>closes {fmt(closes)}</span>
      </div>
    </div>
  )
}

export function Landfall({ landfall }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const st = landfall?.state || 'unknown'
  // Pre-window vs inside-window are different truths — separate them.
  const phase = st === 'inbound' && now >= landfall.opens ? 'open' : st
  const tone = TONE[phase] || TONE.unknown
  const seg = landfall?.segment
  const drift = landfall?.drift

  // Countdown target and dial progress per phase.
  let target = null, progress = 0
  if (phase === 'inbound') {
    target = landfall.opens - now
    const lead = landfall.opens - landfall.anchor
    progress = Math.max(0, Math.min(1, 1 - (now - landfall.anchor) / (lead || 1)))
  } else if (phase === 'open') {
    target = landfall.closes - now            // time left in the window
    progress = Math.max(0, Math.min(1, 1 - (now - landfall.opens) / ((landfall.closes - landfall.opens) || 1)))
  } else if (phase === 'active') {
    target = now - landfall.anchor            // counts UP since the read
    progress = 1
  } else if (phase === 'beyond') {
    progress = 1                              // a complete calm ring reads as "all clear"
  }
  const p = target != null ? parts(target) : null

  return (
    <div className="card lf-card" style={{ gridColumn: '1 / -1', borderColor: tone.hex + '55' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120% 100% at 10% 0%, ${tone.hex}14, transparent 60%)`, pointerEvents: 'none' }} />
      <h2 style={{ position: 'relative' }}>
        Landfall watch
        <span className={'pill ' + tone.key} style={{ fontSize: 10, marginLeft: 8 }}>{PILL[phase]}</span>
        {landfall?.watching > 1 && <span className="muted" style={{ fontSize: 11, marginLeft: 8, fontWeight: 400 }}>{landfall.watching} segments watched</span>}
      </h2>

      <div style={{ position: 'relative', display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
        <Dial tone={tone} progress={progress} bearing={drift?.bearing_deg} spin={phase === 'inbound' || phase === 'open'} />

        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: tone.hex, fontWeight: 700 }}>
            {phase === 'active' ? 'Inundation underway · elapsed' : tone.label}
          </div>

          {p ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8 }}>
              <Digit value={p.days} unit="days" /><Sep />
              <Digit value={p.hours} unit="hrs" /><Sep />
              <Digit value={p.mins} unit="min" /><Sep />
              <Digit value={p.secs} unit="sec" />
            </div>
          ) : (
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10, color: tone.hex }}>
              {phase === 'beyond' ? 'Clear for 3 days' : 'No projection'}
            </div>
          )}

          {seg && (
            <div style={{ fontSize: 13, marginTop: 10 }}>
              <b>{seg.name}</b>
              {drift?.bearing && <span className="muted"> · drifting {drift.bearing} at {drift.speed_km_day} km/day</span>}
            </div>
          )}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {landfall?.basis || 'No segment currently returns both a clear satellite read and a current vector.'}
          </div>

          {(phase === 'inbound' || phase === 'open') && <Band opens={landfall.opens} closes={landfall.closes} now={now} hex={tone.hex} />}
        </div>
      </div>

      <div className="muted" style={{ position: 'relative', fontSize: 10.5, marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
        {phase === 'active'
          ? 'Elapsed since the satellite observation, not since arrival — the patch may have landed earlier.'
          : phase === 'unknown'
          ? 'Nothing is projected here. A countdown appears once a segment returns both a clear satellite read and a current vector.'
          : 'First-order projection: NOAA geostrophic currents + windage over a 3-day horizon. An arrival window, not an arrival time, and not a validated Lagrangian forecast.'}
        {phase !== 'unknown' && landfall?.confidence && <> Confidence: {landfall.confidence}.</>}
      </div>
    </div>
  )
}
