// =====================================================================
// Live NOAA weather — real api.weather.gov (NWS API v2.5).
// This is a GENUINELY LIVE feed (not seeded). Free, no API key; a
// User-Agent header is required by NWS. Two-step: point -> gridpoint -> forecast.
// Weather INFORMS drift and the recovery window; it does NOT locate sargassum.
// =====================================================================

const UA = 'CIIN-CaribbeanSargassumNetwork (contact: ops@watersolutions.example)'

// NWS coverage note: api.weather.gov covers the US and territories. For
// non-US Caribbean coasts the point lookup may 404 — callers should handle
// the null return and show "weather feed unavailable for this location".
export async function getForecast(lat, lng) {
  try {
    // 1) resolve the grid for this coordinate
    const pointRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/geo+json' },
    })
    if (!pointRes.ok) return { ok: false, reason: `NWS point lookup ${pointRes.status}` }
    const point = await pointRes.json()
    const forecastUrl = point?.properties?.forecast
    if (!forecastUrl) return { ok: false, reason: 'No forecast grid for this location' }

    // 2) fetch the forecast periods
    const fRes = await fetch(forecastUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/geo+json' },
    })
    if (!fRes.ok) return { ok: false, reason: `NWS forecast ${fRes.status}` }
    const f = await fRes.json()
    const periods = (f?.properties?.periods ?? []).slice(0, 4).map(p => ({
      name: p.name,
      temp: `${p.temperature}°${p.temperatureUnit}`,
      wind: `${p.windSpeed} ${p.windDirection}`,
      short: p.shortForecast,
      isDay: p.isDaytime,
    }))
    return { ok: true, periods, source: 'live_feed' }
  } catch (e) {
    return { ok: false, reason: 'Weather request failed' }
  }
}
