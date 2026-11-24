// usage: node simplify.mjs in.geojson out.geojson tolDeg keepProps(comma) [precision]
import fs from 'fs';
const [,, inp, out, tolS, keep, precS] = process.argv;
const tol = +tolS, prec = +(precS || 4), f = 10 ** prec;
function dp(pts, t) {
  if (pts.length < 3) return pts;
  const keepArr = new Uint8Array(pts.length); keepArr[0] = keepArr[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]; let d;
      if (L === 0) d = Math.hypot(x - x1, y - y1);
      else { let u = ((x - x1) * dx + (y - y1) * dy) / L; u = Math.max(0, Math.min(1, u)); d = Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy)); }
      if (d > md) { md = d; mi = i; }
    }
    if (md > t) { keepArr[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keepArr[i]);
}
const r = p => [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
const ring = (pts, closed) => { let s = dp(pts, tol).map(r); if (closed && s.length < 4) s = [pts[0], pts[Math.floor(pts.length/3)], pts[Math.floor(2*pts.length/3)], pts[0]].map(r); return s; };
const geom = g => {
  if (!g) return g;
  if (g.type === 'Polygon') return { type: g.type, coordinates: g.coordinates.map(x => ring(x, 1)) };
  if (g.type === 'MultiPolygon') return { type: g.type, coordinates: g.coordinates.map(p => p.map(x => ring(x, 1))) };
  if (g.type === 'LineString') return { type: g.type, coordinates: ring(g.coordinates, 0) };
  if (g.type === 'MultiLineString') return { type: g.type, coordinates: g.coordinates.map(x => ring(x, 0)) };
  if (g.type === 'Point') return { type: g.type, coordinates: r(g.coordinates) };
  return g;
};
const d = JSON.parse(fs.readFileSync(inp, 'utf8'));
const ks = keep ? keep.split(',') : null;
d.features = d.features.map(ft => ({ type: 'Feature', properties: ks ? Object.fromEntries(ks.filter(k => k in ft.properties).map(k => [k, ft.properties[k]])) : ft.properties, geometry: geom(ft.geometry) }));
delete d.crs;
fs.writeFileSync(out, JSON.stringify(d));
console.log(out, d.features.length, 'features', fs.statSync(out).size, 'bytes');
