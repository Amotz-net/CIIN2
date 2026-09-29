// Programme and research milestones. These are statements about the project,
// not readings from the database, so they are kept in one place and edited by
// hand. state: done | now | todo.
export const PROGRAMME = [
  { name: 'Prototype review', state: 'now', note: 'In progress' },
  { name: 'Pilot readiness', state: 'todo', note: 'Not started' },
  { name: 'Field validation', state: 'todo', note: 'Not started' },
  { name: 'Partner rollout', state: 'todo', note: 'Not started' },
]

export const RESEARCH = [
  { name: 'Ten-year baseline for each beach', status: 'Complete', tone: 'green' },
  { name: 'Near-shore detection test, Sentinel-2', status: 'Complete · not reliable at Long Bay', tone: 'amber' },
  { name: 'Back-test against 2026 beachings', status: 'Planned', tone: 'grey' },
  { name: 'Ground observation protocol', status: 'Planned', tone: 'grey' },
]

// The human gates the platform enforces. Each is a rule in the database or the
// grading engine, not a convention.
export const GATES = [
  { icon: 'bank', name: 'Government decision', rule: 'Health risk only', tone: 'red', covers: 'Severe or extreme' },
  { icon: 'users', name: 'Owner consent', rule: 'Required', tone: 'amber', covers: 'Site access' },
  { icon: 'flask', name: 'Laboratory result', rule: 'Required', tone: 'teal', covers: 'Verified grade' },
]
