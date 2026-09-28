// =====================================================================
// CIIN Sentinel — Sentinel-2 access through the Copernicus Data Space.
// Step 1 (this file): authenticate and list recent passes over a beach.
// Credentials are Supabase secrets CDSE_CLIENT_ID / CDSE_CLIENT_SECRET and
// never leave the server.
// =====================================================================
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search'

async function token() {
  const id = Deno.env.get('CDSE_CLIENT_ID'), secret = Deno.env.get('CDSE_CLIENT_SECRET')
  if (!id || !secret) return { ok: false as const, reason: 'CDSE credentials not set' }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!r.ok) return { ok: false as const, reason: `auth ${r.status}`, detail: (await r.text()).slice(0, 200) }
  const j = await r.json()
  return { ok: true as const, access: j.access_token as string, expires_in: j.expires_in }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const u = new URL(req.url)
    const lat = parseFloat(u.searchParams.get('lat') ?? '18.305')
    const lng = parseFloat(u.searchParams.get('lng') ?? '-78.339')
    const days = Math.min(90, Number(u.searchParams.get('days') ?? 30))
    const t = await token()
    if (!t.ok) return json({ ok: false, stage: 'auth', ...t })
    const d = 0.03
    const end = new Date(), start = new Date(end.getTime() - days * 86400000)
    const r = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: [lng - d, lat - d, lng + d, lat + d],
        datetime: `${start.toISOString()}/${end.toISOString()}`,
        limit: 50,
        fields: { include: ['properties.datetime', 'properties.eo:cloud_cover'], exclude: [] },
      }),
    })
    if (!r.ok) return json({ ok: false, stage: 'catalog', reason: `catalog ${r.status}`, detail: (await r.text()).slice(0, 300) })
    const j = await r.json()
    const passes = (j.features ?? []).map((f: any) => ({
      date: f.properties?.datetime, cloud_pct: f.properties?.['eo:cloud_cover'],
    })).sort((a: any, b: any) => (a.date < b.date ? 1 : -1))
    return json({ ok: true, stage: 'catalog', token_expires_in: t.expires_in, days, passes })
  } catch (e) {
    return json({ ok: false, reason: 'sentinel failed', detail: String(e) }, 500)
  }
})
