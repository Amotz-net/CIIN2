// =====================================================================
// Guided tour step lists, per role.
//
// A step points at a real panel by the text of its <h2>, not by a CSS hook, so
// the tour needs no markup changes in the seven role views and cannot silently
// break when one is restyled. If a panel is missing — a role with no data yet,
// a tab whose feature is not enabled — the step still shows, centred, rather
// than aborting the tour.
//
// `section` is the nav tab the step lives on; the tour navigates there first.
// =====================================================================

export const TOURS = {
  government: [
    { section: 'overview', match: 'Coast map',
      title: 'Your whole jurisdiction',
      body: 'Every beach segment coloured by live inundation risk, with hotels, hubs, processors and labs. Dashed arrows show 24 hours of observed drift. Toggle any layer from the panel on the map.' },
    { section: 'overview', match: 'Landfall watch',
      title: 'What is coming, and when',
      body: 'A live countdown to the next arrival window. If a beach is already inundated it counts up from the satellite observation instead and turns red. Green means nothing is projected inside the model’s 3-day horizon.' },
    { section: 'overview', match: 'Coastal Health Risk',
      title: 'Three scores, three honesty tiers',
      body: 'Each score carries the tier it deserves. Coastal Health is live from satellite. Carbon Credit is live-informed. Public Health is directional — there is no live H₂S or population feed behind it, and the label says so.' },
    { section: 'overview', match: 'CIIN Agent',
      title: 'The agent proposes; you decide',
      body: 'Six named agents each contribute one grounded statement with its source. The recommendation is reasoned over those facts. Approve, modify or reject — nothing dispatches without a named human.' },
    { section: 'knowledge', match: 'Knowledge Hub',
      title: 'Patterns nobody else can see',
      body: 'Findings mined across every organisation, published only above a k-anonymity floor. You see the pattern, never a single company’s record. Accepting a proposed rule review flags it for a standards owner — it never edits the grading rules itself.' },
    { section: 'reports', match: 'Reports',
      title: 'Take it away',
      body: 'Batches, missions and invoices as CSV, or print to PDF for a briefing pack.' },
  ],

  hotel: [
    { section: 'overview', match: 'Your coast',
      title: 'Your frontage, at real coordinates',
      body: 'Your beach segments coloured by live risk, with the hubs and processors around you. Scoped to your property — you see your coast, not the region.' },
    { section: 'overview', match: 'Inundation risk',
      title: 'Risk of reaching your shore',
      body: 'High, medium or low per segment, using NOAA CoastWatch’s published SIR thresholds. This is the risk of sargassum arriving — not a tonnage and not a landing time.' },
    { section: 'overview', match: 'Drift outlook',
      title: 'A window, not an arrival time',
      body: 'Bearing, speed and an arrival window from observed currents plus windage. A first-order projection over three days, labelled indicative because that is what it is.' },
    { section: 'management', match: 'Approval queue',
      title: 'This is your decision',
      body: 'Each mission was raised from a satellite reading and authorised by the coastal authority — but access to your frontage is yours to grant. Grant, grant with conditions, or decline. Nothing happens on your beach until you do.' },
    { section: 'management', match: 'Missions against your property',
      title: 'Who is responding',
      body: 'The full board: which hubs have taken the mission, how much of the load each carries, and where every mission stands.' },
    { section: 'invoices', match: 'Invoice ledger',
      title: 'What you have been billed',
      body: 'Everything a hub has invoiced you, outstanding and paid. You can see them in full but cannot mark them paid — settlement is confirmed by whoever issued the invoice.' },
    { section: 'finance', match: 'Financial trends',
      title: 'Spend against what it saved',
      body: 'Invoiced spend is measured; cost avoided is modelled. The ratio between them is a direction of travel, not a return — the panel says so beneath the figures.' },
  ],

  recovery_hub: [
    { section: 'overview', match: 'Capacity',
      title: 'Capacity that cannot drift',
      body: 'Your spare capacity is nominal minus tonnage already committed to live missions. It moves as you take work on, so it can never fall out of step with the mission board.' },
    { section: 'queue', match: 'Dispatched to you',
      title: 'Work ranked to your hub',
      body: 'Missions the agent raised from the satellite reading and ranked your hub to answer, with your share of the load. Acknowledge to tell the network you have it.' },
    { section: 'queue', match: 'Dispatched to you',
      title: 'Acknowledging is not starting',
      body: 'Start line appears only once the property has granted access. Claiming a mission and putting crews on someone’s beach are deliberately separate acts.' },
    { section: 'line', match: 'Active recovery line',
      title: 'Nine steps, advanced as you go',
      body: 'Receiving through to Shipment. Advance a step as you complete it; step nine closes the mission and unlocks invoicing.' },
    { section: 'invoices', match: 'Invoices you have issued',
      title: 'You bill, and you confirm payment',
      body: 'Recovery invoices to the hotel, transport and pre-processing to the processor — both from your published rate card. You mark them paid, because a payer confirming its own invoice would be self-certification.' },
    { section: 'batches', match: 'Batches',
      title: 'Grades are computed, not entered',
      body: 'Each batch is graded by the engine from arsenic, foreign matter, age and chain-of-custody evidence. Nobody types a grade in.' },
  ],

  processor: [
    { section: 'certification', match: 'Certification status',
      title: 'Standing you cannot assert',
      body: 'Your certification is computed from the evidence attached to what you have received. It moves when your inputs move — there is no button to declare yourself certified.' },
    { section: 'passports', match: 'Quality passports',
      title: 'Grade and permitted use',
      body: 'Per batch: its grade and the usage limits that follow. A B-grade batch is not a failure, it is a different permitted use.' },
    { section: 'closure', match: 'Closure ledger',
      title: 'Mass balance',
      body: 'What came in against what was accounted for, with a closure error percentage and a conforming, conditional or non-conforming state.' },
    { section: 'certificate', match: 'Certificate',
      title: 'Checkable by anyone',
      body: 'A printable credential. Anyone can verify it on the public page without an account — a credential nobody outside the network can check is not a credential.' },
  ],

  university_lab: [
    { section: 'queue', match: 'Sample queue',
      title: 'Batches waiting on you',
      body: 'Field-screened batches with no lab confirmation yet. Confirmation materially changes what happens to batches sitting near the arsenic ceiling — this queue is where that gets settled.' },
    { section: 'results', match: 'Confirmed results',
      title: 'Your result can re-grade a batch',
      body: 'A confirmed inorganic-arsenic figure can lift material that a total-arsenic screen had held back. Re-grades appear here with the result that caused them.' },
  ],

  buyer: [
    { section: 'market', match: 'Verified biomass',
      title: 'Buy against the passport',
      body: 'Every listing carries its quality passport, so you are buying against a computed grade and its usage limits rather than a description.' },
    { section: 'notoffered', match: 'Not offered',
      title: 'What is being withheld, and why',
      body: 'Material excluded by grade gating is named rather than quietly omitted. A marketplace that hides what failed tells you less than one that shows it.' },
  ],

  finance: [
    { section: 'book', match: 'Underwriting book',
      title: 'Your exposure',
      body: 'The underwriting summary across the network.' },
    { section: 'instruments', match: 'Instruments',
      title: 'Written on performance',
      body: 'Carbon credits, performance-based finance and insurance — each written against verified performance rather than projections.' },
    { section: 'record', match: 'Verified performance record',
      title: 'The evidence underneath',
      body: 'Recovered tonnage, grades and closure states: the basis your instruments are priced on, shown rather than summarised.' },
  ],
}

export const hasTour = (role) => Array.isArray(TOURS[role]) && TOURS[role].length > 0
