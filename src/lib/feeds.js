// =====================================================================
// Client for the CIIN "feeds" Edge Function.
// Sends params BOTH in the query string AND the body, so it works regardless
// of how the runtime surfaces them. Uses supabase.functions.invoke() for
// correct auth headers; the query string is appended to the function name.
// =====================================================================
import { supabase } from './supabase'

async function callFeed(feed, lat, lng) {
  try {
    const qs = `feeds?feed=${feed}&lat=${lat}&lng=${lng}`
    const { data, error } = await supabase.functions.invoke(qs, {
      body: { feed, lat, lng },   // belt and suspenders
    })
    if (error) return { ok: false, reason: error.message || 'feed error', source: 'live_feed' }
    return data
  } catch (e) {
    return { ok: false, reason: 'feed unreachable', source: 'live_feed' }
  }
}

export const getForecast = (lat, lng) => callFeed('weather', lat, lng)
export const getAfai = (lat, lng) => callFeed('afai', lat, lng)
export const getDrift = (lat, lng) => callFeed('drift', lat, lng)

export const AFAI_ATTRIBUTION =
  'USF Optical Oceanography Lab (AFAI), redistributed by NOAA CoastWatch–AOML. ' +
  'Reflectance index, not ground truth; may contain inaccuracies (US Government work).'
