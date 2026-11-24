// Builds data/* for index.html from the research files in source/rios-data/.
// usage: node source/build.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const IN = path.join(here, 'rios-data'), OUT = path.join(here, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });
const rd = f => { const p = path.join(IN, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const wr = (f, o) => { fs.writeFileSync(path.join(OUT, f), JSON.stringify(o)); console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes'); };
const P = rd('pollution.json'), H = rd('hydro.json'), S = rd('siapa.json');
const fmt = n => typeof n === 'number' ? (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en') : +n.toFixed(2) + '') : String(n ?? '');
const pt = (layer, lat, lon, props) => (lat == null || lon == null || isNaN(+lat) || isNaN(+lon)) ? null :
  { type: 'Feature', properties: { layer, ...props }, geometry: { type: 'Point', coordinates: [+(+lon).toFixed(5), +(+lat).toFixed(5)] } };
const arr = v => Array.isArray(v) ? v : v ? [v] : [];
const srcs = o => [...new Set([...arr(o.sources), ...arr(o.source), ...arr(o.source_url), ...arr(o.source_urls)].flatMap(s => typeof s === 'string' ? (s.match(/https?:\/\/\S+/g) || [s]) : []))];

/* ---------- Douglas-Peucker ---------- */
function dp(p, tol) { if (p.length < 3) return p; const k = new Uint8Array(p.length); k[0] = k[p.length - 1] = 1; const st = [[0, p.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) { const [x, y] = p[i]; let u = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; u = Math.max(0, Math.min(1, u)); const d = Math.hypot(x - x1 - u * dx, y - y1 - u * dy); if (d > md) { md = d; mi = i; } }
    if (md > tol) { k[mi] = 1; st.push([a, mi], [mi, b]); } } return p.filter((_, i) => k[i]); }
const R = (p, f = 1e4) => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
function simp(g, tol, f) {
  const ring = (r, closed) => { let s = dp(r, tol).map(p => R(p, f)); if (closed && s.length < 4) s = [r[0], r[Math.floor(r.length / 3)], r[Math.floor(2 * r.length / 3)], r[0]].map(p => R(p, f)); return s; };
  if (g.type === 'Polygon') return { type: g.type, coordinates: g.coordinates.map(r => ring(r, 1)) };
  if (g.type === 'MultiPolygon') return { type: g.type, coordinates: g.coordinates.map(pl => pl.map(r => ring(r, 1))) };
  if (g.type === 'LineString') return { type: g.type, coordinates: ring(g.coordinates, 0) };
  if (g.type === 'MultiLineString') return { type: g.type, coordinates: g.coordinates.map(r => ring(r, 0)) };
  return g;
}

/* ---------- municipalities ---------- */
const ZMG = ['14039', '14120', '14098', '14101', '14097', '14070', '14044', '14051', '14124', '14030']; // AMG: GDL, Zapopan, Tlaquepaque, Tonalá, Tlajomulco, El Salto, Ixtlahuacán de los Membrillos, Juanacatlán, Zapotlanejo, Chapala? see below
const ZMGnames = ['Guadalajara', 'Zapopan', 'San Pedro Tlaquepaque', 'Tonalá', 'Tlajomulco de Zúñiga', 'El Salto', 'Ixtlahuacán de los Membrillos', 'Juanacatlán', 'Zapotlanejo', 'Acatlán de Juárez'];
const muni = { type: 'FeatureCollection', features: [] };
for (const [f, st] of [['jal_mun_s.json', 'Jalisco'], ['nay_mun_s.json', 'Nayarit']]) {
  const d = rd(f); if (!d) continue;
  for (const ft of d.features) {
    const zmg = st === 'Jalisco' && ZMGnames.includes(ft.properties.NOMGEO);
    muni.features.push({ type: 'Feature', geometry: ft.geometry, properties: { NOMGEO: ft.properties.NOMGEO, CVEGEO: ft.properties.CVEGEO, zmg,
      kind: `Municipality · ${st}`, name: ft.properties.NOMGEO,
      desc: zmg ? 'Part of the Guadalajara Metropolitan Area (AMG).' : '',
      rows: JSON.stringify([['INEGI key (CVEGEO)', ft.properties.CVEGEO], ['State', st]]),
      src: JSON.stringify(['INEGI Marco Geoestadístico 2022 (via github.com/PhantomInsights/mexico-geojson)']) } });
  }
}
wr('municipios.geojson', muni);

/* ---------- watersheds ---------- */
const C = rd('cuencas_rha8_conagua_dof2020.geojson');
const cinfo = Object.fromEntries((H?.regions?.cuencas || []).map(c => [c.id, c]));
if (C) {
  const feats = C.features.filter(f => f.properties.id_cuenca >= 1201 && f.properties.id_cuenca <= 1258 || cinfo[f.properties.id_cuenca]).map(f => {
    const p = f.properties, ci = cinfo[p.id_cuenca] || {};
    const deficit = /sin/i.test(p.clasif) || p.vol_disp < 0;
    return { type: 'Feature', geometry: simp(f.geometry, 0.004, 1e3), properties: {
      name: `${p.nom_cuenca}`, status: deficit ? 'deficit' : 'available', kind: `Watershed ${p.id_cuenca} · RH12 Lerma-Santiago · RHA VIII`,
      desc: [ci.role, deficit ? 'In deficit: more surface water is allocated than is available downstream.' : 'Small positive availability.'].filter(Boolean).join(' '),
      rows: JSON.stringify([['CONAGUA id', p.id_cuenca], ['Availability (DOF ' + (p.fecha_dof || '2020') + ')', `${fmt(p.vol_disp)} hm³/yr`], ['Class', p.clasif], ['Sub-region', p.nomsubcu], ...(ci.area_km2 ? [['Area', ci.area_km2 + ' km²']] : [])]),
      src: JSON.stringify(['https://dof.gob.mx/nota_detalle_popup.php?codigo=5600849', 'https://idefor.cnf.gob.mx/layers/geonode%3Acuencas_disp2020_ll']) } };
  });
  wr('cuencas.geojson', { type: 'FeatureCollection', features: feats });
}

/* ---------- rivers ---------- */
const rivers = rd('rivers.geojson');
const st = rd('streams_tributaries_osm.geojson');
const have = new Set(rivers.features.map(f => f.properties.name));
const extra = {};
for (const f of st?.features || []) {
  const n = (f.properties.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let name = null, cls = 'tributary';
  if (/bolanos/.test(n)) name = 'Río Bolaños';
  else if (/huaynamota/.test(n)) name = 'Río Huaynamota';
  else if (/ahogado/.test(n)) { name = 'Arroyo El Ahogado'; cls = 'urban'; }
  else if (/^rio blanco/.test(n)) { name = 'Río Blanco'; cls = 'urban'; }
  else if (/arroyo seco/.test(n)) { name = 'Arroyo Seco'; cls = 'urban'; }
  if (!name || have.has(name)) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  (extra[name] ||= { cls, lines: [] }).lines.push(...lines.map(l => dp(l, 0.00025).map(p => R(p, 1e5))));
}
// OSM routes the Lerma through the lake to Ocotlán; cut it at the lake mouth
for (const f of rivers.features) if (f.properties.name === 'Río Lerma') f.geometry.coordinates = f.geometry.coordinates.map(l => l.filter(p => p[0] > -102.745)).filter(l => l.length > 1);
for (const [name, g] of Object.entries(extra)) rivers.features.push({ type: 'Feature', properties: { name, cls: g.cls }, geometry: { type: 'MultiLineString', coordinates: g.lines } });
const usInfo = Object.fromEntries((H?.urban_streams?.items || []).map(i => [i.name.split(/[ (/]/).slice(0, 3).join(' ').toLowerCase(), i]));
const RIVERDESC = {
  'Río Grande de Santiago': ['Main river · 562 km (CONAGUA)', 'Leaves Lake Chapala at Ocotlán and runs north-west through the El Salto industrial corridor, past Guadalajara in the Barranca de Huentitán, through four hydro dams to the Pacific near San Blas, Nayarit. Its Jalisco reach is among the most polluted rivers in Mexico.', [['Length', '562 km (CONAGUA)'], ['Mean natural runoff', `${fmt(H?.santiago_course?.mean_flow_to_pacific?.conagua_mean_natural_runoff_hm3_yr)} hm³/yr (≈233 m³/s)`], ['Basin', '76,277 km²']], [H?.santiago_course?.length?.official_url]],
  'Río Lerma': ['Main river · inflow to Chapala', 'Drains the industrial Bajío (Estado de México, Querétaro, Guanajuato, Michoacán) and is Chapala’s main inflow. It brings municipal, industrial and agricultural waste into the lake that supplies most of Guadalajara’s water.', [], ['https://en.wikipedia.org/wiki/Lake_Chapala']],
  'Río Zula': ['Tributary · joins the Santiago at Ocotlán', 'Basin 1215 Río Zula is in deficit (−17.448 hm³/yr, DOF 2020). Carries Ocotlán–Arandas agro-industrial waste into the first km of the Santiago.', [], ['https://dof.gob.mx/nota_detalle_popup.php?codigo=5600849']],
  'Río Verde': ['Tributary · joins at Arcediano', 'Largest tributary near Guadalajara; joins the Santiago at the bottom of the Barranca de Huentitán. El Zapotillo dam on this river now sends water to the metro area.', [], []],
  'Canal Las Pintas': ['Urban drain · south metro', 'Open canal that drains south Guadalajara/Tlaquepaque towards Arroyo El Ahogado and then the Santiago above the Juanacatlán falls.', [], []],
};
for (const f of rivers.features) {
  const p = f.properties, d = RIVERDESC[p.name];
  const ui = Object.entries(usInfo).find(([k]) => p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(k.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(rio|arroyo) (de )?/, '').split(' ')[0]))?.[1];
  p.kind = d ? d[0] : p.cls === 'urban' ? 'Urban stream / drain' : 'Tributary';
  p.desc = d ? d[1] : ui ? `${ui.status || ''} ${ui.discharge || ''}`.trim() : '';
  p.rows = JSON.stringify(d ? d[2] : []);
  p.src = JSON.stringify([...(d ? d[3].filter(Boolean) : []), ...(ui ? srcs(ui) : []), 'OpenStreetMap contributors (ODbL)']);
}
wr('rivers.geojson', rivers);

/* ---------- Mexico: state borders + national rivers (Natural Earth 10m, public domain) ---------- */
const NEst = rd('ne_10m_admin_1_states_provinces.geojson');
if (NEst) {
  const mx = NEst.features.filter(f => f.properties.adm0_a3 === 'MEX');
  const SN = { 'Distrito Federal': 'Ciudad de México', 'México': 'Estado de México' };
  wr('states.geojson', { type: 'FeatureCollection', features: mx.filter(f => f.properties.name).map(f => ({ type: 'Feature', geometry: simp(f.geometry, 0.004, 1e3),
    properties: { name: SN[f.properties.name] || f.properties.name, jalisco: f.properties.name === 'Jalisco' } })) });
  // point-in-Mexico test (vertices within ~3 km of the border also count, so border rivers stay whole)
  const polysMx = mx.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => {
    const xs = p[0].map(q => q[0]), ys = p[0].map(q => q[1]); return { r: p[0], bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; });
  const inR = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const grid = new Map(), G = 0.1, TOL = 0.03;
  for (const { r } of polysMx) for (let i = 0; i < r.length - 1; i++) { const k = Math.floor(r[i][0] / G) + ',' + Math.floor(r[i][1] / G); (grid.get(k) || grid.set(k, []).get(k)).push([r[i], r[i + 1]]); }
  const nearBorder = (x, y) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [a, b] of grid.get((Math.floor(x / G) + dx) + ',' + (Math.floor(y / G) + dy)) || []) {
    const ex = b[0] - a[0], ey = b[1] - a[1], L = ex * ex + ey * ey; let u = L ? ((x - a[0]) * ex + (y - a[1]) * ey) / L : 0; u = Math.max(0, Math.min(1, u)); if (Math.hypot(x - a[0] - u * ex, y - a[1] - u * ey) < TOL) return true; } return false; };
  const inMx = ([x, y]) => x > -118.5 && x < -86.5 && y > 14.4 && y < 32.8 && (polysMx.some(p => x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && inR(x, y, p.r)) || nearBorder(x, y));
  // Natural Earth lost some accents; US-only rivers that touch the border are dropped
  const FIX = { 'Ro Grande de Santiago': 'Grande de Santiago', 'Pnuco': 'Pánuco', 'Purificacin': 'Purificación', 'Tuxpn': 'Tuxpan', 'Boland': 'Bolaños', 'Rio Grande': 'Bravo (Grande)', 'San Andres': 'San Andrés', 'Armeria': 'Armería', 'Sextin': 'Sextín', 'Chinipas': 'Chínipas', 'Alamos': 'Álamos', 'El Alamo': 'El Álamo', 'Tesechoacan': 'Tesechoacán' };
  const DROP = /^(Devils|Pecos|Hardy|null)$/;
  // rivers already drawn in detail from OSM near Guadalajara: skip the coarse copy there
  const local = rivers.features.map(f => ({ key: f.properties.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(rio|arroyo) (grande de )?/, ''), pts: f.geometry.coordinates.flat() }));
  const isLocal = (name, line) => { const k = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^grande de /, ''); const m = line[Math.floor(line.length / 2)];
    return local.some(l => l.key === k && l.pts.some(p => Math.abs(p[0] - m[0]) < 0.25 && Math.abs(p[1] - m[1]) < 0.25)); };
  const byName = new Map();
  for (const f of ['ne_10m_rivers_lake_centerlines.geojson', 'ne_10m_rivers_north_america.geojson']) for (const ft of rd(f)?.features || []) {
    if (!ft.geometry || !/River|Lake Centerline/.test(ft.properties.featurecla)) continue;
    let n = String(ft.properties.name ?? 'null').trim(); if (DROP.test(n)) continue;
    n = (FIX[n] || n).replace(/^R[ií]o /, '');
    const ls = ft.geometry.type === 'LineString' ? [ft.geometry.coordinates] : ft.geometry.coordinates;
    for (const l of ls) { let run = [];
      const flush = () => { if (run.length > 1 && !isLocal(n, run)) { const e = byName.get(n) || byName.set(n, { rank: 99, lines: [] }).get(n); e.rank = Math.min(e.rank, +ft.properties.scalerank || 12); e.lines.push(dp(run, 0.002).map(p => R(p, 1e4))); } run = []; };
      for (const p of l) inMx(p) ? run.push(p) : flush(); flush(); }
  }
  // join pieces that touch end-to-end, so labels have long lines to sit on
  const join = ls => { ls = ls.map(l => l.slice()); const k = p => p.join(); let merged = true;
    while (merged) { merged = false;
      for (let i = 0; i < ls.length && !merged; i++) for (let j = 0; j < ls.length && !merged; j++) { if (i === j) continue; const a = ls[i], b = ls[j];
        if (k(a.at(-1)) === k(b[0])) ls[i] = a.concat(b.slice(1));
        else if (k(a.at(-1)) === k(b.at(-1))) ls[i] = a.concat(b.slice(0, -1).reverse());
        else if (k(a[0]) === k(b[0])) ls[i] = b.slice(1).reverse().concat(a);
        else continue;
        ls.splice(j, 1); merged = true; } }
    return ls; };
  const mxr = [...byName].map(([n, e]) => ({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: join(e.lines) },
    properties: { name: 'Río ' + n, rank: e.rank, kind: 'River · Mexico', desc: '', rows: '[]', src: JSON.stringify(['Natural Earth 10m rivers (public domain), naturalearthdata.com']) } }));
  // smoothed copies only for placing names (the coarse lines bend too sharply for curved labels)
  const labs = mxr.map(f => ({ type: 'Feature', properties: { lab: true, name: f.properties.name, rank: f.properties.rank },
    geometry: { type: 'MultiLineString', coordinates: f.geometry.coordinates.map(l => dp(l, 0.05)).filter(l => l.length > 1) } }));
  wr('mx_rivers.geojson', { type: 'FeatureCollection', features: mxr.concat(labs) });
}

