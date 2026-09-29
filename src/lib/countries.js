// Countries and territories an organisation can belong to. `name` matches the
// name SATsum uses for that country's waters, so regional figures line up.
// `box` is [south, west, north, east], used to frame the map on the island.
export const COUNTRIES = [
  ['AG', 'Antigua and Barbuda', [16.9, -62.4, 17.8, -61.6]],
  ['AI', 'Anguilla', [18.1, -63.5, 18.7, -62.8]],
  ['AW', 'Aruba', [12.3, -70.2, 12.7, -69.8]],
  ['BS', 'Bahamas', [20.9, -79.5, 27.3, -72.7]],
  ['BB', 'Barbados', [12.95, -59.75, 13.4, -59.35]],
  ['BZ', 'Belize', [15.8, -89.3, 18.5, -87.4]],
  ['KY', 'Cayman Islands', [19.2, -81.5, 19.8, -79.7]],
  ['CU', 'Cuba', [19.7, -85.1, 23.4, -74.0]],
  ['CW', 'Curaçao', [12.0, -69.2, 12.4, -68.7]],
  ['DM', 'Dominica', [15.2, -61.5, 15.7, -61.2]],
  ['DO', 'Dominican Republic', [17.4, -72.1, 20.0, -68.2]],
  ['GD', 'Grenada', [11.95, -61.85, 12.6, -61.35]],
  ['GP', 'Guadeloupe', [15.8, -61.9, 16.6, -61.0]],
  ['HT', 'Haiti', [17.9, -74.6, 20.2, -71.6]],
  ['HN', 'Honduras', [15.3, -88.4, 16.6, -83.1]],
  ['JM', 'Jamaica', [17.6, -78.5, 18.6, -76.1]],
  ['MQ', 'Martinique', [14.35, -61.3, 14.9, -60.8]],
  ['MX', 'Mexico', [18.0, -89.5, 21.7, -86.6]],
  ['PR', 'Puerto Rico', [17.85, -67.35, 18.55, -65.2]],
  ['KN', 'Saint Kitts and Nevis', [17.05, -62.9, 17.45, -62.5]],
  ['LC', 'Saint Lucia', [13.7, -61.1, 14.15, -60.85]],
  ['VC', 'Saint Vincent and the Grenadines', [12.55, -61.5, 13.4, -61.1]],
  ['TT', 'Trinidad and Tobago', [10.0, -61.95, 11.4, -60.45]],
  ['TC', 'Turks and Caicos Islands', [21.1, -72.5, 22.0, -71.0]],
  ['VG', 'British Virgin Islands', [18.3, -64.85, 18.8, -64.25]],
  ['VI', 'United States Virgin Islands', [17.65, -65.1, 18.45, -64.55]],
].map(([code, name, box]) => ({ code, name, box, centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] }))

export const countryOf = code => COUNTRIES.find(c => c.code === code) || null
export const COUNTRY = Object.fromEntries(COUNTRIES.map(c => [c.code, c.name]))
export const CENTRE = Object.fromEntries(COUNTRIES.map(c => [c.code, c.centre]))
// Roles that choose their own country when they join.
export const CHOOSES_COUNTRY = ['hotel', 'government']
