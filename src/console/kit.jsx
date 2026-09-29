// Building blocks shared by every role's console: icons, headline tiles,
// panels, status chips, small charts. One set, so every role reads as the same
// system.

const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  waves: 'M2 8c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1M2 13c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1M2 18c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5-1',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  building: 'M4 21V5l8-2v18M12 9l8 2v10M2 21h20M7 8h2M7 12h2M7 16h2M15 14h2M15 18h2',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  pin: 'M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.800 7 12 7 12zM12 12.5a2.500 2.500 0 100-5 2.500 2.500 0 000 5z',
  leaf: 'M5 19c0-9 5-14 15-14 0 10-5 15-14 15zM5 19l8-8',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  trend: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  truck: 'M2 6h11v10H2zM13 9h5l3 4v3h-8M6.500 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  db: 'M4 6c0-1.700 3.600-3 8-3s8 1.300 8 3-3.600 3-8 3-8-1.300-8-3zM4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 001.800 3h10.400a2 2 0 001.800-3l-5-9V3M7.500 15h9',
  gear: 'M12 15.500a3.500 3.500 0 100-7 3.500 3.500 0 000 7zM19 12l2-1-1-3-2 .500-1.500-1.500.500-2-3-1-1 2h-2l-1-2-3 1 .500 2L6 7.500 4 7 3 10l2 1v2l-2 1 1 3 2-.500L7.500 18l-.500 2 3 1 1-2h2l1 2 3-1-.500-2 1.500-1.500 2 .500 1-3-2-1z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.500 9a2.500 2.500 0 114 2c-1 .700-1.500 1.200-1.500 2.500M12 17.500v.010',
  users: 'M8 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 2.700-5 6-5s6 2 6 5M16 11a3 3 0 100-6M17 15c3 .300 5 2.200 5 5',
  shield: 'M12 3l8 3v6c0 5-3.400 8-8 9-4.600-1-8-4-8-9V6zM9 12l2 2 4-4',
  link: 'M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.500 9.500v.010',
  cart: 'M3 4h2l2.500 11h10L20 7H6.500M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z',
  clipboard: 'M8 4h8v3H8zM8 5H6v16h12V5h-2M9 12h6M9 16h6',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 1v4M12 19v4M1 12h4M19 12h4',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.010',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a4 4 0 000-8h-4a4 4 0 010-8',
  power: 'M12 3v9M6.500 6.500a8 8 0 1011 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  satellite: 'M4 10l6-6 4 4-6 6zM14 8l2-2M10 14l4 4 6-6-4-4M3 21c0-3.300 2.700-6 6-6M3 17a2 2 0 002 2',
  money: 'M12 3c4.400 0 8 1.300 8 3s-3.600 3-8 3-8-1.300-8-3 3.600-3 8-3zM4 6v12c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12c0 1.700 3.600 3 8 3s8-1.300 8-3',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  scale: 'M12 3v18M5 21h14M5 7h14M5 7l-3 7a3.500 3.500 0 007 0zM19 7l-3 7a3.500 3.500 0 007 0z',
  umbrella: 'M12 3a9 9 0 019 9H3a9 9 0 019-9zM12 12v7a2 2 0 01-4 0',
}
export function Icon({ name, size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.700"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      <path d={PATHS[name] || PATHS.grid} />
    </svg>
  )
}

export const fmt = n => Math.round(Number(n || 0)).toLocaleString()
export const money = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
export const nice = s => String(s || '').replace(/_/g, ' ')
export const shortDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'
export function eta(iso) {
  if (!iso) return '—'
  const h = Math.round((new Date(iso) - Date.now()) / 3.6e6)
  if (h <= 0) return 'due'
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}
export function ago(iso) {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso)) / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

// Headline tile. `meter` (0..1) draws the progress rule under the figure;
// `bars` draws the small strength indicator on the right.
export function Kpi({ icon, label, value, unit, sub, tone = 'teal', meter = null, bars = null }) {
  return (
    <div className={'k-kpi tone-' + tone}>
      <span className="k-kpi-ic"><Icon name={icon} size={30} /></span>
      <div className="k-kpi-body">
        <span className="k-kpi-l">{label}</span>
        <span className="k-kpi-v">{value}{unit && <small> {unit}</small>}</span>
        {(sub || meter != null) && <span className="k-kpi-s">
          {meter != null && <i className="k-meter"><b style={{ width: Math.max(0, Math.min(1, meter)) * 100 + '%' }} /></i>}
          {sub}</span>}
      </div>
      {bars != null && <span className="k-bars" aria-hidden="true">{[1, 2, 3, 4, 5].map(i =>
        <i key={i} className={i <= bars ? 'on' : ''} style={{ height: 5 + i * 4 }} />)}</span>}
    </div>
  )
}

export function Panel({ title, note, action, children, className = '', style }) {
  return (
    <section className={'k-panel ' + className} style={style}>
      {(title || action) && <header className="k-panel-h">
        <h3>{title}{note && <small>{note}</small>}</h3>{action}</header>}
      {children}
    </section>
  )
}

export const Chip = ({ tone = 'grey', children, solid = false }) =>
  <span className={'k-chip tone-' + tone + (solid ? ' solid' : '')}>{children}</span>

// What the panel would show, and why it is empty. Never a made-up figure.
export const Empty = ({ children }) => <div className="k-empty">{children}</div>

export const Source = ({ children }) => <div className="k-src">{children}</div>

