// Per-role navigation config → routes /app/<section>.
// The first entry of every role is its console: headline figures, the map and
// what is waiting on a decision. `icon` names a drawing in console/kit.jsx.
export const ROLE_NAV = {
  government: [
    { key: 'overview',  label: 'Overview',           icon: 'home' },
    { key: 'regional',  label: 'Regional',           icon: 'satellite' },
    { key: 'knowledge', label: 'Knowledge Hub',      icon: 'users' },
    { key: 'reports',   label: 'Evidence & reports', icon: 'chart' },
  ],
  hotel: [
    { key: 'overview',   label: 'Overview',           icon: 'home' },
    { key: 'management', label: 'Response approvals', icon: 'doc' },
    { key: 'finance',    label: 'Financials',         icon: 'trend' },
    { key: 'reports',    label: 'Reports',            icon: 'chart' },
  ],
  recovery_hub: [
    { key: 'overview',  label: 'Dispatch board', icon: 'home' },
    { key: 'batches',   label: 'Batch records',  icon: 'db' },
  ],
  processor: [
    { key: 'certification', label: 'Certification', icon: 'shield' },
    { key: 'passports',     label: 'Passports',     icon: 'doc' },
    { key: 'closure',       label: 'Closure',       icon: 'scale' },
    { key: 'certificate',   label: 'Certificate',   icon: 'clipboard' },
  ],
  university_lab: [
    { key: 'workspace', label: 'Research workspace', icon: 'gear' },
    { key: 'results',   label: 'Results',            icon: 'chart' },
  ],
  buyer: [
    { key: 'exchange',   label: 'Feedstock marketplace', icon: 'cart' },
  ],
  finance: [
    { key: 'book',        label: 'Book',        icon: 'db' },
    { key: 'instruments', label: 'Instruments', icon: 'doc' },
    { key: 'record',      label: 'Record',      icon: 'chart' },
  ],
}

// The platform administrator's own menu: the two administration consoles, then
// the jurisdiction tabs of the organisation the administrator belongs to.
export const ADMIN_NAV = [
  { key: 'overview', label: 'Overview',          icon: 'home' },
  { key: 'admin',    label: 'Regional overview', icon: 'target' },
]

// Title and strapline shown at the top of each role's pages.
export const ROLE_TITLE = {
  government:     ['Government Console', 'Coastal exposure, public-health review and response oversight.'],
  hotel:          ['Hotel Operations', 'Protect beach access. Coordinate response.'],
  recovery_hub:   ['Recovery Operations', 'Dispatch crews. Track collection. Receive biomass.'],
  processor:      ['Processor Certification', 'Evidence in. Standing computed. Certificate out.'],
  university_lab: ['Research Workspace', 'Validate forecasts. Improve evidence. Explain uncertainty.'],
  buyer:          ['Biomass Exchange', 'Find suitable feedstock. Verify quality. Plan intake.'],
  finance:        ['Finance Desk', 'Underwrite against verified performance.'],
  command:        ['Command Centre', 'Coastal intelligence • Response coordination • Biomass recovery'],
  admin:          ['Regional Administration', 'Coordinate the network. Resolve exceptions. Govern access.'],
}

// Where each role goes to act on what is waiting for it.
export const ACT_ON = { government: 'overview', hotel: 'overview', recovery_hub: 'overview', university_lab: 'workspace' }

export function defaultSection(role) {
  return (ROLE_NAV[role] && ROLE_NAV[role][0]?.key) || 'overview'
}
