// =====================================================================
// CIIN catalogue import — loads the reference lists that ship with it.
//
// The data is inside this function, so calling it can only ever load that
// data: running it twice changes nothing. It takes no input.
//
//   beaches.json  NEPA Jamaica Beach Guide list, located with OpenStreetMap
//   hotels.json   OpenStreetMap hotels, guest houses and similar (ODbL)
//
// Deploy: supabase functions deploy catalogue-import --no-verify-jwt
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import beaches from './beaches.json' with { type: 'json' }
import hotels from './hotels.json' with { type: 'json' }

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const out: Record<string, unknown> = {}
  const b = await admin.from('beaches').upsert(beaches as any[], { onConflict: 'country_code,name,parish' })
  out.beaches = b.error ? b.error.message : (beaches as any[]).length
  let n = 0
  for (let i = 0; i < (hotels as any[]).length; i += 200) {
    const h = await admin.from('hotels').upsert((hotels as any[]).slice(i, i + 200), { onConflict: 'osm_ref' })
    if (h.error) { out.hotels_error = h.error.message; break }
    n += Math.min(200, (hotels as any[]).length - i)
  }
  out.hotels = n
  return new Response(JSON.stringify({ ok: !b.error && !out.hotels_error, ...out }), { headers: { 'Content-Type': 'application/json' } })
})
