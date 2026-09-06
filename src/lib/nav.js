// Per-role navigation config → routes /app/<section>.
// Government uses the new IA (map/carbon/reports built). Other roles use their
// currently-built sections; their expanded IA (invoices, processors, methods…)
// lands in the next pass once those panels exist — no tab leads to a blank screen.
export const ROLE_NAV = {
  government: [
    { key: 'overview',  label: 'Overview',      icon: '▦' },
    { key: 'knowledge', label: 'Knowledge Hub', icon: '✦' },
    { key: 'coast',     label: 'Coast Map',     icon: '≈' },
    { key: 'carbon',    label: 'Carbon',        icon: '♲' },
    { key: 'reports',   label: 'Reports',       icon: '§' },
  ],
  hotel: [
    { key: 'overview',  label: 'Overview',   icon: '▦' },
    { key: 'incoming',  label: 'Incoming',   icon: '≈' },
    { key: 'missions',  label: 'Missions',   icon: '⇉' },
    { key: 'grades',    label: 'Grades',     icon: '✦' },
  ],
  recovery_hub: [
    { key: 'overview',  label: 'Overview',   icon: '▦' },
    { key: 'queue',     label: 'Queue',      icon: '☰' },
    { key: 'line',      label: 'Line',       icon: '◎' },
    { key: 'batches',   label: 'Batches',    icon: '✦' },
  ],
  processor: [
    { key: 'certification', label: 'Certification', icon: '▦' },
    { key: 'passports',     label: 'Passports',     icon: '✦' },
    { key: 'closure',       label: 'Closure',       icon: '♲' },
    { key: 'certificate',   label: 'Certificate',   icon: '§' },
  ],
  university_lab: [
    { key: 'queue',    label: 'Sample queue', icon: '☰' },
    { key: 'results',  label: 'Results',      icon: '✦' },
  ],
  buyer: [
    { key: 'market',     label: 'Marketplace', icon: '▦' },
    { key: 'notoffered', label: 'Not offered', icon: '⃠' },
  ],
  finance: [
    { key: 'book',        label: 'Book',        icon: '▦' },
    { key: 'instruments', label: 'Instruments', icon: '§' },
    { key: 'record',      label: 'Record',      icon: '✦' },
  ],
}
export function defaultSection(role) {
  return (ROLE_NAV[role] && ROLE_NAV[role][0]?.key) || 'overview'
}
