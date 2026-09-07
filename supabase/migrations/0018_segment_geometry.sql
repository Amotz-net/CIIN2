-- ---------------------------------------------------------------
-- Real coastline geometry for beach segments.
--
-- Until now a segment was a POINT (lat/lng) plus a length. The coast map could
-- therefore only draw a marker; any shoreline it drew would have been invented,
-- and an invented shoreline on a government dashboard reads as survey data.
--
-- `path` holds the actual traced shoreline for the segment so the map can draw
-- a risk-coloured ribbon along the real coast. NULL is a first-class value: no
-- geometry means the map falls back to the point marker.
-- ---------------------------------------------------------------
alter table beach_segments add column if not exists path jsonb;

comment on column beach_segments.path is
  'Coastline polyline: JSON array of [lat,lng] pairs ordered along the shore. '
  'Sourced from OpenStreetMap natural=coastline (ODbL, attribution required) and '
  'clipped to length_m about the segment point by scripts/coastline.mjs. '
  'NULL = untraced; the map draws a point marker rather than an invented shoreline.';

-- Shape guard: an array or nothing. Cheap, and stops a stray object or string
-- reaching the renderer as geometry.
alter table beach_segments drop constraint if exists beach_segments_path_is_array;
alter table beach_segments add constraint beach_segments_path_is_array
  check (path is null or jsonb_typeof(path) = 'array');
