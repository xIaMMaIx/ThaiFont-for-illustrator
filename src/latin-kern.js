/**
 * LatinKern — kerning อัตโนมัติจากรูปตัวอักษรในโปรเจกต์ (ไม่อิงฟอนต์ใดเลย)
 *
 * ทุกค่าที่ใช้คำนวณวัดจากตัวอักษรที่ผู้ใช้วาดจริง:
 *   S    ความหนาเส้น           = ความกว้างหลักที่แคบสุดของ n l i H I (มัธยฐาน)
 *   XH   x-height              = มัธยฐานความสูงของตัวพิมพ์เล็กทั้งหมด (ตัวหางสูงเป็นส่วนน้อยจึงไม่ดึงค่า)
 *   Aref "ช่องไฟปกติ"           = พื้นที่ว่างเฉลี่ยระหว่าง n–n (เล็ก) และ H–H (ใหญ่) ตามช่องไฟที่ผู้ใช้ตั้งไว้เอง
 *
 * คู่ L→R: เลื่อน R ด้วย k จนพื้นที่ว่างเฉลี่ย (ตามแถวที่ R มีหมึก) เท่ากับ Aref
 *   gap(y) = (ขอบซ้ายหมึก R) − (ขอบขวาหมึก L)           แถวที่ L ไม่มีหมึก (เช่น ใต้แขนตัว T) = ช่องเปิด D
 *   ช่องเปิดนับได้ไม่เกิน D = Aref + depth·S             → ตัวเตี้ยเข้าใต้แขน T ได้ แต่ไม่ลึกไม่สิ้นสุด
 *   ตัวหางสูง (b d f h k l) ชนแถวแขน T → ช่องว่างแถวนั้นเล็ก ค่าเฉลี่ยจึงไม่ลดลงมาก → kerning น้อยเอง
 * กันชน: ระยะสั้นสุดแบบ 2 มิติ (รวมระยะแนวตั้งใต้แขน) ต้อง ≥ clear · Aref
 * จัดจังหวะ: ตัวถัดไปที่รูปทรงเหมือนกัน (ความสูง/ขอบซ้ายตรงหรือโค้ง) ใช้ค่ากลางร่วมกัน
 *
 * หน่วย pt บน Canvas — ค่าลบ = ชิดเข้า
 */
