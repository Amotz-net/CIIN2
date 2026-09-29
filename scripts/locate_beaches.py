#!/usr/bin/env python3
"""
Place the beaches on NEPA's Jamaica Beach Guide list.

The list gives a name, a parish and an owner, and no position. This script
places each beach as well as the open map allows and says how well it did:

  beach        a mapped beach carries the same name. The position is that beach.
  shore        the name belongs to a bay, village or landmark. The position is
               the nearest mapped beach to it, or failing that the nearest point
               on the coast. Right stretch of coast, not a surveyed beach.
  unlocated    nothing on the map carries the name. Left off the map.

Nothing here is a survey. A position marked `shore` can be a kilometre or two
from the bathing beach itself. Every row records what it was matched to and how
far it was moved, so a person who knows the coast can check it.

Inputs (data/jamaica/):
  nepa-beach-list.txt        the list, as published
  osm/beaches.json           OpenStreetMap natural=beach, Jamaica
  osm/coastline.json         OpenStreetMap natural=coastline, Jamaica
  osm/first-pass.json        place-name search results (Nominatim)
Output: data/jamaica/beaches.json and the copy the import function ships.

Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, re, difflib, os

ROOT = os.path.join(os.path.dirname(__file__), '..')
D = os.path.join(ROOT, 'data', 'jamaica')

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))

def norm(s):
    s = s.lower().replace('’', "'").replace("'", '')
    s = re.sub(r'\b(beach|park|public|bathing|the|and|bay)\b', ' ', s)
    return ' '.join(re.sub(r'[^a-z ]', ' ', s).split())

# Rough parish boxes (south, north, west, east). Used only to reject a match
# that lands in the wrong part of the island.
PARISH = {'Westmoreland': (18.1, 18.4, -78.4, -77.9), 'Hanover': (18.3, 18.5, -78.4, -77.95), 'St. James': (18.3, 18.55, -78.0, -77.7),
          'Trelawny': (18.2, 18.55, -77.8, -77.45), 'St. Ann': (18.2, 18.5, -77.5, -76.95), 'St. Mary': (18.1, 18.45, -77.1, -76.65),
          'Portland': (17.95, 18.3, -76.75, -76.2), 'St. Thomas': (17.8, 18.1, -76.75, -76.15), 'St. Andrew': (17.9, 18.15, -76.9, -76.55),
          'St. Catherine': (17.7, 18.25, -77.2, -76.8), 'Clarendon': (17.7, 18.25, -77.5, -77.1), 'Manchester': (17.8, 18.25, -77.7, -77.35),
          'St. Elizabeth': (17.8, 18.25, -78.0, -77.55)}
def inside(p, parish, pad=0.08):
    s, n, w, e = PARISH[parish]
    return s - pad <= p[0] <= n + pad and w - pad <= p[1] <= e + pad

# A mapped beach that is the listed beach under another spelling or name.
# Each is a judgement, written down so it can be challenged.
SAME_BEACH = {
    ('Bryan’s Bay Beach', 'Portland'): "Bryan's Bay Fishing Beach",
    ('Coral Gardens', 'St. James'): 'Coral Garden Community Beach',
    ("Dunn's River Falls and Park", 'St. Ann'): 'Dunns River Beach',
    ('Farquhar Beach', 'Clarendon'): 'Fraquhars Beach',
}
# A listed beach that is part of a larger mapped beach.
PART_OF = {
    ('Long Bay Beach Park', 'Westmoreland'): ('Seven Mile Beach', 'Long Bay at Negril is mapped as Seven Mile Beach'),
}
# Bays and places on the map that carry the beach's name. Position is the
# mapped feature; the beach is then placed on the shore nearest to it.
NAMED_PLACE = {
    ('Wards Bay Beach', 'Manchester'): ('Wards Bay (bay)', 17.8661, -77.5561),
    ('St. Margarets Bay Beach', 'Portland'): ("St Margaret's Bay (bay)", 18.1995, -76.5221),
    ('Spring Gardens', 'Portland'): ('Spring Garden (hamlet)', 18.2228, -76.6353),
    ('Robins Bay', 'St. Mary'): ('Robins Bay (bay)', 18.3045, -76.7988),
    ('Innis Bay Beach', 'Portland'): ('Innes Bay (bay)', 18.0156, -76.2707),
    ('Half Moon Bay Beach', 'Trelawny'): ('Half Moon Bay (bay)', 18.4963, -77.6662),
    ('Guts River', 'Manchester'): ('Gut River (hamlet)', 17.8613, -77.4661),
    ("Bull's Bay Beach", 'Hanover'): ('Bulls Bay (bay)', 18.4528, -78.2154),
    ('Mezgars Run Beach', 'St. Thomas'): ('Mezgar Garden (neighbourhood)', 17.9146, -76.6364),
}
NEAR_BEACH_KM, NEAR_COAST_KM = 1.5, 6.0

beaches_osm = json.load(open(os.path.join(D, 'osm', 'beaches.json')))['elements']
centre = lambda e: ((e.get('center') or e)['lat'], (e.get('center') or e)['lon'])
named = {e['tags']['name']: e for e in beaches_osm if e.get('tags', {}).get('name')}
coast = [(p['lat'], p['lon']) for w in json.load(open(os.path.join(D, 'osm', 'coastline.json')))['elements'] for p in w['geometry']]
first = {(x['name'], x['parish']): x for x in json.load(open(os.path.join(D, 'osm', 'first-pass.json')))}

def nearest(p, pts):
    best = min(pts, key=lambda q: (q[0] - p[0]) ** 2 + ((q[1] - p[1]) * math.cos(math.radians(p[0]))) ** 2)
    return best, km(p, best)

claimed = set()

def to_shore(anchor):
    """Nearest UNNAMED mapped beach if one is close, otherwise the nearest point on the coast.

    A mapped beach with a different name is never borrowed: that would put two
    listed beaches on one spot and claim a beach that belongs to another name.
    """
    # ...and an unnamed beach is given to one listed beach only.
    unnamed = [b for b in beaches_osm if not b.get('tags', {}).get('name') and f"{b['type']}/{b['id']}" not in claimed]
    e = min(unnamed, key=lambda b: km(anchor, centre(b)))
    if km(anchor, centre(e)) <= NEAR_BEACH_KM:
        claimed.add(f"{e['type']}/{e['id']}")
        return centre(e), 'nearest mapped beach (unnamed on the map)', f"{e['type']}/{e['id']}"
    p, d = nearest(anchor, coast)
    if d <= NEAR_COAST_KM:
        return p, 'nearest point on the coast', None
    return None, None, None

rows = []
for line in open(os.path.join(D, 'nepa-beach-list.txt'), encoding='utf-8'):
    name, parish, owner, lic = [x.strip() for x in line.rstrip('\n').split('|')]
    key = (name, parish)
    row = dict(country_code='JM', name=name, parish=parish, owner_name=owner or None, licensed=lic == 'Licensed',
               lat=None, lng=None, precision='unlocated', located_by=None, osm_ref=None,
               source='NEPA Jamaica Beach Guide, list of beaches')
    def place(p, precision, how, ref=None):
        row.update(lat=round(p[0], 6), lng=round(p[1], 6), precision=precision, located_by=how, osm_ref=ref)

    # 1. a mapped beach of the same name
    hit = None
    if key in SAME_BEACH:
        hit = named[SAME_BEACH[key]]
    else:
        c = [(difflib.SequenceMatcher(None, norm(name), norm(k)).ratio(), e) for k, e in named.items() if norm(k)]
        c = [(r, e) for r, e in c if r >= 0.86 and inside(centre(e), parish)]
        if c: hit = max(c, key=lambda x: x[0])[1]
    if hit:
        place(centre(hit), 'beach', f"Mapped beach “{hit['tags']['name']}”", f"{hit['type']}/{hit['id']}")
    elif key in PART_OF:
        e = named[PART_OF[key][0]]
        place(centre(e), 'shore', PART_OF[key][1], f"{e['type']}/{e['id']}")
    else:
        # 2. a named place, then the shore nearest to it
        anchor = what = None
        if key in NAMED_PLACE:
            what, la, lo = NAMED_PLACE[key]; anchor = (la, lo)
        elif first.get(key, {}).get('lat') is not None:
            f = first[key]; anchor = (f['lat'], f['lng'])
            what = name + ' ' + f['located_by'].replace('Place-name search ', '').replace('_', ' ')
        if anchor:
            p, how, ref = to_shore(anchor)
            if p: place(p, 'shore', f"{what}: {how}, {km(anchor, p):.1f} km away", ref)
            else: row['located_by'] = f"{what} is more than {NEAR_COAST_KM:.0f} km from the coast; not placed"
    rows.append(row)

for out in (os.path.join(D, 'beaches.json'), os.path.join(ROOT, 'supabase', 'functions', 'catalogue-import', 'beaches.json')):
    json.dump(rows, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)

by = {k: sum(1 for r in rows if r['precision'] == k) for k in ('beach', 'shore', 'unlocated')}
print(by)
far = [(r['name'], r['parish'], round(nearest((r['lat'], r['lng']), coast)[1], 2)) for r in rows if r['lat'] is not None]
print('furthest from the coast:', sorted(far, key=lambda x: -x[2])[:5])
for r in rows:
    print(('%-9s' % r['precision']), r['name'], '|', r['parish'], '|', r['located_by'], '|', r['lat'], r['lng'])
