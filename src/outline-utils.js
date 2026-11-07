/**
 * Outline utilities — แปลง/ตรวจ/จัดทิศทางเส้นเวกเตอร์จาก Illustrator
 *
 * รูปแบบเส้นที่รับจาก host (ต่อ 1 path):
 *   { p: [[ax,ay, lx,ly, rx,ry], ...], c: closed, f: filled, s: stroked, sw: strokeWidth,
 *     g: compoundGroupId (-1 = ไม่ใช่ compound), eo: evenodd, w: white fill }
 * พิกัดเป็น pt ของ Canvas (แกน y ชี้ขึ้น เหมือน Illustrator)
 */
(function (root) {
  'use strict';

  const EPS = 0.01;

  function segments(ct) {
    const pts = ct.p; const n = pts.length; const segs = [];
    const last = ct.c ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i]; const b = pts[(i + 1) % n];
      const line = Math.abs(a[4] - a[0]) < EPS && Math.abs(a[5] - a[1]) < EPS &&
                   Math.abs(b[2] - b[0]) < EPS && Math.abs(b[3] - b[1]) < EPS;
      segs.push({ x0: a[0], y0: a[1], x1: a[4], y1: a[5], x2: b[2], y2: b[3], x3: b[0], y3: b[1], line });
    }
    return segs;
  }

  function bez(s, t) {
    const mt = 1 - t;
    return [
      mt * mt * mt * s.x0 + 3 * mt * mt * t * s.x1 + 3 * mt * t * t * s.x2 + t * t * t * s.x3,
      mt * mt * mt * s.y0 + 3 * mt * mt * t * s.y1 + 3 * mt * t * t * s.y2 + t * t * t * s.y3
    ];
  }

  /** แปลงเป็น polygon (ไม่ซ้ำจุดแรก) */
  function flatten(ct, steps) {
    steps = steps || 12;
    const out = [];
    if (!ct.p || !ct.p.length) return out;
    out.push([ct.p[0][0], ct.p[0][1]]);
    segments(ct).forEach(s => {
      if (s.line) { out.push([s.x3, s.y3]); return; }
      for (let k = 1; k <= steps; k++) out.push(bez(s, k / steps));
    });
    if (ct.c && out.length > 1) {
      const f = out[0]; const l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < EPS && Math.abs(f[1] - l[1]) < EPS) out.pop();
    }
    return out;
  }

  function polyArea(poly) {
    let a = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const p = poly[i]; const q = poly[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function reverse(ct) {
    const p = ct.p.slice().reverse().map(q => [q[0], q[1], q[4], q[5], q[2], q[3]]);
    return Object.assign({}, ct, { p });
  }

  function bboxOfPolys(polys) {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    polys.forEach(poly => poly.forEach(([x, y]) => {
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }));
    if (xMin === Infinity) return null;
    return { xMin, yMin, xMax, yMax, width: xMax - xMin, height: yMax - yMin };
  }

  /** stroke → ชุด polygon โดยประมาณ (ใช้กับ preview เท่านั้น — ตอน export ใช้ Outline Stroke จริงของ Illustrator) */
  function strokeToContours(ct, width) {
    const r = Math.max(0.5, width / 2);
    const poly = flatten(ct, 10);
    if (ct.c && poly.length > 1) poly.push(poly[0]);
    const out = [];
    const circle = (cx, cy) => {
      const pts = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        pts.push([x, y, x, y, x, y]);
      }
      return { p: pts, c: true, f: true, g: -1 };
    };
    for (let i = 0; i < poly.length - 1; i++) {
      const [x0, y0] = poly[i]; const [x1, y1] = poly[i + 1];
      const dx = x1 - x0, dy = y1 - y0; const len = Math.hypot(dx, dy);
      if (len < EPS) continue;
      const nx = -dy / len * r, ny = dx / len * r;
      const quad = [[x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny], [x0 + nx, y0 + ny]];
      out.push({ p: quad.map(([x, y]) => [x, y, x, y, x, y]), c: true, f: true, g: -1 });
    }
    poly.forEach(([x, y]) => out.push(circle(x, y)));
    // ทุกชิ้นให้หมุนทวนเข็ม เพื่อ union ด้วย nonzero
    return out.map(c => polyArea(flatten(c, 2)) < 0 ? reverse(c) : c);
  }

  /**
   * จัดทิศทาง contour ให้ถูกต้องสำหรับฟอนต์ (nonzero, เส้นนอกทวนเข็ม)
   * - path แยกกัน: union (ทวนเข็มทั้งหมด)
   * - compound path even-odd: สลับทิศตามระดับการซ้อน (เกิดรูเจาะ)
   * - compound path nonzero: คงทิศเดิมตามที่ Illustrator แสดง แต่ให้เส้นใหญ่สุดทวนเข็ม
   * opts.previewStrokes: แปลง stroke เป็น polygon (สำหรับ preview)
   * คืน { contours, issues }
   */
  function normalize(paths, opts) {
    opts = opts || {};
    const issues = { strokes: 0, open: 0, white: 0 };
    const fills = [];
    (paths || []).forEach(pp => {
      if (!pp || !pp.p || !pp.p.length) return;
      const filled = pp.f !== false;
      if (pp.s && pp.sw > 0) {
        issues.strokes++;
        if (opts.previewStrokes) strokeToContours(pp, pp.sw).forEach(c => fills.push(Object.assign(c, { g: 'stroke' })));
      }
      if (!pp.c) {
        if (!filled) { if (!pp.s) issues.open++; return; }
      }
      if (!filled) return;
      if (pp.w) issues.white++;
      if (pp.p.length < 3) return;
      fills.push(Object.assign({}, pp, { c: true }));
    });

    // จัดกลุ่มตาม compound
    const groups = new Map(); let solo = 0;
    fills.forEach(ct => {
      const key = (ct.g === -1 || ct.g == null) ? ('solo' + (solo++)) : ('g' + ct.g);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ct);
    });

    const out = [];
    groups.forEach(list => {
      const polys = list.map(c => flatten(c, 8));
      const areas = polys.map(polyArea);
      if (list.length === 1) {
        // รูปสีขาวเดี่ยว ๆ ถือเป็น "รูเจาะ" (ตามเข็ม) — แจ้งเตือนผู้ใช้ให้ใช้ Compound Path แทน
        const wantCCW = !list[0].w;
        out.push((areas[0] > 0) === wantCCW ? list[0] : reverse(list[0]));
        return;
      }
      const evenodd = list.some(c => c.eo);
      if (evenodd) {
        list.forEach((ct, i) => {
          let depth = 0;
          const probe = polys[i][0];
          for (let j = 0; j < list.length; j++) {
            if (i !== j && Math.abs(areas[j]) > Math.abs(areas[i]) && pointInPoly(probe, polys[j])) depth++;
          }
          const wantCCW = depth % 2 === 0;
          out.push((areas[i] > 0) === wantCCW ? ct : reverse(ct));
        });
      } else {
        let big = 0;
        areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[big])) big = i; });
        const flip = areas[big] < 0;
        list.forEach(ct => out.push(flip ? reverse(ct) : ct));
      }
    });
    return { contours: out, issues };
  }

  function bbox(contours) {
    return bboxOfPolys(contours.map(c => flatten(c, 8)));
  }

  /** profile แนวนอน: สำหรับแต่ละระดับ y คืนค่า x ซ้ายสุด/ขวาสุดของหมึก */
  function profile(contours, yFrom, yTo, slices) {
    slices = slices || 24;
    const polys = contours.map(c => flatten(c, 10));
    const step = (yTo - yFrom) / slices;
    const res = [];
    for (let i = 0; i < slices; i++) {
      const y = yFrom + (i + 0.5) * step;
      let xl = Infinity, xr = -Infinity;
      polys.forEach(poly => {
        for (let k = 0, n = poly.length; k < n; k++) {
          const a = poly[k], b = poly[(k + 1) % n];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            const x = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
            if (x < xl) xl = x; if (x > xr) xr = x;
          }
        }
      });
      res.push({ y, xl: xl === Infinity ? null : xl, xr: xr === -Infinity ? null : xr });
    }
    return res;
  }

  /** ขอบเขตหมึกในช่วง y ที่กำหนด */
  function inkRangeX(contours, yFrom, yTo) {
    const prof = profile(contours, yFrom, yTo, 16);
    let xl = Infinity, xr = -Infinity;
    prof.forEach(s => { if (s.xl != null) { xl = Math.min(xl, s.xl); xr = Math.max(xr, s.xr); } });
    return xl === Infinity ? null : { xl, xr };
  }

  /** y ต่ำสุด/สูงสุดของหมึกในช่วง x */
  function inkRangeY(contours, xFrom, xTo) {
    let yMin = Infinity, yMax = -Infinity;
    contours.forEach(c => {
      const poly = flatten(c, 10);
      for (let k = 0, n = poly.length; k < n; k++) {
        const a = poly[k], b = poly[(k + 1) % n];
        // ตรวจจุดและจุดตัดเส้นแนวตั้ง x = xFrom / xTo
        [a].forEach(p => { if (p[0] >= xFrom && p[0] <= xTo) { yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); } });
        [xFrom, xTo].forEach(X => {
          if ((a[0] <= X && b[0] > X) || (b[0] <= X && a[0] > X)) {
            const y = a[1] + (X - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
            yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
          }
        });
      }
    });
    return yMin === Infinity ? null : { yMin, yMax };
  }

  function transform(contours, fx) {
    return contours.map(c => Object.assign({}, c, {
      p: c.p.map(q => {
        const a = fx(q[0], q[1]), l = fx(q[2], q[3]), r = fx(q[4], q[5]);
        return [a[0], a[1], l[0], l[1], r[0], r[1]];
      })
    }));
  }

  /** SVG path d (พลิกแกน y ด้วย flipY) */
  function toSvgD(contours, flipY) {
    const Y = y => (flipY - y).toFixed(1);
    let d = '';
    contours.forEach(c => {
      if (!c.p || !c.p.length) return;
      d += 'M' + c.p[0][0].toFixed(1) + ' ' + Y(c.p[0][1]);
      segments(c).forEach(s => {
        if (s.line) d += 'L' + s.x3.toFixed(1) + ' ' + Y(s.y3);
        else d += 'C' + s.x1.toFixed(1) + ' ' + Y(s.y1) + ' ' + s.x2.toFixed(1) + ' ' + Y(s.y2) + ' ' + s.x3.toFixed(1) + ' ' + Y(s.y3);
      });
      if (c.c) d += 'Z';
    });
    return d;
  }

  /** SVG สำหรับ path ดิบจาก host (แสดง stroke เป็น stroke จริง) */
  function rawToSvg(paths, flipY) {
    if (!paths || !paths.length) return '';
    let fillD = ''; let strokes = '';
    paths.forEach(pp => {
      if (!pp.p || !pp.p.length) return;
      if (pp.p.length === 1 || bboxOfPolys([flatten(pp, 2)]).width + bboxOfPolys([flatten(pp, 2)]).height < 0.01) {
        // จุดที่จิ้มด้วย Brush/Stroke (path ขนาด 0)
        if (pp.s && pp.sw > 0) strokes += '<circle cx="' + pp.p[0][0].toFixed(1) + '" cy="' + (flipY - pp.p[0][1]).toFixed(1) + '" r="' + (pp.sw / 2).toFixed(1) + '" fill="currentColor"/>';
        return;
      }
      const d = toSvgD([pp], flipY);
      if (pp.f !== false && !pp.w) fillD += d;
      if (pp.s && pp.sw > 0) strokes += '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + pp.sw + '" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    return (fillD ? '<path d="' + fillD + '" fill="currentColor" fill-rule="nonzero"/>' : '') + strokes;
  }

  /** contour → opentype.js Path (พิกัดฟอนต์ ผ่านฟังก์ชัน map) */
  function toOtPath(ot, contours, map, path) {
    path = path || new ot.Path();
    const R = v => Math.round(v);
    contours.forEach(c => {
      if (!c.p || c.p.length < 2) return;
      if (!c.p.every(q => q.length >= 6 && q.every(isFinite))) return;     // ข้อมูลเสีย (NaN/ว่าง) ข้ามทั้งเส้น
      const m = map(c.p[0][0], c.p[0][1]);
      path.moveTo(R(m[0]), R(m[1]));
      segments(c).forEach(s => {
        const e = map(s.x3, s.y3);
        if (s.line) path.lineTo(R(e[0]), R(e[1]));
        else {
          const a = map(s.x1, s.y1), b = map(s.x2, s.y2);
          path.curveTo(R(a[0]), R(a[1]), R(b[0]), R(b[1]), R(e[0]), R(e[1]));
        }
      });
      path.close();
    });
    return path;
  }

  /** contour → รูปแบบที่ใช้สร้าง path ใน Illustrator (เหมือนรูปแบบ host) */
  function fromOtCommands(commands, map) {
    const out = []; let cur = null; let px = 0, py = 0;
    const push = (x, y) => { const m = map(x, y); return [m[0], m[1], m[0], m[1], m[0], m[1]]; };
    commands.forEach(cmd => {
      if (cmd.type === 'M') {
        if (cur && cur.length) out.push(cur);
        cur = [push(cmd.x, cmd.y)]; px = cmd.x; py = cmd.y;
      } else if (cmd.type === 'L') {
        cur.push(push(cmd.x, cmd.y)); px = cmd.x; py = cmd.y;
      } else if (cmd.type === 'C' || cmd.type === 'Q') {
        let c1x, c1y, c2x, c2y;
        if (cmd.type === 'C') { c1x = cmd.x1; c1y = cmd.y1; c2x = cmd.x2; c2y = cmd.y2; }
        else {
          c1x = px + 2 / 3 * (cmd.x1 - px); c1y = py + 2 / 3 * (cmd.y1 - py);
          c2x = cmd.x + 2 / 3 * (cmd.x1 - cmd.x); c2y = cmd.y + 2 / 3 * (cmd.y1 - cmd.y);
        }
        const prev = cur[cur.length - 1]; const r = map(c1x, c1y); prev[4] = r[0]; prev[5] = r[1];
        const pt = push(cmd.x, cmd.y); const l = map(c2x, c2y); pt[2] = l[0]; pt[3] = l[1];
        cur.push(pt); px = cmd.x; py = cmd.y;
      } else if (cmd.type === 'Z') {
        if (cur && cur.length > 1) {
          const f = cur[0], l = cur[cur.length - 1];
          if (Math.abs(f[0] - l[0]) < 0.01 && Math.abs(f[1] - l[1]) < 0.01) { f[2] = l[2]; f[3] = l[3]; cur.pop(); }
        }
        if (cur && cur.length) out.push(cur);
        cur = null;
      }
    });
    if (cur && cur.length) out.push(cur);
    const r2 = v => Math.round(v * 100) / 100;
    return out.map(pts => pts.map(q => q.map(r2)));
  }

  const Outline = {
    segments, flatten, polyArea, pointInPoly, reverse, normalize, bbox, profile, inkRangeX, inkRangeY,
    transform, toSvgD, rawToSvg, toOtPath, fromOtCommands, strokeToContours
  };
  root.Outline = Outline;
  if (typeof module !== 'undefined' && module.exports) module.exports = Outline;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'outline-utils': '2.0.0-cba108e5' });
