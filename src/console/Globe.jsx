import { useEffect, useRef } from 'react'

// A dotted globe that turns while the agent works. Abstract on purpose: the
// dots are a sphere, not a map, and the amber band is where the Caribbean
// sits on it. It is decoration for the eye, not a reading.

const N = 1400
function points() {
  const out = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = phi * i
    const x = Math.cos(t) * r, z = Math.sin(t) * r
    const lat = Math.asin(y) * 180 / Math.PI, lon = Math.atan2(z, x) * 180 / Math.PI
    out.push({ x, y, z, carib: lat > 9 && lat < 27 && lon > -92 && lon < -58 })
  }
  return out
}

export function Globe({ busy = false, size = 300 }) {
  const el = useRef(null), speed = useRef(0.0025)
  useEffect(() => {
    const c = el.current, g = c.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = size * dpr; c.height = size * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const pts = points(), R = size * 0.42, cx = size / 2, cy = size / 2
    let a = 0, raf = 0, t0 = performance.now()
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = (now) => {
      const target = busy ? 0.012 : 0.0025
      speed.current += (target - speed.current) * 0.05
      a += speed.current
      const pulse = busy ? 0.5 + 0.5 * Math.sin((now - t0) / 260) : 0
      g.clearRect(0, 0, size, size)
      // a faint halo when working
      if (busy) { const h = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.25); h.addColorStop(0, `rgba(87,196,174,${0.10 + 0.08 * pulse})`); h.addColorStop(1, 'rgba(87,196,174,0)'); g.fillStyle = h; g.fillRect(0, 0, size, size) }
      const ca = Math.cos(a), sa = Math.sin(a), tilt = -0.35, ct = Math.cos(tilt), st = Math.sin(tilt)
      for (const p of pts) {
        const x1 = p.x * ca + p.z * sa, z1 = -p.x * sa + p.z * ca
        const y2 = p.y * ct - z1 * st, z2 = p.y * st + z1 * ct
        if (z2 < -0.05) continue
        const d = (z2 + 0.05) / 1.05
        const r = (0.7 + 1.5 * d) * (size / 300)
        g.beginPath(); g.arc(cx + x1 * R, cy - y2 * R, r, 0, Math.PI * 2)
        g.fillStyle = p.carib ? `rgba(224,169,79,${0.35 + 0.65 * d})` : `rgba(87,196,174,${0.12 + 0.55 * d})`
        g.fill()
      }
      if (!still) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [busy, size])
  return <canvas ref={el} style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />
}