/* ---------- buried rivers (piped / culverted) ---------- */
{
  const SJD = H?.urban_streams?.items?.find(i => /San Juan de Dios/.test(i.name));
  const buried = [];
  const B = (name, coords, how, desc, src) => buried.push({ type: 'Feature', properties: { name, how, kind: 'Buried river · ' + (how === 'approx' ? 'route approximate' : how === 'street' ? 'under Calzada Independencia' : 'culvert mapped in OpenStreetMap'), desc, rows: '[]', src: JSON.stringify(src) }, geometry: { type: 'LineString', coordinates: coords } });
  // San Juan de Dios: centreline of Calzada Independencia Sur from Parque Agua Azul to the old Mercado San Juan de Dios
  const cz = rd('osm_sjd.json');
  if (cz) {
    const pts = cz.elements.filter(e => e.tags.highway && /Independencia/.test(e.tags.name)).flatMap(e => e.geometry).filter(p => p.lat >= 20.6625 && p.lat <= 20.6776);
    const bins = new Map(); for (const p of pts) { const k = Math.round(p.lat / 0.0006); (bins.get(k) || bins.set(k, []).get(k)).push(p); }
    const line = [...bins].sort((a, b) => a[0] - b[0]).map(([, ps]) => R([ps.reduce((a, p) => a + p.lon, 0) / ps.length, ps.reduce((a, p) => a + p.lat, 0) / ps.length], 1e5));
    const desc = `${SJD?.status || 'Piped since 1909.'} The city's founding river: it rose at Agua Azul and ran through the centre past the Mercado San Juan de Dios. Today it is a sewer-and-storm collector you cannot see.`;
    const src = [...(SJD?.sources || []), 'Route: Calzada Independencia, © OpenStreetMap contributors (ODbL)'];
    B('Río San Juan de Dios (buried 1909)', line, 'street', desc, src);
    B('Río San Juan de Dios (buried, route approximate)', [line.at(-1), [-103.3372, 20.6976]], 'approx', 'Exact underground route between the Mercado San Juan de Dios and the open channel near Av. de los Normalistas is not mapped; drawn as a straight line. ' + desc, src);
  }
  // other culverted reaches of named streams, and long unnamed ones
  const tn = rd('osm_buried.json');
  for (const e of tn?.elements || []) {
    const len = e.geometry.reduce((a, p, i, g) => i ? a + Math.hypot((p.lon - g[i - 1].lon) * 104, (p.lat - g[i - 1].lat) * 111) : 0, 0);
    const named = e.tags.name && e.tags.name.length > 2;
    if (!named && len < 0.3) continue;
    const n = named ? e.tags.name.replace(/^Ro /, 'Río ') : `Unnamed ${e.tags.waterway}`;
    B(n + ' (piped)', e.geometry.map(p => [+p.lon.toFixed(5), +p.lat.toFixed(5)]), 'osm', `A ${Math.round(len * 1000)} m stretch of ${n} that runs in a pipe or culvert under the city.`, ['https://www.openstreetmap.org/way/' + e.id]);
  }
  wr('buried.geojson', { type: 'FeatureCollection', features: buried });
}

