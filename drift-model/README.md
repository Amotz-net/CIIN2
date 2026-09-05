# CIIN Drift Model (full — scaffold for later)

This is the **real** Sargassum drift model, to replace the first-order approximation
currently running in the `feeds` Edge Function (`drift` route). It is a scheduled
Python job, NOT an Edge Function — Edge Functions can't run OpenDrift/OceanParcels.

## What it does (per the research doc, "minimum credible version")
1. Ingest AFAI-detected patches (from NOAA CoastWatch, same source the app uses).
2. Advect them forward 3–7 days using free surface currents (HYCOM / Copernicus /
   RTOFS) + ~1–3% windage, via **OpenDrift** (GPLv2) or **OceanParcels** (MIT).
3. Write trajectory results (patch → coastal segment, arrival window, confidence)
   to a Supabase table the app reads.

## Honest scope
- Output: **directional trajectory + qualitative arrival window + confidence tier.**
- NOT tonnage-with-a-clock. Tonnage needs an AFAI→biomass conversion (large error)
  plus a beaching model (weak nearshore). Do not fabricate a precise tonnes/ETA.
- Confidence ladder: detection = high · 3-day drift = moderate · beaching loc/time =
  low/experimental. Label every output with its tier.

## Where it runs (pick one)
- GitHub Actions cron (free, simplest for a daily batch)
- A small always-on worker (Render/Railway/Fly) or a cloud VM
- Supabase scheduled functions if/when they support this weight

## Stack
- Python 3.11+, `opendrift` or `parcels`, `xarray`, `netCDF4`, `numpy`
- Forcing: HYCOM GOFS 3.1 (OPeNDAP), or Copernicus SMOC (currents+Stokes+tidal),
  or NOAA RTOFS (8-day forecast on AWS Open Data)
- Writes to Supabase via the service-role key (server-side only)

## Build steps (when ready)
1. `pip install opendrift xarray netCDF4 numpy supabase`
2. Subclass OceanDrift (OpenDrift) or write a Parcels kernel: current advection +
   windage (~2%) + optional Stokes; add a beaching/deletion kernel at the coast.
3. Seed particles at AFAI patch centroids near your coasts.
4. Run daily; for each affected coastal segment, store: bearing, arrival window,
   confidence, run timestamp.
5. Point the app's Drift panel at the Supabase table instead of the Edge Function's
   first-order route (drop-in: same panel, richer data).

## Licence note
OpenDrift is GPLv2 — running it server-side to generate forecasts you display does
NOT require open-sourcing your app (copyleft triggers on distribution, not SaaS use).
Keep it a separate service; attribute. OceanParcels is MIT (no copyleft concern).
Get legal review before launch.

## References (from the research doc)
- OpenDrift: Dagestad et al., Geosci. Model Dev. 11, 1405 (2018), GPLv2
- OceanParcels: Lange & van Sebille (2017), MIT; Tropical-Atlantic drifter code on GitHub
- Putman et al. 2020 (Caribbean validation): 3% windage → 15 km/14-day separation
