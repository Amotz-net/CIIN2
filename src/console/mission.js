// How a mission reads at each point in the chain. One definition, used by every
// console, so a hotel and a hub describe the same mission the same way.

export const LINE_STEPS = ['Receiving', 'Weighing', 'De-sanding', 'Dewatering', 'Drying', 'Baling', 'Storage', 'Quality certification', 'Shipment']

export const TONE = { proposed: 'amber', authority_approved: 'blue', access_granted: 'teal', in_progress: 'teal', completed: 'green', rejected: 'red' }

export function stage(m) {
  if (m.status === 'rejected') return { key: 'rejected', label: 'Rejected', tone: 'red', next: 'None' }
  if (m.status === 'completed' || m.line_step >= 9) return { key: 'done', label: 'Completed', tone: 'green', next: 'Raise invoices' }
  if (m.status === 'in_progress' || m.line_step > 0) return { key: 'collecting', label: `Collecting · step ${m.line_step} of 9`, tone: 'teal', next: `Advance the line: ${LINE_STEPS[m.line_step] || 'finish'}` }
  if (m.status === 'proposed') return { key: 'authority', label: 'Awaiting authority', tone: 'amber', next: 'Authority to approve, modify or reject' }
  if (m.access_state === 'declined') return { key: 'declined', label: 'Access declined', tone: 'red', next: 'Owner declined access' }
  if (m.access_state === 'pending') return { key: 'owner', label: 'Awaiting owner', tone: 'amber', next: 'Owner to grant access to the frontage' }
  return { key: 'ready', label: 'Ready to start', tone: 'blue', next: 'Hub to start the line' }
}

// The six-step line shown on the consoles, for one mission.
export function chain(m, pool = [], batches = []) {
  if (!m) return null
  const st = stage(m).key
  const order = ['authority', 'owner', 'ready', 'collecting', 'done']
  const at = order.indexOf(st)
  const mine = batches.filter(b => b.mission_id === m.id)
  const acked = pool.some(p => p.accepted)
  const s = (done, now) => (done ? 'done' : now ? 'now' : 'todo')
  return [
    { name: 'Raised', note: 'From the satellite reading', state: 'done' },
    { name: 'Authority', note: 'Approve, modify or reject', state: s(at > 0, at === 0) },
    { name: 'Owner access', note: 'Consent for the frontage', state: s(at > 1, at === 1) },
    { name: 'Dispatch', note: acked ? 'Hub has acknowledged' : 'Hub to acknowledge', state: s(at > 2, at === 2) },
    { name: 'Collection', note: m.line_step > 0 ? `Step ${Math.min(9, m.line_step)} of 9` : 'Recovery line', state: s(at > 3, at === 3) },
    { name: 'Quality', note: mine.length ? `${mine.filter(b => b.confirmed).length} of ${mine.length} batches confirmed` : 'Sampling and grading',
      state: s(mine.length > 0 && mine.every(b => b.confirmed), mine.length > 0) },
  ]
}

// Tonnes each permitted-use channel could take, from graded batches.
export function byChannel(batches) {
  const out = {}
  for (const b of batches) for (const c of b.uses?.permitted ?? []) {
    out[c] = out[c] || { channel: c, t: 0, n: 0 }; out[c].t += Number(b.wet_mass_t || 0); out[c].n++
  }
  return Object.values(out).sort((a, b) => b.t - a.t)
}
export const CHANNEL_ICON = { anaerobic_digestion: 'leaf', biochar_pyrolysis: 'flask', construction_materials: 'building', non_food_bioplastics: 'grid',
  alginate_extraction: 'flask', biofertiliser: 'leaf', compost_for_sale: 'leaf', soil_amendment: 'leaf', controlled_disposal: 'alert' }