/* ---------- points ---------- */
const pts = [];
const push = f => f && pts.push(f);
// industry
for (const f of P.facilities) {
  const r = f.retc || {};
  const cum = Object.entries(r.cumulative_releases_to_water_kg_2004_2022 || {}), sew = Object.entries(r.cumulative_transfers_to_sewer_kg_2004_2022 || {});
  const tot = cum.reduce((a, [, v]) => a + (+v || 0), 0) + 0.2 * sew.reduce((a, [, v]) => a + (+v || 0), 0);
  const size = Math.max(0, Math.min(5, Math.log10(tot + 1) - 0.5));
  const top = (e) => e.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${fmt(v)} kg`).join('; ');
  const rows = [['Municipality', f.municipality], ['Sector', f.sector], ['Activity', f.activity], ['Receiving water', f.receiving_water],
    ['Years releasing to water', (r.years_reporting_releases_to_water || []).join(', ') || '—'],
    ['Released to water 2004–22', cum.length ? top(cum) : '—'],
    ['Sent to sewer 2004–22', sew.length ? top(sew) : '—'],
    ['Location', `${f.coord_precision}${f.coord_source_detail ? ' — ' + f.coord_source_detail : ''}`]].filter(r => r[1]);
  push(pt('industry', f.lat, f.lon, { name: f.name, kind: 'Industrial facility · ' + (f.sector || ''), desc: f.alleged_or_reported, size: +size.toFixed(2), rows: JSON.stringify(rows), src: JSON.stringify(srcs(f)) }));
}
// water quality
const indLab = { DBO5_mg_L: 'BOD₅ mg/L', DQO_mg_L: 'COD mg/L', SST_mg_L: 'TSS mg/L', fecal_coliforms_NMP_100mL: 'Fecal coliforms MPN/100 mL', E_coli_NMP_100mL: 'E. coli MPN/100 mL', OD_percent: 'Dissolved O₂ %', toxicity_Daphnia_48h_UT: 'Toxicity Daphnia (UT)', toxicity_Vibrio_15min_UT: 'Toxicity Vibrio (UT)' };
for (const w of P.water_quality) {
  const blk = w.latest_2025 || w.period_2012_2025;
  const rows = [['Network', w.network], ['Water body', w.water_body], ['Municipality', w.municipality],
    ['Data', w.latest_2025 ? '2025' : w.period_2012_2025 ? '2012–2025 aggregate' : w.latest_year],
    ...(blk?.failing_parameters?.length ? [['Failing', blk.failing_parameters.join(', ')]] : []),
    ...Object.entries(blk?.indicators || {}).map(([k, v]) => [indLab[k] || k, `${fmt(v.value)} · ${v.class || ''}`]),
    ...(w.priority_points != null ? [['Priority points (CEA)', w.priority_points]] : []),
    ...(w.coord_note ? [['Location note', w.coord_note]] : [])];
  push(pt('wq', w.lat, w.lon, { name: w.name, kind: 'Water-quality station · ' + (w.id || ''), semaforo: w.semaforo_latest || '', desc: w.notes || w.indicators_note || '', rows: JSON.stringify(rows), src: JSON.stringify(srcs(w).concat(arr(w.source_files)).slice(0, 4)) }));
}
// discharges
for (const d of P.municipal_discharges) {
  const rows = [['Type', d.type], ['Operator', d.operator], ['Design capacity', d.design_capacity_L_s ? d.design_capacity_L_s.toLocaleString('en') + ' L/s' : null],
    ['Reported flow', d.reported_flows_L_s ? Object.entries(d.reported_flows_L_s).map(([k, v]) => `${k.replace('_', ' ')} ${v} L/s`).join(' · ') : null],
    ['Receives', d.receiving_water], ['Operating since', d.started], ['Location', d.coord_precision]].filter(r => r[1]);
  push(pt('discharge', d.lat, d.lon, { name: d.name, kind: 'Wastewater treatment / discharge', desc: arr(d.known_issues).join(' '), rows: JSON.stringify(rows), src: JSON.stringify(srcs(d)) }));
}
// hotspots
for (const h of P.hotspots) push(pt('hotspot', h.lat, h.lon, { name: h.name, short: h.name.split(/[(–,]/)[0].trim(), kind: 'Pollution hotspot', desc: h.description, rows: JSON.stringify(h.coord_precision ? [['Location', h.coord_precision]] : []), src: JSON.stringify(srcs(h)) }));
// santiago course
const SC = H.santiago_course;
for (const k of SC.key_points) push(pt('route', k.lat, k.lon, { name: k.name.replace(/\s*\(.*?\)\s*/g, ' ').trim(), kind: 'Río Santiago · ' + (k.km_from_outlet != null ? `km ${k.km_from_outlet}` : 'course'), desc: k.note || '', rows: '[]', src: JSON.stringify(srcs(k)) }));
for (const m of SC.mouth_ecosystems || []) if (m.lat) push(pt('wetland', m.lat, m.lon, { name: m.name, kind: 'Wetland at the mouth', desc: m.note, rows: JSON.stringify([['Designated', m.designated], ['Area', m.area_ha ? m.area_ha.toLocaleString('en') + ' ha' : '']]), src: JSON.stringify(srcs(m)) }));
// huentitan
const HU = H.huentitan;
for (const k of HU.key_points) {
  if (/PTAR/.test(k.name)) continue;
  push(pt('huentitan', k.lat, k.lon, { name: k.name, kind: 'Barranca de Huentitán', desc: k.note || '', rows: '[]', src: JSON.stringify(srcs(k)) }));
}
// aquifers
for (const a of H.aquifers.items) {
  const c = a.centroid_approx || a.centroid; if (!c) continue;
  push(pt('aquifer', c[0], c[1], { name: `Aquifer ${a.name} (${a.clave})`, kind: 'Aquifer · location approximate', desc: `${a.status}. ${a.covers || ''}`,
    rows: JSON.stringify([['Availability 2023', `${fmt(a.DMA_2023)} hm³/yr`], ['Availability 2018', a.deficit_2018 != null ? `${fmt(a.deficit_2018)} hm³/yr` : '—'], ['Recharge', a.R != null ? `${a.R} hm³/yr` : '—'], ['Concessioned (VCAS)', a.VCAS != null ? `${fmt(a.VCAS)} hm³/yr` : '—']]),
    src: JSON.stringify(srcs(a)) }));
}

/* ---------- SIAPA ---------- */
const lines = [], polys = [];
if (S) {
  const cap = v => v ? Number(v).toLocaleString("en") + " L/s" : null;
  for (const p of S.potabilizadoras) push(pt("potab", p.lat, p.lon, { name: p.name, kind: "SIAPA drinking-water plant " + (p.id || ""), desc: [p.notes, p.capacity_note].filter(Boolean).join(" "),
    rows: JSON.stringify([["Installed capacity", cap(p.capacity_ls)], ["Water source", p.water_source], ["Opened", p.year_opened], ["Municipality", p.municipality], ["Operator", p.operator], ["Location", p.location_note]].filter(r => r[1])), src: JSON.stringify(srcs(p)) }));
  for (const p of S.ptars) {
    if (/agua prieta|el ahogado|r[ií]o blanco/i.test(p.name)) continue; // already in the discharge layer
    push(pt("ptar_small", p.lat, p.lon, { name: p.name, kind: "Wastewater treatment plant", desc: [p.status, p.receiving ? "Discharges to " + p.receiving : ""].filter(Boolean).join(". "),
      rows: JSON.stringify([["Capacity", cap(p.capacity_ls)], ["Treated 2021", cap(p.treated_ls_2021)], ["Operator", p.operator], ["Municipality", p.municipality]].filter(r => r[1])), src: JSON.stringify(srcs(p)) }));
  }
  for (const a of S.aqueducts) {
    const c = a.route_lonlat; if (!c?.length) continue;
    const planned = /planned/i.test(a.status || "");
    lines.push({ type: "Feature", properties: { layer: "aqueduct", planned, name: a.name, kind: (planned ? "Planned aqueduct" : "Aqueduct") + (a.approx ? " · route sketched between endpoints" : ""), desc: a.description || "",
      rows: JSON.stringify([["Status", a.status], ["Capacity", a.capacity_m3s ? a.capacity_m3s + " m³/s" : null], ["Capacity note", a.capacity_note], ["Length", a.length_km ? a.length_km + " km" : null], ["Year", a.year], ["Route", a.route_note]].filter(r => r[1])), src: JSON.stringify(srcs(a)) },
      geometry: { type: "LineString", coordinates: c } });
  }
  for (const p of S.dams_sources.features) push(pt("source", p.lat, p.lon, { name: p.name, kind: "Water source · " + String(p.type || "").replace(/_/g, " "), desc: p.details || "",
    rows: JSON.stringify([["Share of supply", p.share], ["Location", p.approx ? (p.location_note || "approximate") : null]].filter(r => r[1])), src: JSON.stringify(srcs(p)) }));
  const T = [["fountain", /fountain|water_point/], ["well", /well/], ["tank", /tank|reservoir|tower/], ["pump", /pumping|water_works/]];
  for (const p of S.tanks_wells_fountains.points) {
    const t = (T.find(([, re]) => re.test(p.type)) || ["tank"])[0];
    push(pt(t, p.lat, p.lon, { name: p.name || p.type.replace(/_/g, " "), kind: p.type.replace(/_/g, " ") + (p.operator ? " · " + p.operator : ""), desc: "", rows: "[]", src: JSON.stringify([p.source_url || p.source].filter(Boolean)) }));
  }
  for (const w of S.wetlands) {
    if (/Cajititl/.test(w.name) && rd("lakes.json")) continue;
    const props = { layer: "wetland", name: w.name, kind: "Wetland" + (w.ramsar ? " · Ramsar site " + w.ramsar.site_number : ""), desc: w.description || "",
      rows: JSON.stringify([["Area", w.area_ha ? w.area_ha.toLocaleString("en") + " ha" : null], ["Designated", w.ramsar?.designated]].filter(r => r[1])), src: JSON.stringify(srcs(w)) };
    if (w.polygon_lonlat?.length > 3) polys.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [w.polygon_lonlat] } });
    else push(pt("wetland", w.lat, w.lon, props));
  }
}
// Huentitán protected area polygon (OSM, partial)
const B = rd('barrancas_santiago_verde_osm.geojson');
const pa = HU.protected_areas[0];
for (const f of B?.features || []) polys.push({ type: 'Feature', geometry: simp(f.geometry, 0.0003, 1e5), properties: { layer: 'huentitan', name: 'Barrancas de los Ríos Santiago y Verde', kind: 'State protected area (Formación Natural de Interés Estatal)',
  desc: `Published ${pa.published}. ${HU.depth?.note || ''} ${HU.biodiversity?.summary?.split('.').slice(0, 2).join('.')}. The outline drawn here is the OpenStreetMap mapping (≈92 km²), only part of the ≈${Math.round(pa.area_ha / 100)} km² decree.`,
  rows: JSON.stringify(HU.protected_areas.map(a => [a.level || 'Status', `${a.name}${a.area_ha ? ' · ' + a.area_ha.toLocaleString('en') + ' ha' : ''}${a.published ? ' · ' + a.published : ''}`]).concat([['Threats', HU.threats.map(t => t.threat).join(' ')], ['Arcediano dam', HU.arcediano_dam.summary]])),
  src: JSON.stringify([...srcs(pa), ...HU.threats.flatMap(srcs), ...srcs(HU.arcediano_dam)].slice(0, 6)) } });
// Cajititlán from OSM lakes
const lk = rd('lakes.json');
for (const e of lk?.elements || []) if (e.type === 'way' && /Cajititl/.test(e.tags.name) && e.geometry) polys.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [dp(e.geometry.map(g => [g.lon, g.lat]), 0.0002).map(p => R(p, 1e5))] },
  properties: { layer: 'wetland', name: 'Laguna de Cajititlán', kind: 'Lagoon · Tlajomulco', desc: 'Shallow lagoon in the Cajititlán aquifer basin (−16.95 hm³/yr, DOF 2023); repeated mass fish die-offs linked to sewage and low oxygen.', rows: '[]', src: JSON.stringify(['https://www.openstreetmap.org/way/' + e.id]) } });
for (const f of pts) if (f.properties.layer === 'aquifer') { polys.push(f); }
wr('points.geojson', { type: 'FeatureCollection', features: pts.filter(f => f.properties.layer !== 'aquifer') });
wr('lines.geojson', { type: 'FeatureCollection', features: lines });
wr('polys.geojson', { type: 'FeatureCollection', features: polys });

/* ---------- info: story, facts, Chapala ---------- */
// one map view per key fact: [match on fact text, card title, place shown on the map, [lon, lat], zoom, layers]
const CORR = ['rivers', 'industry', 'discharge', 'hotspot'];
const FACTVIEW = [
  [/Accelerated industrialization/, 'An industrial corridor grows on the river', 'El Salto – Ocotlán industrial corridor', [-103.0, 20.45], 9.6, ['rivers', 'industry']],
  [/PROFEPA registered 159/, '159 industries, 280 discharges', 'Río Santiago, Ocotlán to El Salto', [-103.0, 20.45], 9.6, ['rivers', 'industry', 'discharge']],
  [/1,090 toxic substances/, '1,090 toxic substances detected', 'El Salto corridor', [-103.2, 20.52], 11, CORR.concat('wq')],
  [/Miguel Ángel López Rocha/, 'A boy dies after falling into the river', 'Arroyo El Ahogado at El Salto', [-103.2164, 20.4984], 13.5, CORR],
  [/main source of Santiago pollution is water from Arroyo El Ahogado/, 'El Ahogado: the main source', 'Arroyo El Ahogado → Puente Grande', [-103.2, 20.535], 11.8, CORR.concat('wq')],
  [/Macro-Recomendación 1\/2009/, '100-point state human-rights recommendation', 'Metro Guadalajara and the Santiago', [-103.2, 20.6], 9.8, ['rivers', 'discharge', 'hotspot']],
  [/within 5 km of the Santiago/, 'Living next to the river', 'El Salto and Juanacatlán', [-103.18, 20.51], 12.6, ['rivers', 'hotspot', 'industry']],
  [/10 facilities with the highest RETC/, 'The ten biggest metal and cyanide dischargers', 'Industry releasing to water', [-103.05, 20.5], 9.6, ['rivers', 'industry']],
  [/UASLP study commissioned by CEA/, 'Children exposed to metals and benzene', 'El Salto, Juanacatlán, Puente Grande', [-103.17, 20.54], 12, ['rivers', 'hotspot']],
  [/thick foam that wind carries/, 'Toxic foam at the falls', 'Salto de Juanacatlán', [-103.1752, 20.5132], 15, ['rivers', 'hotspot']],
  [/All urban drains flow into the El Salto/, 'Every city drain ends at the falls', 'El Salto–Juanacatlán diversion dam', [-103.1752, 20.5132], 14, ['rivers', 'hotspot', 'discharge']],
  [/UN Working Group/, '"An ecological catastrophe"', 'Falls and PTAR El Ahogado', [-103.22, 20.51], 12.3, CORR],
  [/PROFEPA Recommendation PFPA/, 'Pollution also arrives from the Lerma', 'Lerma basin → Lake Chapala', [-101.6, 20.2], 6.9, ['rivers', 'mxr', 'wq']],
  [/IACHR granted precautionary measures/, 'Inter-American precautionary measures', 'Juanacatlán, El Salto and Poncitlán shore', [-103.05, 20.43], 10.4, ['rivers', 'hotspot']],
  [/CNDH Recommendation 134\/2022/, 'National human-rights recommendation 134/2022', 'El Salto, Juanacatlán, Poncitlán', [-103.05, 20.43], 10.4, ['rivers', 'hotspot', 'industry']],
  [/Chronic kidney disease/, 'Kidney disease on the Chapala shore', 'San Pedro Itzicán and Agua Caliente', [-102.95, 20.32], 12.5, ['hotspot', 'wq']],
  [/strongly contaminated/, 'Fecal coliforms at every site', 'Ocotlán → El Ahogado', [-103.0, 20.45], 9.8, ['rivers', 'wq']],
  [/2025 semáforo/, 'Every 2025 station on the Santiago is red', 'Santiago, El Ahogado, Zula, Lerma', [-102.95, 20.42], 9.4, ['rivers', 'wq']],
  [/13,400 L\/s of wastewater/, '74% of wastewater treated', 'Santiago basin treatment plants', [-103.25, 20.62], 10, ['rivers', 'discharge', 'ptar_small', 'hotspot']],
  [/103 wastewater and industrial discharges/, '103 discharges found; drinking-water intake reached', 'Las Pintas and Miravalle plant', [-103.34, 20.6], 13, ['rivers', 'discharge', 'potab', 'hotspot']],
];
// openly licensed photos per fact (Wikimedia Commons; licence and author checked via the Commons API, Nov 2026)
// [file name, caption (says where the photo really is), author, licence]
const CM = f => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f.replace(/ /g, '_')) + '?width=800';
const FOAM = n => `Río Grande de Santiago (Río de Santiago) - Contaminación 0${n}.jpg`;
const FOAMCAP = 'Pollution foam on the Río Santiago in the Barranca de Huentitán, downstream of Guadalajara, April 2024.';
const FALLS = ['El Salto de Juanacatlán - Hacienda de Jesús María.jpg', 'The Salto de Juanacatlán falls and the old mill and power plant, in a historic photo from before the pollution.', 'Eimolinac', 'CC BY-SA 4.0'];
const FACTIMG = {
  1: [FOAM(3), FOAMCAP, 'Mtenaespinoza', 'CC BY-SA 4.0'],
  2: [FOAM(1), FOAMCAP, 'Mtenaespinoza', 'CC BY-SA 4.0'],
  4: ['Tololotlán, Jalisco.jpg', 'The old bridge at Puente Grande (Tololotlán), Tonalá, over the Río Santiago, 2018.', 'Alejandro Hernández Osuna', 'public domain'],
  5: [FOAM(6), FOAMCAP, 'Mtenaespinoza', 'CC BY-SA 4.0'],
  6: ['Juanacatlán (20240826)02.jpg', 'The riverside in Juanacatlán, with water hyacinth on the Río Santiago and El Salto across the river, August 2024.', 'José González Peña', 'CC BY-SA 4.0'],
  7: [FOAM(4), FOAMCAP, 'Mtenaespinoza', 'CC BY-SA 4.0'],
  9: [FOAM(8), 'Heaps of toxic foam on the Río Santiago at Huentitán, downstream of the Juanacatlán falls, April 2024.', 'Mtenaespinoza', 'CC BY-SA 4.0'],
  10: FALLS, 11: FALLS,
  12: ['Lake Chapala (154465).jpg', 'Lake Chapala from the International Space Station, January 2025: the Lerma enters at the east end; Guadalajara is to the north-west.', 'NASA ISS Expedition 72 crew', 'public domain'],
  13: ['MezcalaChapala027.JPG', 'Fishing boats on Lake Chapala at Mezcala, Poncitlán, 2015.', 'AlejandroLinaresGarcia', 'CC BY-SA 4.0'],
  14: ['Juanacatlán (20240524)01.jpg', 'The Río Santiago at Juanacatlán, May 2024.', 'José González Peña', 'CC BY-SA 4.0'],
  15: ['San Pedro Itzican - panoramio.jpg', 'Lake Chapala from the hills of San Pedro Itzicán, Poncitlán, 2010.', 'J.Godinez', 'CC BY-SA 3.0'],
  16: [FOAM(1), FOAMCAP, 'Mtenaespinoza', 'CC BY-SA 4.0'],
  17: ['Rio Lerma, Parque de los Enamorados.jpg', 'The Río Lerma at Ocotlán, 2017.', 'Sahagun', 'CC BY-SA 4.0'],
  19: ['Presa Las Pintas.jpg', 'Presa Las Pintas, the reservoir on the Las Pintas sewage canal, El Salto, 2010.', 'Adapting to Scarcity', 'CC BY-SA 2.0'],
};
const CH = S?.chapala || {};
const LC = H.lake_chapala_context;
const info = {
  credits: 'Imagery: Esri World Imagery. Municipal limits: INEGI Marco Geoestadístico 2022. States of Mexico and rivers of Mexico: Natural Earth 10m (public domain). Topography: AWS Terrain Tiles (SRTM, GMTED, INEGI and others). Watersheds: CONAGUA, DOF 21-Sep-2020 (via CONAFOR IDEFOR). Aquifers: DOF 9-Nov-2023. Rivers, wetlands, protected-area outline: © OpenStreetMap contributors (ODbL). Industry: SEMARNAT RETC 2004–2022, Greenpeace/UNAM 2012, IMTA 2011. Water quality: CONAGUA RENAMECA 2012–2025; CEA Jalisco/FONNOR 2022. Infrastructure: SIAPA, CEA Jalisco, CONAGUA, OpenStreetMap. Compiled ' + (P.meta?.compiled || '2026-11-23') + '.',
  facts: P.facts.map(f => { const v = FACTVIEW.find(([re]) => re.test(f.fact));
    if (!v) throw new Error('No map view for fact: ' + f.fact.slice(0, 60));
    const [, title, place, pt, zoom, layers] = v; const im = FACTIMG[P.facts.indexOf(f)];
    return { ...f, title, place, pt, zoom, layers, ...(im ? { img: CM(im[0]), img_page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(im[0].replace(/ /g, '_')), img_alt: im[1], img_credit: `${im[1]} Photo: ${im[2]}, ${im[3]}, via Wikimedia Commons.` } : {}) }; }),
  story: [
    { title: 'Lerma into Chapala', center: [-102.95, 20.22], zoom: 9.3, layers: ['rivers', 'wq', 'cuencas', 'source', 'aqueduct', 'wetland'],
      text: [`The Lerma drains the industrial Bajío and ends in Lake Chapala, Mexico’s largest lake (≈${LC.surface_area_km2} km², ${LC.mean_depth_m} m average depth, Ramsar site ${LC.ramsar.site_number}).`,
        `Guadalajara pumps about 60% of its drinking water from here (6.65 m³/s in 2025, SIAPA/PIA) through the 1991 Chapala–Guadalajara aqueduct and the older Atequiza–Las Pintas canal system. The lake sits in watershed 1217 Río Lerma 7, which CONAGUA lists in deficit (−250.7 hm³/yr).`],
      src: 'Ramsar RIS 1973 · DOF 2020 · ' + LC.aqueduct_source },
    { title: 'Ocotlán: the Santiago is born', center: [-102.85, 20.38], zoom: 11, layers: ['rivers', 'route', 'wq', 'industry', 'hotspot'],
      text: ['The Río Santiago leaves the lake at Ocotlán. For decades the lake has released little water, so the first kilometres mostly carry the Río Zula and local wastewater.',
        'Ocotlán and Poncitlán host food, chemical and furniture plants. Red dots are CONAGUA stations that fail the federal traffic-light (fecal coliforms, COD, toxicity).'] },
    { title: 'The El Salto corridor', center: [-103.2, 20.52], zoom: 11.3, layers: ['rivers', 'industry', 'discharge', 'hotspot', 'wq'],
      text: ['Since the 1970s an industrial corridor of chemical, textile, electronics, automotive and food plants has grown along the river between Ocotlán and El Salto. Magenta circles are facilities that reported pollutant releases to water or sewer to SEMARNAT’s RETC; size is cumulative kg 2004–2022.',
        'The Arroyo El Ahogado and Canal Las Pintas bring south-metro sewage and industrial effluent into the river just above the Juanacatlán falls, where hydrogen sulfide and toxic foam drift over El Salto and Juanacatlán. In 2008 a boy, Miguel Ángel López Rocha, died after falling into the river here (CNDH Rec. 12/2010).'],
      src: 'SEMARNAT RETC 2004–2022 · CNDH 134/2022 · IACHR MC-708-19' },
    { title: 'Guadalajara’s buried rivers', center: [-103.33, 20.70], zoom: 11.6, layers: ['rivers', 'buried', 'discharge', 'potab', 'source', 'aqueduct', 'hu', 'wq'],
      text: ['The city was built over the Atemajac valley. The Río San Juan de Dios has been piped since 1909 under Calzada Independencia; the Atemajac, Osorio and Río Blanco carry the city’s storm and wastewater north and east into the barranca.',
        'Two macro-plants, Agua Prieta (8.5 m³/s design, 2014) and El Ahogado, now treat much of the metro wastewater, but both still discharge to the Santiago and Agua Prieta needs upgrading to meet NOM-001-SEMARNAT-2021.'] },
    { title: 'Barranca de Huentitán', center: [-103.30, 20.745], zoom: 12.6, pitch: 55, bearing: 20, layers: ['rivers', 'hu', 'discharge', 'route'],
      text: [`A canyon about ${HU.depth.value_m_approx} m deep on Guadalajara’s northern edge, protected since ${pa.published.slice(-10, -6)} as a state natural area (≈${Math.round(pa.area_ha).toLocaleString('en')} ha with the Río Verde canyon). It holds ${HU.biodiversity.summary.match(/\d+ wild vertebrate species/)?.[0] || 'hundreds of vertebrate species'}.`,
        'The river at its bottom collects the metro’s wastewater. The Arcediano dam, planned here to supply the city, was suspended in 2009 after the village was displaced, partly because the water was too contaminated to treat.'],
      src: HU.arcediano_dam.sources[0] },
    { title: 'Dams and the Pacific', center: [-104.5, 21.35], zoom: 7.6, layers: ['rivers', 'route', 'cuencas', 'wetland'],
      text: [`Below the Verde confluence the Santiago crosses Santa Rosa, La Yesca, El Cajón and Aguamilpa dams before reaching the Pacific north-west of San Blas, Nayarit, after ${SC.length.official_km} km. CONAGUA estimates mean natural runoff of ${fmt(SC.mean_flow_to_pacific.conagua_mean_natural_runoff_hm3_yr)} hm³/yr.`,
        SC.downstream_contamination.summary + ' The mouth borders Marismas Nacionales (Ramsar 732), one of the Pacific’s largest mangrove systems.'],
      src: SC.length.official_url }
  ],
  chapala: CH.latest_reading ? {
    intro: CH.role,
    latest: { date: CH.latest_reading.date, cota: CH.latest_reading.cota_m, vol: CH.latest_reading.volume_hm3, pct: CH.latest_reading.pct_capacity },
    max_cota: CH.max_ordinary.cota_m, max_vol: CH.max_ordinary.volume_hm3,
    min_label: `${CH.historic.min_absolute.cota_m} (${CH.historic.min_absolute.date.slice(0, 4)})`,
    min_note: `record low, ${fmt(CH.historic.min_absolute.volume_hm3)} hm³; 2002 low ${CH.historic.min_2002.cota_m}`,
    series: CH.annual_min_max.filter(d => d.min_cota != null || d.max_cota != null).map(d => ({ year: d.year, min: d.min_cota, max: d.max_cota })),
    spots: (CH.spot_readings_2022_2023 || []).filter(d => d.cota_m).map(d => ({ year: +d.date.slice(0, 4) + (+d.date.slice(5, 7) - 0.5) / 12, cota: d.cota_m })),
    last30: CH.last_30_days,
    series_note: 'Yearly dry-season minimum and rainy-season maximum, CEA gauge scale (cota 97.80 ≈ 1,523.8 m a.s.l.). 1900–2021 and 2024–2026 from CEA Jalisco; 2022–23 are spot readings from press/UdeG.',
    notes: [
      `Guadalajara’s concession is ${CH.extraction_for_guadalajara.concession_hm3_per_year} hm³/yr (${CH.extraction_for_guadalajara.concession_m3s} m³/s). Actual extraction in 2025: ${CH.extraction_for_guadalajara.actual_m3s['2025']} m³/s, ${CH.extraction_for_guadalajara.share_of_siapa_supply_pct_2025}% of SIAPA supply.`,
      `SIAPA supply by source, ${S.dams_sources.supply_share_summary.year}: Chapala ${S.dams_sources.supply_share_summary.pct_chapala}%, Calderón/Río Verde ${S.dams_sources.supply_share_summary.pct_calderon_rioverde}%, wells ${S.dams_sources.supply_share_summary.pct_groundwater}% (total ${S.dams_sources.supply_share_summary.total_m3s} m³/s).`,
      `Same day each year (22 Nov): ${CH.same_date_nov22.map(d => `${d.date.slice(0, 4)} ${d.cota} (${d.pct}%)`).join(' · ')}.`,
      'The lake drops about 0.7–1.5 m each dry season through evaporation and extraction, and recovers with Lerma inflows in the rains. The lows of 1955, 1990–91 and 2001–02 pushed the city to build the 1991 aqueduct and to seek water from Calderón and El Zapotillo.'
    ],
    sources: CH.sources.slice(0, 3).concat(CH.extraction_for_guadalajara.sources.slice(0, 1))
  } : null
};
wr('info.json', info);
