/**
 * Anchor engine — หาจุดยึดสระ/วรรณยุกต์อัตโนมัติจากเส้นจริง
 *
 * กติกา (อธิบายง่าย ๆ):
 *  • สระบนและวรรณยุกต์ "ชิดขอบขวา" ของหลักขวาพยัญชนะ แล้วลอยเหนือหัวตัวอักษรตามระยะ "สระบน"
 *  • พยัญชนะหางสูง (ป ฝ ฟ ฬ และตัวที่หางเกินเส้น Cap เช่น ส ศ บางแบบ) → ขยับสระไปทางซ้ายของหาง
 *  • วรรณยุกต์บนสระบน (ปี่ กิ้) → ซ้อนเหนือสระตามระยะ "วรรณยุกต์ซ้อน" แล้วเลื่อนซ้าย/ขวาได้ 3 ชั้น:
 *    ทุกตัว (marks.stackX) + ตามวรรณยุกต์ (marks.tonesStack) + ตามสระบน (anchors[สระ].sx/sy)
 *  • สระล่างชิดขอบขวาของหลักขวาด้านล่าง ห่างจากเส้นฐาน/หางล่างตามระยะ "สระล่าง"
 * พิกัดทั้งหมดเป็น pt บน Canvas
 * (พัฒนาต่อจากแนวคิด F0NT Autotune ของชุมชนออกแบบฟอนต์ไทย)
 */
(function (root) {
  'use strict';
  const O = () => root.Outline;

  function crossingsAt(polys, y) {
    const xs = [];
    polys.forEach(poly => {
      for (let k = 0, n = poly.length; k < n; k++) {
        const a = poly[k], b = poly[(k + 1) % n];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    });
    return xs;
  }

  /** ตรวจหางสูงด้านขวา คืน x ซ้ายสุดของหาง หรือ null */
  function detectTall(contours, bbox, canvas) {
    const thr = Math.max(20, 0.25 * (canvas.ascender - canvas.cap));
    const yFrom = canvas.cap + thr;
    if (bbox.yMax <= yFrom + 4) return null;
    const polys = contours.map(c => O().flatten(c, 10));
    const minX = bbox.xMin + bbox.width * 0.4;
    let left = Infinity, right = -Infinity;
    for (let i = 0; i < 8; i++) {
      const y = yFrom + (bbox.yMax - yFrom) * (i + 0.5) / 8;
      crossingsAt(polys, y).forEach(x => {
        if (x >= minX) { left = Math.min(left, x); right = Math.max(right, x); }
      });
    }
    if (left === Infinity || right < bbox.xMin + bbox.width * 0.55) return null;
    return left;
  }

  /**
   * จุดยึดของตัวฐาน (พยัญชนะ)
   * m: ผลจาก Spacing.measure  คืน { top:{x,y}, bottom:{x,y}, tall, stemX }
   */
  function baseAnchors(def, contours, m, settings) {
    const c = settings.canvas, mk = settings.marks;
    const bbox = m.bbox; const H = c.cap - c.baseline; const w = Math.max(1, bbox.width);
    const body = O().inkRangeX(contours, c.baseline + 0.15 * H, c.cap - 0.15 * H);
    const stemX = body ? body.xr : bbox.xMax;
    const ov = (settings.anchors && settings.anchors[def.code]) || {};

    let tallLeft = null;
    if (def.thaiConsonant) tallLeft = detectTall(contours, bbox, c);

    let top;
    if (tallLeft != null) {
      top = { x: tallLeft - mk.tallGap, y: c.cap + mk.upperGap };
    } else {
      const yr = O().inkRangeY(contours, stemX - 0.35 * w, stemX + 1);
      const yTop = Math.max(c.cap, yr ? yr.yMax : c.cap);
      top = { x: stemX, y: yTop + mk.upperGap };
    }
    top.x += (mk.upperX || 0) + (Number(ov.tx) || 0);
    top.y += Number(ov.ty) || 0;
    // จุดยึดสำหรับเครื่องหมายที่ "ทะลุหางสูง" ได้ (เช่น ั): วางตำแหน่งปกติบนหลักขวา ไม่หลบซ้าย
    const through = tallLeft == null ? { x: top.x, y: top.y } : {
      x: stemX + (mk.upperX || 0) + (Number(ov.tx) || 0),
      y: c.cap + mk.upperGap + (Number(ov.ty) || 0)
    };

    const low = O().inkRangeX(contours, c.baseline + 0.02 * H, c.baseline + 0.25 * H);
    const bx = low ? low.xr : stemX;
    const yr2 = O().inkRangeY(contours, bx - 0.4 * w, bx + 1);
    const yLow = Math.min(c.baseline, yr2 ? yr2.yMin : c.baseline);
    const bottom = { x: bx + (mk.lowerX || 0) + (Number(ov.bx) || 0), y: yLow - mk.lowerGap + (Number(ov.by) || 0) };

    return { top, bottom, through, tall: tallLeft != null, stemX };
  }

  /**
   * จุดยึดของสระ/วรรณยุกต์ (ในพิกัดของตัวมันเอง)
   * คืน { anchor:{x,y}, top2:{x,y}|null, stack:{x,y}|undefined, side:'top'|'bottom' }
   *   top2  = จุดที่สระบนรับวรรณยุกต์ซ้อน · stack = จุดยึดของวรรณยุกต์เมื่อซ้อนบนสระบน (ใช้ใน mkmk แทน anchor)
   */
  function markAnchor(def, contours, settings) {
    const bbox = O().bbox(contours);
    if (!bbox) return null;
    const mk = settings.marks;
    const ov = (settings.anchors && settings.anchors[def.code]) || {};
    const dx = Number(ov.x) || 0, dy = Number(ov.y) || 0;   // + = เลื่อนขวา / ขึ้น
    if (def.kind === 'mark-bottom') {
      return { side: 'bottom', bbox, anchor: { x: bbox.xMax - dx, y: bbox.yMax - dy }, top2: null };
    }
    let x = bbox.xMax;
    if (def.kind === 'mark-tone') x -= Number((mk.tones || {})[def.code]) || 0;
    const pass = def.kind === 'mark-top' && !!(mk.passThrough || {})[def.code];
    const res = { side: pass ? 'through' : 'top', bbox, anchor: { x: x - dx, y: bbox.yMin - dy }, top2: null };
    if (def.kind === 'mark-top') {
      const sx = Number(ov.sx) || 0, sy = Number(ov.sy) || 0;
      res.top2 = { x: bbox.xMax + (Number(mk.stackX) || 0) + sx, y: bbox.yMax + mk.level2Gap + sy };
    }
    if (def.kind === 'mark-tone') {
      const st = Number((mk.tonesStack || {})[def.code]) || 0;
      res.stack = { x: res.anchor.x - st, y: res.anchor.y };
    }
    return res;
  }

  const Anchors = { baseAnchors, markAnchor, detectTall };
  root.Anchors = Anchors;
  if (typeof module !== 'undefined' && module.exports) module.exports = Anchors;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'anchors': '2.0.0-2e84cd1e' });