// Label / value rows, as in the rail cards.
export function Facts({ rows }) {
  return <div className="k-facts">{rows.filter(Boolean).map(([ic, l, v, tone], i) => (
    <div key={i} className="k-fact"><Icon name={ic} size={17} /><span>{l}</span>
      <b className={tone ? 'tone-' + tone : ''}>{v}</b></div>))}</div>
}

// A rail card with a coloured mark, used for decisions, alerts and exceptions.
export function Notice({ icon = 'alert', tone = 'amber', title, when, lines = [], children }) {
  return (
    <div className={'k-notice tone-' + tone}>
      <span className="k-notice-ic"><Icon name={icon} size={18} /></span>
      <div className="k-notice-b">
        <div className="k-notice-t"><b>{title}</b>{when && <small>{when}</small>}</div>
        {lines.filter(Boolean).map((l, i) => <span key={i} className={i === 0 ? 'lead' : ''}>{l}</span>)}
        {children && <div className="k-actions">{children}</div>}
      </div>
    </div>
  )
}

// Steps along a line. state: done | now | todo. `count` shows a number in the
// node where a stage holds several items.
export function Steps({ steps }) {
  return (
    <div className="k-steps" style={{ gridTemplateColumns: `repeat(${steps.length},minmax(0,1fr))` }}>
      {steps.map((s, i) => (
        <div key={i} className={'k-step ' + (s.state || 'todo')}>
          <span className="k-node">{s.count != null ? s.count : s.state === 'done' ? <Icon name="check" size={14} /> : ''}</span>
          <b>{s.name}</b><span>{s.note}</span>
        </div>
      ))}
    </div>
  )
}

// Small line chart. rows: [{v}] with nulls as gaps; `dashed` rows continue the
// line as a projection. `levels` labels the vertical axis.
export function Spark({ rows = [], dashed = [], color = 'var(--amber)', dashColor = 'var(--teal)', height = 96, levels = null, fill = true, x0, x1, xm }) {
  const W = 300, H = height, P = { l: levels ? 38 : 6, r: 6, t: 8, b: 18 }
  const all = [...rows, ...dashed].map(r => r.v).filter(Number.isFinite)
  if (all.length < 2) return <Empty>Not enough readings to draw.</Empty>
  const top = Math.max(...all) * 1.12 || 1, n = rows.length + dashed.length
  const x = i => P.l + (i / (n - 1)) * (W - P.l - P.r), y = v => P.t + (1 - v / top) * (H - P.t - P.b)
  const runs = (list, off) => {
    const out = []; let cur = []
    list.forEach((r, i) => { if (Number.isFinite(r.v)) cur.push([x(i + off), y(r.v)]); else if (cur.length) { out.push(cur); cur = [] } })
    if (cur.length) out.push(cur); return out
  }
  const solid = runs(rows, 0)
  const lastSolid = solid.length ? solid[solid.length - 1][solid[solid.length - 1].length - 1] : null
  const proj = runs(dashed, rows.length).map((r, i) => (i === 0 && lastSolid ? [lastSolid, ...r] : r))
  const pts = r => r.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img">
      {levels && levels.map((l, i) => <text key={l} x={P.l - 6} y={P.t + (i / (levels.length - 1)) * (H - P.t - P.b) + 3}
        textAnchor="end" fontSize="9.500" fill="#9AA6A3">{l}</text>)}
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="#2C4450" />
      <line x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} stroke="#2C4450" />
      {fill && solid.map((r, i) => <polygon key={'f' + i} fill={color} opacity=".140"
        points={`${r[0][0]},${H - P.b} ${pts(r)} ${r[r.length - 1][0]},${H - P.b}`} />)}
      {solid.map((r, i) => <polyline key={i} points={pts(r)} fill="none" stroke={color} strokeWidth="1.800" strokeLinejoin="round" />)}
      {proj.map((r, i) => <polyline key={'p' + i} points={pts(r)} fill="none" stroke={dashColor} strokeWidth="1.800" strokeDasharray="2 4" strokeLinecap="round" />)}
      {dashed.length > 0 && lastSolid && <line x1={lastSolid[0]} x2={lastSolid[0]} y1={P.t} y2={H - P.b} stroke="#9AA6A3" strokeDasharray="2 3" />}
      {lastSolid && <circle cx={lastSolid[0]} cy={lastSolid[1]} r="3" fill={color} />}
      {x0 && <text x={P.l} y={H - 5} fontSize="9.500" fill="#9AA6A3">{x0}</text>}
      {xm && lastSolid && <text x={lastSolid[0]} y={H - 5} fontSize="9.500" fill="#9AA6A3" textAnchor="middle">{xm}</text>}
      {x1 && <text x={W - P.r} y={H - 5} fontSize="9.500" fill="#9AA6A3" textAnchor="end">{x1}</text>}
    </svg>
  )
}

export const LegendLine = ({ items }) => (
  <div className="k-legendline">{items.map(([c, l, dash]) =>
    <span key={l}><i style={{ borderTop: `2px ${dash ? 'dotted' : 'solid'} ${c}` }} />{l}</span>)}</div>
)

// The page frame: headline tiles, then the working area with a rail.
export function Console({ kpis, rail, children, below, railWidth = 330 }) {
  return (
    <div className="k-console">
      <div className="k-kpis">{kpis}</div>
      <div className="k-body" style={rail ? { gridTemplateColumns: `minmax(0,1fr) ${railWidth}px` } : { gridTemplateColumns: '1fr' }}>
        <div className="k-main">{children}</div>
        {rail && <aside className="k-rail">{rail}</aside>}
      </div>
      {below}
    </div>
  )
}
