# Sentinel-2 near-shore sargassum detection (research, not in the product)

Goal: see sargassum in the last 20 km to shore, which the NOAA AFAI product cannot.

Method, after Wang & Hu (2021), "Automatic extraction of Sargassum features from
Sentinel-2 MSI images": FAI from B04/B8A/B11, SWIR pre-mask for land and cloud,
local median background (25 px at 20 m), threshold on the residual (0.015),
minimum patch of 2 pixels. The paper's TNRD denoising step is NOT implemented.

## Findings (2021-2025)

- Whole-box statistics fail: the shallow lagoon swamps the signal.
- Per-pixel detection follows visible windrows at Puerto Morelos.
- Puerto Morelos, 180 clear passes: near zero Oct-Mar, peak in June
  (median 0.56% of water), 2025 the highest year. Matches the known season.
- Long Bay, 135 clear passes: same shape, but only 10 passes in Jun-Aug, and
  its two highest days are artefacts (cloud edges on 2025-12-19; haze and
  land vegetation on 2025-07-10).
- A strict scene filter (cloud < 10% of sea, blue reflectance < 0.06) removes
  the artefacts but also every summer scene at both sites.

## Status

Not reliable enough at Long Bay to show users. Open problem: a haze/glint
filter that keeps good summer scenes.

## LANOT rule test (37 images, all bands saved)

Rule from Arellano-Verdejo et al. (2025), Sci. Rep. 15:8965, eq. 1:
(B8A < 0.07) and (B04 < 0.10) and (B11 < 0.05) and (B04 < B8A) and (B04 < B08),
with cloud removed by the L2A scene classification.

Result: as printed, the rule is not usable on its own. It flags 12-74% of the
water on clear WINTER days at Puerto Morelos and 12-28% at Long Bay, mostly
deep clear water, where reflectance is near zero and sensor noise alone makes
B04 < B8A true. The rule has upper limits but no minimum signal. The paper
mentions later entropy filtering and denoising; those steps are not specified.

On the same images the background-residual method (this folder) flagged
0.00-0.17% in winter and 0.5-5.7% on summer days with visible sargassum at
Puerto Morelos, and followed the visible mats.

Cost: 37 requests, 55.7 processing units (about 1.5 per image with 14 bands).
