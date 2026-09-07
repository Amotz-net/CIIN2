#!/usr/bin/env node
// =====================================================================
// Trace real shoreline for CIIN beach segments.
//
// Queries OpenStreetMap (Overpass) for natural=coastline ways near each
// segment point, picks the nearest way, and clips it to length_m centred on
// the point. Emits UPDATE statements for beach_segments.path — it writes
// nothing itself, so the change is reviewable before it touches the database.
//
// Data © OpenStreetMap contributors, ODbL. Attribution is already carried on
// the map's caption; keep it there.
//
// Usage:
//   node scripts/coastline.mjs segments.json > backfill.sql
//   echo '[{"name":"Long Bay","lat":18.27,"lng":-78.35,"length_m":900}]' \
//     | node scripts/coastline.mjs > backfill.sql
// =====================================================================

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
// Overpass rejects unidentified clients with 406 — same courtesy the feeds
// edge function extends to NOAA/NWS.
const UA = 'CIIN-CaribbeanSargassumNetwork/1.0 (coastline backfill; contact: ops@watersolutions.example)'
const R_EARTH_M = 6371000

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const la1 = toRad(a.lat), la2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h))
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Overpass is a free, shared, rate-limited service. Back off and retry rather
// than hammering it; a 429/406/504 here is throttling, not a missing coastline.
async function overpass(lat, lng, radius, attempt = 0) {
  const q = `[out:json][timeout:30];way(around:${radius},${lat},${lng})["natural"="coastline"];out geom;`
  const r = await fetch(ENDPOINT, { method: 'POST', body: 'data=' + encodeURIComponent(q),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) {
    if ([406, 429, 502, 504].includes(r.status) && attempt < 4) {
      await sleep(2000 * (attempt + 1))
      return overpass(lat, lng, radius, attempt + 1)
    }
    throw new Error(`Overpass ${r.status}`)
  }
  const j = await r.json()
  return (j.elements || []).filter(e => Array.isArray(e.geometry) && e.geometry.length > 1)
}

// Clip a way to `len` metres centred on the vertex nearest the segment point.
function clip(geometry, point, len) {
  let best = 0, bestD = Infinity
  geometry.forEach((g, i) => { const d = haversine(g, point); if (d < bestD) { bestD = d; best = i } })

  const half = len / 2
  let lo = best, hi = best, back = 0, fwd = 0
  while (lo > 0 && back < half) { back += haversine(geometry[lo], geometry[lo - 1]); lo-- }
  while (hi < geometry.length - 1 && fwd < half) { fwd += haversine(geometry[hi], geometry[hi + 1]); hi++ }

  return { pts: geometry.slice(lo, hi + 1), nearestM: bestD, spanM: Math.round(back + fwd) }
}

const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'"

async function main() {
  const file = process.argv[2]
  const raw = file
    ? await (await import('node:fs/promises')).readFile(file, 'utf8')
    : await new Promise((res) => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => res(d)) })

  const segments = JSON.parse(raw)
  const log = (m) => process.stderr.write(m + '\n')

  console.log('-- beach_segments.path backfill — traced from OpenStreetMap coastline (ODbL).')
  console.log(`-- generated ${new Date().toISOString()} by scripts/coastline.mjs`)
  console.log('begin;')

  for (const s of segments) {
    const len = s.length_m || 800
    let ways = []
    try {
      // Widen the search until a coastline way turns up; give up rather than
      // reach for something too far away to be this segment's shore.
      for (const radius of [400, 1200, 3000]) {
        ways = await overpass(s.lat, s.lng, radius)
        if (ways.length) break
        await sleep(1200)
      }
      await sleep(1200)
    } catch (e) { log(`!! ${s.name}: ${e.message}`); continue }

    if (!ways.length) { log(`-- ${s.name}: no OSM coastline within 3km — left untraced`); continue }

    const clips = ways.map(w => clip(w.geometry, { lat: s.lat, lon: s.lng }, len))
    clips.sort((a, b) => a.nearestM - b.nearestM)
    const c = clips[0]

    if (c.nearestM > 1500) { log(`-- ${s.name}: nearest coastline ${Math.round(c.nearestM)}m away — too far, left untraced`); continue }

    const coords = c.pts.map(p => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))])
    const off = Math.round(c.nearestM)
    log(`ok ${s.name}: ${coords.length} pts, ${c.spanM}m traced (point sits ${off}m off the line)`
      + (off > 300 ? '  <-- CHECK: stored coordinate is far from the real shoreline' : ''))
    // Key on id: segment names are not unique (duplicate seed rows exist), so a
    // name-keyed update would silently write the same geometry to several rows.
    const where = s.id ? `id = ${sqlStr(s.id)}::uuid` : `name = ${sqlStr(s.name)}`
    console.log(`-- ${s.name}: ${coords.length} pts, ${c.spanM}m`)
    console.log(`update beach_segments set path = ${sqlStr(JSON.stringify(coords))}::jsonb where ${where};`)
  }

  console.log('commit;')
}
main().catch(e => { process.stderr.write('failed: ' + e.message + '\n'); process.exit(1) })
