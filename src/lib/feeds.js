// =====================================================================
// Client for the CIIN "feeds" Edge Function via supabase.functions.invoke().
// Params passed in the BODY (reliable) rather than a query string.
// invoke() attaches the correct auth + apikey headers automatically.
// =====================================================================
import { supabase } from './supabase'

async function callFeed(feed, lat, lng) {
  try {
    const { data, error } = await supabase.functions.invoke('feeds', {
      body: { feed, lat, lng },
    })
    if (error) return { ok: false, reason: error.message || 'feed error', source: 'live_feed' }
    return data
  } catch (e) {
    return { ok: false, reason: 'feed unreachable', source: 'live_feed' }
  }
}

export const getForecast = (lat, lng) => callFeed('weather', lat, lng)
export const getAfai = (lat, lng) => callFeed('afai', lat, lng)

export const AFAI_ATTRIBUTION =
  'USF Optical Oceanography Lab (AFAI), redistributed by NOAA CoastWatch–AOML. ' +
  'Reflectance index, not ground truth; may contain inaccuracies (US Government work).'
