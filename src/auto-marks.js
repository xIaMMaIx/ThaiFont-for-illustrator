/**
 * Auto Marks — วัดระยะสระ/วรรณยุกต์จากขอบหมึกจริง แล้วหาค่าที่ทำให้ระยะห่างสม่ำเสมอ
 *
 * หลักการ
 *  1. จำลองการวางสระ/วรรณยุกต์แบบเดียวกับที่ GPOS ทำตอนส่งออก (จุดยึดของพยัญชนะ ← จุดยึดของสระ)
 *  2. วัดระยะที่สั้นที่สุดระหว่างขอบหมึกของสระกับพยัญชนะ (หรือกับสระที่รองรับอยู่)
 *  3. ถ้าใกล้เกินไป → ยกขึ้น/ลดลงจนได้ระยะเป้าหมาย; ถ้าห่างเกินไป → ลดลงบางส่วนตามค่า "ตามรูปทรง"
 * หน่วยทั้งหมดเป็น pt บน Canvas
 */
(function (root) {
  'use strict';
  const O = () => root.Outline;
  const A = () => root.Anchors;
  const SP = () => root.Spacing;
  const G = () => root.GlyphData;

  const STEP = 5;        // ระยะห่างจุดตัวอย่างตามขอบ (pt)
  const CUT = 90;        // ไกลกว่านี้ถือว่าไม่เกี่ยวข้อง
  const VARIANT = { 'U+0E0D': 'U+F70F', 'U+0E10': 'U+F700' };   // ญ ฐ → ตัวตัดเชิง (ใช้กับสระล่าง)
  const clone = o => JSON.parse(JSON.stringify(o));
  const median = a => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ------------------------------------------------------------ geometry
  /** จุดตัวอย่างตามขอบทุก contour + polygon + กรอบ */
  function sample(contours) {
    const pts = [], polys = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    contours.forEach(c => {
      const poly = O().flatten(c, 8);
      if (poly.length < 2) return;
      polys.push(poly);
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
        for (let j = 0; j < k; j++) {
          const x = a[0] + (b[0] - a[0]) * j / k, y = a[1] + (b[1] - a[1]) * j / k;
          pts.push([x, y]);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    });
    return { pts, polys, bb: { x0, y0, x1, y1 } };
  }

  function insideAny(polys, p) {
    let n = 0;
    for (let i = 0; i < polys.length; i++) if (O().pointInPoly(p, polys[i])) n++;
    return (n % 2) === 1;
  }

  /** ระยะสั้นสุดจาก a (เลื่อน dx,dy) ถึง b — 0 ถ้าซ้อนกัน, CUT ถ้าไกลเกินไป */
  function minDist(a, b, dx, dy) {
    if (!a.pts.length || !b.pts.length) return CUT;
    const bx0 = a.bb.x0 + dx - CUT, bx1 = a.bb.x1 + dx + CUT, by0 = a.bb.y0 + dy - CUT, by1 = a.bb.y1 + dy + CUT;
    if (bx0 > b.bb.x1 || bx1 < b.bb.x0 || by0 > b.bb.y1 || by1 < b.bb.y0) return CUT;
    const near = [];
    for (let j = 0; j < b.pts.length; j++) {
      const p = b.pts[j];
      if (p[0] >= bx0 && p[0] <= bx1 && p[1] >= by0 && p[1] <= by1) near.push(p);
    }
    if (!near.length) return CUT;
    let best = CUT * CUT;
    for (let i = 0; i < a.pts.length; i++) {
      const x = a.pts[i][0] + dx, y = a.pts[i][1] + dy;
      for (let j = 0; j < near.length; j++) {
        const ex = x - near[j][0], ey = y - near[j][1], d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
    }
    // ซ้อนกันทั้งชิ้น (ขอบไม่ตัดกัน แต่อยู่ข้างใน)
    const pa = [a.pts[0][0] + dx, a.pts[0][1] + dy];
    if (insideAny(b.polys, pa)) return 0;
    if (insideAny(a.polys, [b.pts[0][0] - dx, b.pts[0][1] - dy])) return 0;
    return Math.sqrt(best);
  }

  // --------------------------------------------------------------- scene
  /** รวบรวมเส้นของพยัญชนะและสระ/วรรณยุกต์ที่วาดแล้ว  ctx.contoursFor(def) → contours | null */
  function buildScene(ctx) {
    const sc = { bases: {}, marks: {} };
    G().ALL_GLYPHS.forEach(def => {
      const isM = G().isMark(def);
      if (!def.thaiConsonant && !isM) return;
      const cont = ctx.contoursFor(def);
      if (!cont || !cont.length) return;
      const e = { def, contours: cont, smp: sample(cont) };
      if (isM) sc.marks[def.code] = e; else sc.bases[def.code] = e;
    });
    return sc;
  }

  function marksAnc(sc, S) {
    const out = [];
    Object.keys(sc.marks).forEach(code => {
      const e = sc.marks[code];
      const anc = A().markAnchor(e.def, e.contours, S);
      if (anc) out.push({ e, anc, code, kind: e.def.kind });
    });
    return out;
  }

  /** จุดยึดของพยัญชนะ โดยใช้ค่าปรับเฉพาะตัว ov = {tx,ty,bx,by} (ไม่ใช้ค่าใน S.anchors) */
  function anchorsOf(sc, S, baseE, ov) {
    const S2 = Object.assign({}, S, { anchors: Object.assign({}, S.anchors) });
    if (ov && Object.keys(ov).some(k => ov[k])) S2.anchors[baseE.def.code] = ov; else delete S2.anchors[baseE.def.code];
    const m = SP().measure(baseE.def, baseE.contours, S2);
    return m ? A().baseAnchors(baseE.def, baseE.contours, m, S2) : null;
  }

  const place = (baseA, anc) => {
    const t = anc.side === 'bottom' ? baseA.bottom : anc.side === 'through' ? baseA.through : baseA.top;
    return { dx: t.x - anc.anchor.x, dy: t.y - anc.anchor.y };
  };

  const STACK_UPPER = ['U+0E31', 'U+0E34', 'U+0E35'];
  const STACK_TONE = ['U+0E48', 'U+0E49'];

  function statusOf(d, minClear) { return d >= CUT ? 'ok' : d < 2 ? 'collide' : d < minClear ? 'near' : 'ok'; }
  const RANK = { ok: 0, through: 0, near: 1, collide: 2 };

  /**
   * ตรวจสระ/วรรณยุกต์ทุกแบบบนพยัญชนะ 1 ตัว ด้วยค่า S (และค่าปรับเฉพาะตัวใน S.anchors)
   * คืน { items:[{kind,codes,label,dist,status}], worst, minDist }
   */
  function evalBase(sc, S, def, minClear, mAnc) {
    const baseE = sc.bases[def.code]; if (!baseE) return null;
    const varE = VARIANT[def.code] ? sc.bases[VARIANT[def.code]] : null;
    const aTop = anchorsOf(sc, S, baseE, S.anchors[def.code]);
    if (!aTop) return null;
    const aLow = varE ? (anchorsOf(sc, S, varE, S.anchors[varE.def.code]) || aTop) : aTop;
    const lowBase = varE || baseE;
    mAnc = mAnc || marksAnc(sc, S);
    const items = [];
    const push = (kind, codes, dist, extra) => {
      const label = codes.map(c => G().BY_CODE[c].char).join('');
      const st = extra === 'through' ? 'through' : statusOf(dist, minClear);
      items.push({ kind, codes, label, dist: Math.round(dist * 10) / 10, status: st });
    };
    mAnc.forEach(m => {
      if (m.kind === 'mark-bottom') {
        const o = place(aLow, m.anc);
        push('lower', [m.code], minDist(m.e.smp, lowBase.smp, o.dx, o.dy));
      } else if (m.kind === 'mark-top') {
        if (m.anc.side === 'through' && aTop.tall) { push('upper', [m.code], CUT, 'through'); return; }
        const o = place(aTop, m.anc);
        push('upper', [m.code], minDist(m.e.smp, baseE.smp, o.dx, o.dy));
      } else if (m.kind === 'mark-tone') {
        const o = place(aTop, m.anc);
        push('tone', [m.code], minDist(m.e.smp, baseE.smp, o.dx, o.dy));
      }
    });
    // วรรณยุกต์ซ้อนบนสระบน
    STACK_UPPER.forEach(uc => STACK_TONE.forEach(tc => {
      const u = mAnc.find(m => m.code === uc), t = mAnc.find(m => m.code === tc);
      if (!u || !t || !u.anc.top2) return;
      const ou = place(aTop, u.anc);
      const shift = (u.anc.side === 'through' && aTop.tall) ? (aTop.top.x - aTop.through.x) : 0;
      const ta = t.anc.stack || t.anc.anchor;
      const tx = u.anc.top2.x + ou.dx - ta.x + shift, ty = u.anc.top2.y + ou.dy - ta.y;
      const d = Math.min(minDist(t.e.smp, u.e.smp, tx - ou.dx, ty - ou.dy), minDist(t.e.smp, baseE.smp, tx, ty));
      push('stack', [uc, tc], d);
    }));
    let worst = 'ok', md = CUT;
    items.forEach(i => { if (RANK[i.status] > RANK[worst]) worst = i.status; if (i.dist < md) md = i.dist; });
    return { items, worst, minDist: md, tall: !!aTop.tall };
  }

  // ------------------------------------------------------------- globals
  /** ความหนาเส้นโดยประมาณ: ความกว้างของหลักขวาที่ครึ่งความสูง (มัธยฐานทุกพยัญชนะ) */
  function stemWidth(sc, S) {
    const c = S.canvas, H = c.cap - c.baseline, ws = [];
    Object.keys(sc.bases).forEach(code => {
      const e = sc.bases[code]; if (e.def.isCutVariant) return;
      [0.3, 0.45, 0.6].forEach(f => {
        const y = c.baseline + H * f, xs = [];
        e.smp.polys.forEach(poly => {
          for (let k = 0, n = poly.length; k < n; k++) {
            const a = poly[k], b = poly[(k + 1) % n];
            if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
        });
        xs.sort((p, q) => p - q);
        let mn = Infinity;     // ความกว้างช่วงหมึกที่แคบที่สุด ≈ ความหนาเส้น
        for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1) mn = Math.min(mn, xs[i + 1] - xs[i]);
        if (mn < Infinity) ws.push(mn);
      });
    });
    return ws.length ? median(ws) : 0;
  }

  /**
   * ระยะรวม A–D จากความหนาเส้น + ปรับ B ให้ระยะวรรณยุกต์-สระได้ตามเป้า
   * เสนอเฉพาะระยะที่มีตัวอักษรวาดแล้วให้วัดจริง (ยังไม่วาดสระล่าง → ไม่แตะ C, ไม่มีพยัญชนะหางสูง → ไม่แตะ D ฯลฯ)
   */
  function proposeGlobals(sc, S) {
    const w = stemWidth(sc, S);
    if (!w) return { stemW: 0, C: S.marks.upperGap, marks: {} };
    const C = Math.max(10, Math.min(50, Math.round(w * 0.75)));
    const kinds = {}; Object.keys(sc.marks).forEach(k => { kinds[sc.marks[k].def.kind] = true; });
    const hasTop = kinds['mark-top'] || kinds['mark-tone'];
    const hasTall = hasTop && Object.keys(sc.bases).some(k => {
      const e = sc.bases[k]; if (e.def.isCutVariant) return false;
      const a = anchorsOf(sc, S, e, {}); return !!(a && a.tall);
    });
    const mk = {};
    if (hasTop) mk.upperGap = C;
    if (kinds['mark-bottom']) mk.lowerGap = Math.round(C * 0.9);
    if (hasTall) mk.tallGap = Math.round(C * 0.7);
    // B: วัดระยะวรรณยุกต์ซ้อนสระบนจริงบนพยัญชนะอ้างอิง (ก หรือตัวแรกที่วาด) แล้วชดเชย 2 รอบ — ไม่มีคู่ให้วัดก็ไม่เสนอ
    const target = Math.round(C * 0.7);
    const refCode = sc.bases['U+0E01'] ? 'U+0E01' : Object.keys(sc.bases).find(k => !sc.bases[k].def.isCutVariant && !sc.bases[k].def.tallStem);
    if (refCode) {
      let l2 = Math.round(C * 0.7), measured = false;
      for (let it = 0; it < 2; it++) {
        const S2 = clone(S); Object.assign(S2.marks, mk, { level2Gap: l2 }); S2.anchors = {};
        const ev = evalBase(sc, S2, sc.bases[refCode].def, 0);
        const ds = ev ? ev.items.filter(i => i.kind === 'stack' && i.dist < CUT).map(i => i.dist) : [];
        if (!ds.length) break;
        l2 = Math.max(-20, Math.min(120, Math.round(l2 + target - median(ds)))); measured = true;
      }
      if (measured) mk.level2Gap = l2;
    }
    return { stemW: w, C, marks: mk };
  }

  // -------------------------------------------------------------- solver
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));

  /**
   * ขอบขวาของหัวตัวต่อเนื่องลงไปถึงหลักหลังหรือไม่ (ไล่จากแถวที่หัวยื่นขวาสุดลงมา)
   * ก ค ด อ ว: ไหล่โค้งค่อย ๆ ออกไปเป็นหลักหลัง → สระควรหลบตามไหล่
   * ร ธ ห: หัวเป็นเส้นแยก ช่วงกลางขอบขวาหดเข้าไปลึก → หลักหลังคือส่วนที่ยื่นขวาสุด ไม่ต้องหลบ
   */
  function headJoinsStem(contours, canvas, stemX, headXr) {
    const H = canvas.cap - canvas.baseline, N = 40;
    const prof = O().profile(contours, canvas.baseline + 0.15 * H, canvas.cap - 0.02 * H, N);
    const yHead = canvas.cap - 0.18 * H;
    let top = -1;
    prof.forEach((s, i) => { if (s.y >= yHead && s.xr != null && (top < 0 || s.xr > prof[top].xr)) top = i; });
    if (top < 0) return true;
    for (let i = top - 1; i >= 0; i--) {
      const xr = prof[i].xr;
      if (xr == null || headXr - xr > 0.08 * H) return false;
      if (xr >= stemX - 2) return true;
    }
    return true;
  }

  /**
   * หาค่าปรับเฉพาะตัวของพยัญชนะ 1 ตัว (ซ้อนบนค่ารวมใน S)
   * คืน { [code]: {tx,ty,bx,by} } — ตัวตัดเชิง ญ ฐ แยกเป็นอีก code
   */
  function solveBase(sc, S, def, cf, mAnc) {
    const out = {};
    const baseE = sc.bases[def.code]; if (!baseE) return out;
    const C = S.marks.upperGap, Cl = S.marks.lowerGap;
    const tops = mAnc.filter(m => m.kind === 'mark-top' || m.kind === 'mark-tone');
    const lowers = mAnc.filter(m => m.kind === 'mark-bottom');

    // ---- บน ----
    const A0 = anchorsOf(sc, S, baseE, {});
    if (A0 && tops.length) {
      let tx = 0, ty = 0;
      if (!A0.tall) {      // หลักขวาที่หัวตัว (ไม่ใช่หลักกลางลำตัว) เป็นตำแหน่งที่สระควรอยู่
        const H = S.canvas.cap - S.canvas.baseline;
        const head = O().inkRangeX(baseE.contours, S.canvas.cap - 0.18 * H, S.canvas.cap - 0.02 * H);
        const dxh = head ? head.xr - A0.stemX : 0;     // เฉพาะกรณีปลายเท้า/หางด้านล่างยื่นขวากว่าหลักที่หัวตัว
        if (dxh <= -3 && dxh >= -0.15 * H && headJoinsStem(baseE.contours, S.canvas, A0.stemX, head.xr)) tx = Math.round(dxh);
      }
      const distTop = (ov) => {
        const a = anchorsOf(sc, S, baseE, ov); let d = CUT;
        tops.forEach(m => {
          if (m.anc.side === 'through' && a.tall) return;
          const o = place(a, m.anc); d = Math.min(d, minDist(m.e.smp, baseE.smp, o.dx, o.dy));
        });
        return d;
      };
      let d0 = distTop({ tx, ty: 0 });
      if (d0 < CUT) {
        const need = (A0.tall ? S.marks.tallGap : C) - d0;
        ty = need >= 0 ? need : cf.follow * need;
        ty = Math.round(lim(ty, -0.35 * C, 80));
        for (let i = 0; i < 40 && distTop({ tx, ty }) < cf.minClear; i++) ty += 2;
        // ยังชน (เช่น ชนหางสูงด้านข้าง) → ขยับซ้ายทีละน้อย
        for (let i = 0; i < 25 && distTop({ tx, ty }) < cf.minClear; i++) tx -= 3;
      }
      out[def.code] = { tx: tx, ty: ty };
    }

    // ---- ล่าง (ญ ฐ ใช้ตัวตัดเชิง) ----
    const lowE = VARIANT[def.code] && sc.bases[VARIANT[def.code]] ? sc.bases[VARIANT[def.code]] : baseE;
    const lowCode = lowE.def.code;
    const L0 = anchorsOf(sc, S, lowE, {});
    if (L0 && lowers.length) {
      const distLow = (ov) => {
        const a = anchorsOf(sc, S, lowE, ov); let d = CUT;
        lowers.forEach(m => { const o = place(a, m.anc); d = Math.min(d, minDist(m.e.smp, lowE.smp, o.dx, o.dy)); });
        return d;
      };
      const d0 = distLow({ by: 0 });
      let by = 0;
      if (d0 < CUT) {
        const need = Cl - d0;
        by = need >= 0 ? -need : -cf.follow * need;
        by = Math.round(lim(by, -80, 0.35 * Cl));
        for (let i = 0; i < 40 && distLow({ by }) < cf.minClear; i++) by -= 2;
      }
      out[lowCode] = Object.assign(out[lowCode] || {}, { by: by });
    }
    Object.keys(out).forEach(k => {
      ['tx', 'ty', 'bx', 'by'].forEach(p => { if (out[k][p] != null && Math.abs(out[k][p]) < 2) out[k][p] = 0; });
    });
    return out;
  }

  const AutoMarks = { buildScene, marksAnc, anchorsOf, evalBase, stemWidth, proposeGlobals, solveBase, minDist, sample, VARIANT, CUT, RANK, clone, median };
  root.AutoMarks = AutoMarks;
  if (typeof module !== 'undefined' && module.exports) module.exports = AutoMarks;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'auto-marks': '2.0.0-2e84cd1e' });
