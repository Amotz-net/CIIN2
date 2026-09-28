import sys, json, subprocess; sys.path.insert(0, sys.argv[1])
from s2lib import *
site, bbox, y0, y1 = sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
os.makedirs(f'{S}/{site}', exist_ok=True)
passes = []
for y in range(y0, y1 + 1):
    for (f, t) in [(f'{y}-01-01', f'{y}-06-30'), (f'{y}-07-01', f'{y}-12-31')]:
        out = subprocess.run(['curl','-s','--max-time','90', f'{URL}/functions/v1/sentinel?bbox={bbox}&from={f}&to={t}',
              '-H',f'Authorization: Bearer {KEY}','-H',f'apikey: {KEY}'], capture_output=True, text=True).stdout
        passes += [p for p in json.loads(out).get('passes', []) if (p['cloud_pct'] or 100) < 30]
dates = sorted({p['date'][:10] for p in passes}); plat = {p['date'][:10]: p['platform'] for p in passes}
res = []
for d in dates:
    try: a = fetch(site, bbox, d)
    except Exception as e: print('skip', d, str(e)[:80]); continue
    r, w = residual(a, 25)
    if r is None or w.sum() < 0.3 * w.size: continue
    hit = detect(r, w, 0, 0.015, 2)
    res.append({'date': d, 'platform': plat[d], 'water': int(w.sum()), 'hit': int(hit.sum()),
                'pct': 100 * hit.sum() / w.sum(), 'resid_sum': float(np.nansum(np.where(hit, r, 0)))})
json.dump(res, open(f'{S}/{site}_results.json', 'w'))
print(site, 'clear passes analysed:', len(res))
