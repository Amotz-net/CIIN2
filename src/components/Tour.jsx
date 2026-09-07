import { useCallback, useEffect, useRef, useState } from 'react'
import { TOURS } from '../lib/tour.js'

// Guided tour overlay.
//
// Finds each step's panel by the text of its <h2> and cuts a hole in a dimmed
// backdrop around it. Matching on visible text rather than a CSS hook means the
// seven role views need no tour markup, and restyling a panel cannot silently
// break the tour.
//
// A panel that is not on screen — a role with no data yet, a feature awaiting a
// migration — does not abort the tour: the step is shown centred instead, so the
// explanation still lands.

const PAD = 8              // spotlight padding around the panel
const FIND_MS = 2500       // how long to wait for a panel after changing tab
const CARD_W = 380

function findPanel(match) {
  const wanted = match.toLowerCase()
  const cards = [...document.querySelectorAll('.card')]
  return cards.find(c => c.querySelector('h2')?.textContent?.toLowerCase().includes(wanted)) || null
}

export function Tour({ role, section, onNavigate, onFinish }) {
  const steps = TOURS[role] || []
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  // 'searching' and 'missing' look identical in the DOM (no rect) but mean
  // opposite things to a reader. Without this the "not on screen" warning
  // flashes on EVERY step while the panel is still being located.
  const [hunt, setHunt] = useState('searching')
  const timer = useRef(null)
  const step = steps[i]

  const finish = useCallback((completed) => {
    clearTimeout(timer.current)
    onFinish(completed)
  }, [onFinish])

  // Move to the step's tab, then wait for its panel to render.
  useEffect(() => {
    if (!step) return
    let alive = true
    if (step.section && step.section !== section) onNavigate(step.section)

    const started = Date.now()
    const look = () => {
      if (!alive) return
      const el = findPanel(step.match)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        // Let the smooth scroll settle before measuring, or the hole lands
        // where the panel used to be.
        setTimeout(() => { if (alive) { setRect(el.getBoundingClientRect()); setHunt('found') } }, 320)
      } else if (Date.now() - started < FIND_MS) {
        timer.current = setTimeout(look, 140)
      } else {
        setRect(null); setHunt('missing')   // explain it anyway, centred
      }
    }
    setRect(null); setHunt('searching')
    timer.current = setTimeout(look, 120)
    return () => { alive = false; clearTimeout(timer.current) }
  }, [i, step, section, onNavigate])

  // Keep the hole on the panel while the page moves under it.
  useEffect(() => {
    if (!step) return
    const track = () => {
      const el = findPanel(step.match)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', track)
    window.addEventListener('scroll', track, true)
    return () => { window.removeEventListener('resize', track); window.removeEventListener('scroll', track, true) }
  }, [step])

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') finish(true)
      else if (e.key === 'ArrowRight') setI(n => Math.min(n + 1, steps.length - 1))
      else if (e.key === 'ArrowLeft') setI(n => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [steps.length, finish])

  if (!step) return null
  const last = i === steps.length - 1

  // Place the card under the panel, or above it when there is no room below.
  let cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
  if (rect) {
    const below = window.innerHeight - rect.bottom > 210
    const left = Math.min(Math.max(rect.left, 16), Math.max(16, window.innerWidth - CARD_W - 16))
    cardStyle = below
      ? { left, top: rect.bottom + PAD + 12 }
      : { left, top: Math.max(16, rect.top - PAD - 200) }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of ${steps.length}`}>
      {rect
        ? <div className="tour-hole" style={{
            left: rect.left - PAD, top: rect.top - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          }} />
        : <div className="tour-dim" />}

      <div className="tour-card" style={cardStyle}>
        <div className="tour-count">Step {i + 1} of {steps.length}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {hunt === 'missing' && <p className="tour-missing">This panel is not on screen right now — it appears once there is data for it.</p>}
        <div className="tour-actions">
          <button className="btn ghost sm" onClick={() => finish(true)}>Skip tour</button>
          <div style={{ flex: 1 }} />
          {i > 0 && <button className="btn ghost sm" onClick={() => setI(i - 1)}>Back</button>}
          <button className="btn sm" onClick={() => (last ? finish(true) : setI(i + 1))}>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
