# Ríos de Guadalajara

Interactive satellite map of the Lerma–Chapala–Santiago system around Guadalajara, opening on Jalisco state: the named rivers of Mexico and state borders (Natural Earth), rivers to the Pacific, CONAGUA watersheds and aquifers, INEGI municipal limits, pollution (SEMARNAT RETC industry, CONAGUA/CEA water quality, discharges, hotspots), SIAPA water infrastructure, Lake Chapala levels and the Barranca de Huentitán.

- View: `node .claude/serve.js`, then open http://localhost:8766
- Rebuild map data from the research files: `node source/build.mjs`
- `source/rios-data/` holds the compiled research (sources and caveats are inside each JSON's `meta`/`caveats`).

## Features
- **Why polluted**: six story stops, then **Key facts**: 20 facts, each flies the map to where it happened (map views set in `source/build.mjs`, `FACTVIEW`).
- **Air pollution over time** button: NASA GIBS tiles with a time slider: haze/aerosols (MERRA-2, monthly 1980–2026), carbon monoxide (MOPITT, monthly 2000–2024), nitrogen dioxide (Sentinel-5P TROPOMI, daily 2018–2026). These are coarse (50–100 km per pixel for the monthly ones).
- **Topography**: relief shading (on) and 3D terrain (Layers → Base map), from AWS Terrain Tiles. The pad under the zoom buttons tilts, rotates and moves the camera.
- Clicking a feature opens a docked details card (top right); click empty map, press Esc or × to close.

## Rebuilding needs three Natural Earth files (not in the repo)
Download into `source/rios-data/` from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson (public domain), then run `node source/build.mjs`:
`ne_10m_rivers_lake_centerlines.geojson`, `ne_10m_rivers_north_america.geojson`, `ne_10m_admin_1_states_provinces.geojson`.

Live site: https://daniellacamarena.github.io/rios-guadalajara/
