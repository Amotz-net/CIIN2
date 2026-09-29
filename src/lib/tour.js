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

import { ROLE_NAV } from './nav.js'

export const TOURS = {
  government: [
    { section: 'overview', match: 'Sectors monitored',
      title: 'The jurisdiction at a glance',
      body: 'Four figures: how many beaches are watched, what is waiting on your review, which missions are not yet staffed or cleared, and how many beaches have a clear satellite reading today.' },
    { section: 'overview', match: 'Coastal sectors',
      title: 'Your coast, from the satellite',
      body: 'Each beach is coloured by the level offshore, on its own ten-year scale. Orange is sargassum afloat, drawn by CIIN from the satellite index and never closer than 20 km to land, where the reading cannot be trusted. Switch between Coast and Offshore at the bottom left.' },
    { section: 'overview', match: 'Public-health review',
      title: 'What needs your attention',
      body: 'The beach with the highest offshore level, what CIIN can and cannot tell you about it, and any mission that has no hub or no site access yet.' },
    { section: 'coast', match: 'Coast map',
      title: 'Your whole jurisdiction',
      body: 'Every beach segment coloured by live inundation risk, with hotels, hubs, processors and labs. Dashed arrows show 24 hours of observed drift. Toggle any layer from the panel on the map.' },
    { section: 'regional', match: 'Landfall watch',
      title: 'What is coming, and when',
      body: 'A live countdown to the next arrival window. If a beach is already inundated it counts up from the satellite observation instead and turns red. Green means nothing is projected inside the model’s 3-day horizon.' },
    { section: 'overview', match: 'Risk scores',
      title: 'Three scores, three honesty tiers',
      body: 'Each score carries the tier it deserves. Coastal Health is live from satellite. Carbon Credit is live-informed. Public Health is directional — there is no live H₂S or population feed behind it, and the label says so.' },
    { section: 'knowledge', match: 'Knowledge Hub',
      title: 'Patterns nobody else can see',
      body: 'Findings mined across every organisation, published only above a k-anonymity floor. You see the pattern, never a single company’s record. Accepting a proposed rule review flags it for a standards owner — it never edits the grading rules itself.' },
    { section: 'regional', match: 'Caribbean today',
      title: 'The whole Caribbean',
      body: 'Regional totals, where your country ranks, and a 10-day drift forecast. These figures come from SATsum, Mexico\u2019s national system, and each panel says so. CIIN\u2019s own reading is the Offshore outlook further down this page.' },
    { section: 'reports', match: 'Reports',
      title: 'Take it away',
      body: 'Batches, missions and invoices as CSV, or print to PDF for a briefing pack.' },
  ],

  hotel: [
    { section: 'overview', match: 'Arrival window',
      title: 'Four figures to start the day',
      body: 'When sargassum could arrive, whether your beaches are at risk, where the response plan stands, and what a cleanup is likely to cost.' },
    { section: 'overview', match: 'Your coastline',
      title: 'Your beaches, from the satellite',
      body: 'Each beach is coloured by the level offshore. Orange is sargassum afloat, never drawn closer than 20 km to land, where the satellite cannot be trusted. Use Beach and Offshore at the bottom left to change the view.' },
    { section: 'overview', match: 'Priority action',
      title: 'Your decision, first',
      body: 'If a mission is waiting on you, it is here with its date, tonnage, hub and estimated cost. Approve, approve with conditions, or decline.' },
    { section: 'forecast', match: 'Your coast',
      title: 'Your frontage, at real coordinates',
      body: 'Your beach segments coloured by live risk, with the hubs and processors around you. Scoped to your property — you see your coast, not the region.' },
    { section: 'forecast', match: 'Inundation risk',
      title: 'Risk of reaching your shore',
      body: 'High, medium or low per segment, using NOAA CoastWatch’s published SIR thresholds. This is the risk of sargassum arriving — not a tonnage and not a landing time.' },
    { section: 'forecast', match: 'Drift outlook',
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
    { section: 'overview', match: 'Hub capacity',
      title: 'Capacity that cannot drift',
      body: 'Committed tonnage is what you have already taken on across live missions, against your nominal capacity. It moves as you take work on, so it can never fall out of step with the mission board.' },
    { section: 'overview', match: 'Dispatch board',
      title: 'Every mission, by where it stands',
      body: 'Ready to start, waiting on someone else, collecting, and delivered. The bar on a card is progress along the nine-step line.' },
    { section: 'overview', match: 'Priority work order',
      title: 'The next thing to do',
      body: 'Accept a work order to tell the network you have it. Start the line once the property has granted access.' },
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
    { section: 'workspace', match: 'Observed offshore',
      title: 'Model beside observation',
      body: 'On the left, where the water is moving. On the right, what the satellite saw offshore. Neither is a measurement of the beach.' },
    { section: 'workspace', match: 'Validation review',
      title: 'What has and has not been validated',
      body: 'The forecast model is SATsum\u2019s, with SATsum\u2019s own account of its skill. CIIN has not yet checked it against beach records, and says so. Export the satellite series to work on it yourself.' },
    { section: 'queue', match: 'Sample queue',
      title: 'Batches waiting on you',
      body: 'Field-screened batches with no lab confirmation yet. Confirmation materially changes what happens to batches sitting near the arsenic ceiling — this queue is where that gets settled.' },
    { section: 'results', match: 'Confirmed results',
      title: 'Your result can re-grade a batch',
      body: 'A confirmed inorganic-arsenic figure can lift material that a total-arsenic screen had held back. Re-grades appear here with the result that caused them.' },
  ],

  buyer: [
    { section: 'exchange', match: 'Feedstock inventory',
      title: 'Everything on offer, and everything held back',
      body: 'Click a batch to see its passport on the right: grade, custody, laboratory result and the uses its grade permits.' },
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

// A step is kept only while the tab it lives on is still in that role's menu.
for (const role of Object.keys(TOURS)) TOURS[role] = TOURS[role].filter(st => (ROLE_NAV[role] || []).some(n => n.key === st.section))

export const hasTour = (role) => Array.isArray(TOURS[role]) && TOURS[role].length > 0
