import { useEffect, useState } from 'react'
import { Kpi } from './kit.jsx'

// Things that tick. Each keeps its own one-second timer, so a moving second
// hand redraws only itself and never the map beside it.

export function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), every); return () => clearInterval(id) }, [every])
  return now
}

const two = n => String(n).padStart(2, '0')
// 1d 04:12:09, or 04:12:09 inside a day.
export function span(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400)
  return (d ? d + 'd ' : '') + `${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
}

export function Ticker({ to, from }) {
  const now = useNow()
  return <span className="k-tick">{span(to != null ? to - now : now - from)}</span>
}

// The arrival headline, counting down to the second.
// Before the window opens it counts to the opening; inside it, to the close.
export function ArrivalKpi({ landfall: lf, label = 'Arrival window' }) {
  const now = useNow()
  if (!lf || lf.state === 'unknown') return <Kpi icon="waves" label={label} value="—" sub="awaiting a clear satellite read" tone="grey" />
  if (lf.state === 'beyond') return <Kpi icon="waves" label={label} value="> 3 days" sub="nothing carried to this coast within the horizon" tone="green" />
  if (lf.state === 'active') return <Kpi icon="waves" label={label} tone="red" value={<span className="k-tick">{span(now - lf.anchor)}</span>}
    sub={`${lf.segment.name} · severe offshore since the satellite read`} />
  if (now >= lf.closes) return <Kpi icon="waves" label={label} value="Window passed" sub={`${lf.segment.name} · awaiting the next reading`} tone="grey" />
  const open = now >= lf.opens
  const total = lf.closes - lf.opens
  return <Kpi icon="waves" label={open ? label + ' · open now' : label + ' · opens in'} tone="amber"
    value={<span className="k-tick">{span((open ? lf.closes : lf.opens) - now)}</span>}
    meter={open ? (now - lf.opens) / total : null}
    sub={open ? `${lf.segment.name} · closes in the time shown · indicative` : `${lf.segment.name} · then open for ${Math.round(total / 3.6e6)}h · indicative`} />
}
