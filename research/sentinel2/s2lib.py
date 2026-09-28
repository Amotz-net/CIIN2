import json, base64, io, subprocess, os, numpy as np, tifffile
from scipy import ndimage as ndi
ENV = dict(l.strip().split('=',1) for l in open(os.path.expanduser('~/Downloads/ciin-dev/.env.local')) if '=' in l)
URL, KEY = ENV['VITE_SUPABASE_URL'], ENV['VITE_SUPABASE_ANON_KEY']
S = os.path.expanduser('~/ciin-s2-cache')

def fetch(site, bbox, date):
    path = f'{S}/{site}/{date}.tif'
    if os.path.exists(path): return tifffile.imread(path)
    out = subprocess.run(['curl','-s','--max-time','150',
        f'{URL}/functions/v1/sentinel?action=raster&bbox={bbox}&date={date}',
        '-H',f'Authorization: Bearer {KEY}','-H',f'apikey: {KEY}'], capture_output=True, text=True).stdout
    d = json.loads(out)
    if not d.get('ok'): raise RuntimeError(d)
    raw = base64.b64decode(d['tiff_b64'])
    open(path,'wb').write(raw)
    return tifffile.imread(io.BytesIO(raw))

# bands: 0 B02, 1 B03, 2 B04, 3 B8A, 4 B11, 5 B12, 6 SCL, 7 dataMask
def fai(a):
    r, n, s = a[...,2], a[...,3], a[...,4]
    return n - (r + (s - r) * (865 - 665) / (1610 - 665))

def truecolor(a):
    rgb = np.stack([a[...,2], a[...,1], a[...,0]], -1)
    return (np.clip(rgb / 0.25, 0, 1) ** 0.6 * 255).astype('uint8')

CLOUD_SCL = (0, 1, 3, 8, 9, 10, 11)   # no data, saturated, cloud shadow, cloud med/high, cirrus, snow

def masks(a):
    valid = (a[...,7] > 0) & ~np.isin(a[...,6].astype(int), CLOUD_SCL)
    water = valid & (a[...,4] < 0.10)                     # Wang & Hu pre-mask: Rrc1610 > 0.10 is land/cloud
    # H_SWIR cloud test (Wang & Hu 2021, eq. 2): locally bright in BOTH SWIR bands.
    # Background here = median over the water in the box (the paper's 200x200
    # window exceeds this box). Denoising step omitted; see notes.
    b11, b12 = a[...,4], a[...,5]
    bg11, bg12 = np.median(b11[water]) if water.any() else 0, np.median(b12[water]) if water.any() else 0
    cloud = (b11 - bg11 > 0.010) & (b12 - bg12 > 0.008)
    cloud = ndi.binary_dilation(cloud, np.ones((5, 5)))    # paper dilates 20x20 at 10 m = ~200 m; 5x5 at 20 m is ~100 m
    return water & ~cloud, valid

def residual(a, win=10):
    f = fai(a); w, _ = masks(a)
    if w.sum() < 50: return None, w
    filled = np.where(w, f, np.median(f[w]))
    bkg = ndi.median_filter(filled, size=win)
    r = np.where(w, f - bkg, np.nan)
    return r, w

def detect(r, w, k=2.0, floor=0.008, min_px=3):
    loc = np.where(w, np.nan_to_num(r), 0.0)
    m = ndi.uniform_filter(loc, 10); m2 = ndi.uniform_filter(loc**2, 10)
    sd = np.sqrt(np.maximum(m2 - m*m, 0))
    hit = w & (np.nan_to_num(r) > np.maximum(k * sd, floor))
    lab, n = ndi.label(hit)
    if n:
        sizes = ndi.sum(hit, lab, range(1, n+1))
        hit = np.isin(lab, 1 + np.nonzero(sizes >= min_px)[0])
    return hit