(function (root) {
  'use strict';
  const O = () => root.Outline;

  const REF_LOWER = ['n', 'm', 'u', 'i', 'l', 'h'];
  const REF_UPPER = ['H', 'I', 'E', 'N', 'M', 'L'];

  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const chOf = def => def && def.char;
  const isLower = def => def && def.group === 'latin-lower';
  const isUpper = def => def && def.group === 'latin-upper';
  const isDigit = def => def && def.group === 'digit';

  /** จุดตามขอบ + polygon + profile รายแถว (ตาม grid y ที่ใช้ร่วมกัน) */
  function prep(contours, grid, step) {
    const polys = contours.map(c => O().flatten(c, 8)).filter(p => p.length > 1);
    const pts = []; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    polys.forEach(poly => {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let j = 0; j < k; j++) {
          const x = a[0] + (b[0] - a[0]) * j / k, y = a[1] + (b[1] - a[1]) * j / k;
          pts.push(x, y);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    });
    const n = grid.n, xl = new Float64Array(n), xr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const y = grid.y0 + (i + 0.5) * grid.step;
      let l = Infinity, r = -Infinity;
      polys.forEach(poly => {
        for (let k = 0, m = poly.length; k < m; k++) {
          const a = poly[k], b = poly[(k + 1) % m];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            const x = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
            if (x < l) l = x; if (x > r) r = x;
          }
        }
      });
      xl[i] = l === Infinity ? NaN : l; xr[i] = r === -Infinity ? NaN : r;
    }
    return { pts, bb: { x0, x1, y0, y1 }, xl, xr };
  }

  /** ตัดส่วนใต้เส้นฐานออกจากข้อมูลที่ใช้คำนวณ (ตัวที่ติ๊ก "ไม่นับหาง") */
  function dropBelow(p, grid, baseY) {
    const keep = [];
    for (let i = 0; i < p.pts.length; i += 2) if (p.pts[i + 1] >= baseY) keep.push(p.pts[i], p.pts[i + 1]);
    p.pts = keep;
    for (let i = 0; i < grid.n; i++) if (grid.y0 + (i + 0.5) * grid.step < baseY) { p.xl[i] = NaN; p.xr[i] = NaN; }
    if (keep.length) { let y0 = Infinity; for (let i = 1; i < keep.length; i += 2) if (keep[i] < y0) y0 = keep[i]; p.bb.y0 = y0; }
  }

  /** ระยะสั้นสุดระหว่างจุดขอบของ a กับ b (b เลื่อน dx) */
  function minDist(a, b, dx, cut) {
    const ax0 = a.bb.x0 - cut, ax1 = a.bb.x1 + cut, ay0 = a.bb.y0 - cut, ay1 = a.bb.y1 + cut;
    if (b.bb.x0 + dx > ax1 || b.bb.x1 + dx < ax0 || b.bb.y0 > ay1 || b.bb.y1 < ay0) return cut;
    const near = [];
    for (let j = 0; j < b.pts.length; j += 2) {
      const x = b.pts[j] + dx, y = b.pts[j + 1];
      if (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1) near.push(x, y);
    }
    let best = cut * cut;
    for (let i = 0; i < a.pts.length; i += 2) {
      const px = a.pts[i], py = a.pts[i + 1];
      for (let j = 0; j < near.length; j += 2) {
        const ex = px - near[j], ey = py - near[j + 1], d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }

  const DEFAULTS = { depth: 1.0, clear: 0.35, smooth: true, dead: 0.2, tuck: 0.65, flat: 0.6 };
  function cfgOf(S) {
    const k = (S && S.kerning) || {};
    return {
      depth: k.depth != null ? Number(k.depth) : DEFAULTS.depth,
      clear: k.clear != null ? Number(k.clear) : DEFAULTS.clear,
      smooth: k.smooth != null ? !!k.smooth : DEFAULTS.smooth,
      dead: DEFAULTS.dead,
      tuck: k.tuck != null ? Number(k.tuck) : DEFAULTS.tuck,
      flat: k.flat != null ? Number(k.flat) : DEFAULTS.flat,
      strength: k.strength != null ? Number(k.strength) : 1
    };
  }

  /**
   * เตรียมข้อมูลจากตัวอักษรในโปรเจกต์
   * recs: [{ def, code, contours, m }]  (m = Spacing.measure — มี originX, advance)
   */
  function prepare(recs, S) {
    const c = S.canvas;
    const items = recs.filter(r => r && r.m && r.contours && r.contours.length && r.def &&
      (isLower(r.def) || isUpper(r.def) || isDigit(r.def)));
    if (items.length < 2) return null;
    let yLo = Infinity, yHi = -Infinity;
    items.forEach(r => { yLo = Math.min(yLo, r.m.bbox.yMin); yHi = Math.max(yHi, r.m.bbox.yMax); });
    const H = Math.max(10, c.cap - c.baseline);
    const step = H / 36;
    const grid = { y0: yLo, step, n: Math.max(8, Math.ceil((yHi - yLo) / step)) };
    const E = {};
    items.forEach(r => {
      const p = prep(r.contours, grid, 8);
      if (root.ProjectSettings && root.ProjectSettings.adjustOf(S, r.code).tail) dropBelow(p, grid, c.baseline);
      E[r.code] = { rec: r, def: r.def, m: r.m, p, ymax: r.m.bbox.yMax, ymin: r.m.bbox.yMin };
    });
    const byCh = {};
    Object.keys(E).forEach(k => { byCh[chOf(E[k].def)] = E[k]; });

    // ---- ค่าที่วัดจากโปรเจกต์ ----
    const lowers = Object.keys(E).map(k => E[k]).filter(e => isLower(e.def));
    const uppers = Object.keys(E).map(k => E[k]).filter(e => isUpper(e.def));
    const XH = lowers.length >= 3 ? median(lowers.map(e => e.ymax - c.baseline)) : H * 0.7;
    const CAP = uppers.length >= 2 ? median(uppers.map(e => e.ymax - c.baseline)) : H;
    // หลักตั้ง: ความกว้างที่แคบสุดของช่วงหมึกกลางตัว
    const stemSrc = ['n', 'l', 'i', 'u', 'H', 'I', 'N', 'E'].map(ch => byCh[ch]).filter(Boolean);
    const ws = [];
    stemSrc.forEach(e => {
      [0.35, 0.5, 0.65].forEach(f => {
        const y = c.baseline + (isLower(e.def) ? XH : CAP) * f, xs = [];
        e.rec.contours.forEach(ct => {
          const poly = O().flatten(ct, 8);
          for (let k = 0, n = poly.length; k < n; k++) {
            const a = poly[k], b = poly[(k + 1) % n];
            if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
        });
        xs.sort((p, q) => p - q);
        let mn = Infinity;
        for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1) mn = Math.min(mn, xs[i + 1] - xs[i]);
        if (mn < Infinity) ws.push(mn);
      });
    });
    const stem = ws.length ? median(ws) : H * 0.1;
    return { S, c, E, byCh, grid, XH, CAP, stem, H, cfg: cfgOf(S), ref: {}, cache: new Map() };
  }

  /** พื้นที่ว่างเฉลี่ยของคู่ L→R ที่ k (ตามแถวที่ R มีหมึก) — D = เพดานช่องเปิด */
  function areaGap(L, R, k, D, wantMin) {
    const g = L.m.originX + L.m.advance + k - R.m.originX;      // เลื่อน R ไปทางขวาเท่านี้
    const n = L.p.xl.length;
    let sum = 0, cnt = 0, mn = Infinity;
    for (let i = 0; i < n; i++) {
      const rl = R.p.xl[i];
      if (rl !== rl) continue;                                   // R ไม่มีหมึกแถวนี้
      const lr = L.p.xr[i];
      let gap = lr !== lr ? D : rl + g - lr;
      if (gap > D) gap = D;
      sum += gap; cnt++;
      if (gap < mn) mn = gap;
    }
    return cnt ? (wantMin ? { avg: sum / cnt, min: mn, rows: cnt } : sum / cnt) : (wantMin ? { avg: D, min: D, rows: 0 } : D);
  }

  /** ช่องไฟอ้างอิง: n–n สำหรับตัวเล็ก, H–H สำหรับตัวใหญ่/ตัวเลข */
  function refGap(ctx, kind) {
    if (ctx.ref[kind] != null) return ctx.ref[kind];
    const list = kind === 'lower' ? REF_LOWER : REF_UPPER;
    const vals = [];
    list.forEach(ch => {
      const e = ctx.byCh[ch]; if (!e) return;
      vals.push(areaGap(e, e, 0, 1e9));
    });
    let v;
    if (vals.length) v = median(vals);
    else {
      const sp = ctx.S.spacing;
      v = 2 * sp.base * root.ProjectSettings.densityFactor(sp.density);
    }
    ctx.ref[kind] = v; return v;
  }

  /** ระยะ 2 มิติที่ใกล้สุดที่ผู้ใช้ยอมรับอยู่แล้ว = ระยะสั้นสุดของคู่ n–n / H–H ตามช่องไฟที่ตั้งไว้ (เซริฟก็นับ) */
  function refMinDist(ctx, kind) {
    const key = kind + 'Min';
    if (ctx.ref[key] != null) return ctx.ref[key];
    const list = kind === 'lower' ? REF_LOWER : REF_UPPER, vals = [];
    list.forEach(ch => {
      const e = ctx.byCh[ch]; if (!e) return;
      const dx = e.m.originX + e.m.advance - e.m.originX;
      vals.push(minDist(e.p, e.p, dx, ctx.H));
    });
    ctx.ref[key] = vals.length ? median(vals) : refGap(ctx, kind);
    return ctx.ref[key];
  }

  function zoneOf(ctx, e) {
    if (isUpper(e.def)) return 'cap';
    if (isDigit(e.def)) return 'num';
    const top = e.ymax - ctx.c.baseline;
    return top > ctx.XH * 1.1 ? 'asc' : 'low';
  }
  function leftShape(ctx, e) {
    const y0 = ctx.c.baseline + (isLower(e.def) ? ctx.XH : ctx.CAP) * 0.15, y1 = ctx.c.baseline + (isLower(e.def) ? ctx.XH : ctx.CAP) * 0.85;
    const g = ctx.grid; let mn = Infinity, mx = -Infinity, cnt = 0;
    for (let i = 0; i < g.n; i++) {
      const y = g.y0 + (i + 0.5) * g.step; if (y < y0 || y > y1) continue;
      const v = e.p.xl[i]; if (v !== v) continue;
      mn = Math.min(mn, v); mx = Math.max(mx, v); cnt++;
    }
    if (!cnt) return 'r';
    const zoneH = isLower(e.def) ? ctx.XH : ctx.CAP;
    // ขอบซ้ายตรงทั้งแนว (ใช้ช่วงกว้างสุด ไม่ใช่ค่าเฉลี่ย — o c e O ที่ข้างแบนแบบ superellipse ต้องนับเป็นโค้ง)
    // และไม่มีแขน/หางยื่นซ้ายเกินก้านมาก (T J j) = flat
    return (mx - mn) < zoneH * 0.05 && (mn - e.p.bb.x0) < zoneH * 0.2 ? 'f' : 'r';
  }

  /** kerning ดิบของ 1 คู่ (ยังไม่ปรับเป็นกลุ่ม) */
  function rawPair(ctx, L, R) {
    const kind = (isLower(R.def)) ? 'lower' : 'upper';
    const Aref = refGap(ctx, kind);
    const D = Aref + ctx.cfg.depth * ctx.stem;
    if (areaGap(L, R, 0, D) <= Aref) return { k: 0, guard: 0 };
    let lo = -ctx.c.em * 0.25, hi = 0;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (areaGap(L, R, mid, D) >= Aref) hi = mid; else lo = mid;
    }
    let k = hi;
    // กันชน: ระยะ 2 มิติ ≥ clear · Aref
    const need = Math.min(ctx.cfg.clear * Aref, 0.5 * refMinDist(ctx, kind)), cut = need * 4;
    const dxOf = kk => L.m.originX + L.m.advance + kk - R.m.originX;
    const dist = kk => minDist(L.p, R.p, dxOf(kk), cut) - 1.5;
    if (dist(0) < need) return { k: 0, guard: 0 };
    if (dist(k) < need) {
      let a = k, b = 0;                  // a ละเมิด, b ผ่าน
      for (let it = 0; it < 8; it++) { const mid = (a + b) / 2; if (dist(mid) >= need) b = mid; else a = mid; }
      k = b;
    }
    return { k, guard: need };
  }

  function sigOf(e) {
    // ลายเซ็นรูปทรงอย่างย่อ เพื่อ cache (ใช้ผลรวมพิกัด + ช่องไฟ)
    let s = e.m.originX * 1.3 + e.m.advance * 2.1;
    for (let i = 0; i < e.p.pts.length; i += 14) s += e.p.pts[i] * 0.37 + e.p.pts[i + 1] * 0.61;
    return Math.round(s * 100) + ':' + e.p.pts.length;
  }

  /**
   * คืน { 'U+0054|U+0061': k, ... } สำหรับทุกคู่ที่ต้อง kern  (หน่วย pt, หลังคูณ strength)
   * mode: 'raw' ไม่ปรับเป็นกลุ่ม (ใช้ทดสอบ)
   */
  function compute(recs, S, opts) {
    const ctx = prepare(recs, S);
    if (!ctx) return {};
    const keys = Object.keys(ctx.E);
    const raw = {};
    const sig = {}; keys.forEach(k => { sig[k] = sigOf(ctx.E[k]); });
    // ช่องไฟอ้างอิง (n–n / H–H) เปลี่ยนเมื่อผู้ใช้ปรับช่องไฟตัวอ้างอิง → ต้องอยู่ใน key ไม่งั้นค่าคู่อื่นค้างของเก่า
    const refKey = ['lower', 'upper'].map(kd => refGap(ctx, kd).toFixed(2) + ':' + refMinDist(ctx, kd).toFixed(2)).join(',');
    const cacheKey = [ctx.stem.toFixed(1), ctx.XH.toFixed(1), ctx.CAP.toFixed(1), ctx.cfg.depth, ctx.cfg.clear, refKey].join('/');
    const store = (compute._cache && compute._cache.key === cacheKey) ? compute._cache.map : (compute._cache = { key: cacheKey, map: new Map() }).map;
    keys.forEach(a => keys.forEach(b => {
      const L = ctx.E[a], R = ctx.E[b];
      const ck = sig[a] + '|' + sig[b] + '|' + (isLower(R.def) ? 'l' : 'u') + '|' + ctx.grid.y0.toFixed(1) + '|' + ctx.grid.step.toFixed(2);
      let r = store.get(ck);
      if (!r) { r = rawPair(ctx, L, R); store.set(ck, r); }
      raw[a + '|' + b] = r;
    }));

    const out = {};
    const dead = ctx.cfg.dead;
    const refOf = R => refGap(ctx, isLower(R.def) ? 'lower' : 'upper');
    keys.forEach(a => {
      const L = ctx.E[a];
      // จัดกลุ่มตัวถัดไปตามรูปทรง
      const groups = {};
      keys.forEach(b => {
        const R = ctx.E[b];
        const key = zoneOf(ctx, R) + leftShape(ctx, R);
        (groups[key] = groups[key] || []).push(b);
      });
      Object.keys(groups).forEach(gk => {
        const members = groups[gk];
        const vals = members.map(b => raw[a + '|' + b].k);
        const med = median(vals);
        members.forEach(b => {
          const R = ctx.E[b], r = raw[a + '|' + b];
          let k = r.k;
          // จัดจังหวะเฉพาะค่าที่ใกล้ค่ากลางอยู่แล้ว — คู่เด่น (AV, TA, LT) ห้ามถูกดึงไปเป็น 0 ตามกลุ่ม และคู่ที่ไม่ต้อง kern ห้ามถูกดึงเข้า
          const near = Math.abs(r.k - med) <= Math.max(0.3 * Math.max(Math.abs(r.k), Math.abs(med)), 0.05 * refOf(R));
          if (ctx.cfg.smooth && members.length >= 3 && near && !(opts && opts.raw)) {
            if (med >= r.k) k = med;                 // ผ่อนให้เท่ากลุ่ม (ปลอดภัยเสมอ)
            else {                                    // กลุ่มชิดกว่า: ต้องผ่านกันชนก่อน
              const kd = isLower(R.def) ? 'lower' : 'upper', need = r.guard || Math.min(ctx.cfg.clear * refGap(ctx, kd), 0.5 * refMinDist(ctx, kd));
              const dx = L.m.originX + L.m.advance + med - R.m.originX;
              if (minDist(L.p, R.p, dx, need * 4) - 1.5 >= need) k = med;
            }
          }
          const Aref = refOf(R);
          if (-k * ctx.cfg.tuck < Math.max(3, dead * Aref)) k = 0;   // น้อยเกินไป ไม่ต้อง kern
          k = Math.round(k * ctx.cfg.strength * ctx.cfg.tuck * (leftShape(ctx, R) === 'f' ? ctx.cfg.flat : 1));
          if (k) out[a + '|' + b] = k;
        });
      });
    });
    return out;
  }

  const LatinKern = { compute, prepare, DEFAULTS, cfgOf };
  root.LatinKern = LatinKern;
  if (typeof module !== 'undefined' && module.exports) module.exports = LatinKern;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'latin-kern': '2.0.0-cba108e5' });
