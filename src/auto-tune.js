/**
 * Auto Tune — จูนช่องไฟ + ตำแหน่งสระ/วรรณยุกต์อัตโนมัติ แล้วให้ผู้ใช้ปรับละเอียดต่อ
 *
 * ขั้นตอน:  analyze() คำนวณข้อเสนอ (ไม่แตะค่าจริง) → ผู้ใช้ดูก่อน/หลัง → apply() → undo() ได้
 *  ช่องไฟ : ช่องไฟ = ช่องไฟพื้นฐาน − ความลึกของขอบเว้า (จำกัดความลึก) + ค่าชดเชยตามกลุ่มรูปทรง
 *  สระ    : ดู AutoMarks (ระยะจากขอบหมึกจริง)
 * ค่าที่ผู้ใช้ปรับเองจะไม่ถูกทับ (เว้นแต่เลือกเขียนทับ) — ตรวจจากการเทียบกับค่าที่ระบบเคยใส่ไว้ (autoTune.applied)
 */
(function (root) {
  'use strict';
  const O = () => root.Outline;
  const SP = () => root.Spacing;
  const G = () => root.GlyphData;
  const PS = () => root.ProjectSettings;
  const AM = () => root.AutoMarks;
  const clone = o => JSON.parse(JSON.stringify(o));
  const ANCHOR_KEYS = ['tx', 'ty', 'bx', 'by'];

  function defaults() {
    return {
      spacing: true, marks: true, globals: true, overwriteManual: false, scope: 'thai',
      depthCap: 0.2, curve: 0.6, follow: 0.5, minClear: 8,
      shapeAdjust: { flat: 0, soft: 0, deep: 0 },
      applied: { spacing: {}, anchors: {}, globals: {} }
    };
  }
  function cfgOf(S) {
    const d = defaults(), s = S.autoTune || {};
    const cf = Object.assign(d, s);
    cf.shapeAdjust = Object.assign({ flat: 0, soft: 0, deep: 0 }, s.shapeAdjust || {});
    cf.applied = { spacing: (s.applied && s.applied.spacing) || {}, anchors: (s.applied && s.applied.anchors) || {}, globals: (s.applied && s.applied.globals) || {} };
    return cf;
  }

  // ------------------------------------------------------ manual detection
  const z = v => Number(v) || 0;
  function isManualSpacing(S, code) {
    const cur = S.glyphSpacing[code]; if (!cur) return false;
    const ap = cfgOf(S).applied.spacing[code];
    return !(ap && z(ap.l) === z(cur.l) && z(ap.r) === z(cur.r));
  }
  function isManualAnchor(S, code) {
    const cur = S.anchors[code]; if (!cur || !ANCHOR_KEYS.some(k => z(cur[k]))) return false;
    const ap = cfgOf(S).applied.anchors[code] || {};
    return ANCHOR_KEYS.some(k => z(cur[k]) !== z(ap[k]));
  }

  /** ระยะรวม A–D: ผู้ใช้ตั้งเองถ้าค่าปัจจุบันไม่ใช่ค่าที่ระบบเคยใส่ (หรือค่าเริ่มต้น ถ้ายังไม่เคยจูน) */
  function isManualGlobal(S, key) {
    const cur = z(S.marks[key]), ap = cfgOf(S).applied.globals[key];
    if (ap != null) return cur !== z(ap);
    return cur !== z(PS().defaults().marks[key]);
  }

  // ---------------------------------------------------------------- spacing
  function shapeClass(depth, H) { const r = depth / H; return r < 0.04 ? 'flat' : r < 0.12 ? 'soft' : 'deep'; }

  /** คำนวณช่องไฟที่ควรเป็นของทุกตัวใน defs  → [{code,def,dl,dr,autoL,autoR,newL,newR,clsL,clsR}] */
  function proposeSpacing(ctx, S, defs, cf) {
    const base = S.spacing.base * PS().densityFactor(S.spacing.density);
    const out = [];
    defs.forEach(def => {
      if (G().isMark(def) || def.kind === 'auto' || def.isCutVariant) return;
      const cont = ctx.contoursFor(def); if (!cont || !cont.length) return;
      const m = SP().measure(def, cont, S); if (!m) return;
      const cap = cf.depthCap * m.zone.H, n = m.profile.length;
      let sl = 0, sr = 0, ws = 0;
      m.profile.forEach((s, i) => {
        if (s.xl == null) return;
        const w = (i < 2 || i >= n - 2) ? 0.5 : 1;     // ปลายบน-ล่างน้ำหนักน้อย (ไม่ให้ overshoot มีผลมาก)
        sl += w * Math.min(cap, Math.max(0, s.xl - m.xMin));
        sr += w * Math.min(cap, Math.max(0, m.xMax - Math.min(m.xMax, s.xr)));
        ws += w;
      });
      const dL = ws ? sl / ws : 0, dR = ws ? sr / ws : 0;
      const clsL = shapeClass(dL, m.zone.H), clsR = shapeClass(dR, m.zone.H);
      let L = Math.max(base * 0.2, base - cf.curve * dL + (cf.shapeAdjust[clsL] || 0));
      let R = Math.max(base * 0.2, base - cf.curve * dR + (cf.shapeAdjust[clsR] || 0));
      if (def.leadingVowel) R = Math.max(base * 0.12, R * S.spacing.leadingVowelRight);
      const newL = Math.round(L), newR = Math.round(R);
      let dl = newL - m.autoL, dr = newR - m.autoR;
      if (Math.abs(dl) < 2) dl = 0;
      if (Math.abs(dr) < 2) dr = 0;
      out.push({ code: def.code, def, dl, dr, autoL: m.autoL, autoR: m.autoR, newL: m.autoL + dl, newR: m.autoR + dr, clsL, clsR, depthL: dL, depthR: dR, advance: m.advance });
    });
    return out;
  }

  // ---------------------------------------------------------------- analyze
  /**
   * ctx: { contoursFor(def)→contours|null, defs:[def] (ขอบเขตที่ผู้ใช้เลือก) , consonants:[def] (ขอบเขตของสระ) }
   * คืนข้อเสนอ — ยังไม่เปลี่ยนค่าจริง
   */
  function analyze(ctx, S0) {
    const cf = cfgOf(S0);
    const P = clone(S0);
    const res = { cf, spacing: [], spacingSkipped: [], globals: [], globalsSkipped: [], anchors: [], anchorsSkipped: [], before: null, after: null, stemW: 0, counts: {} };

    // ---- ช่องไฟ ----
    if (cf.spacing) {
      proposeSpacing(ctx, S0, ctx.defs, cf).forEach(e => {
        const manual = isManualSpacing(S0, e.code);
        const cur = S0.glyphSpacing[e.code] || { l: 0, r: 0 };
        e.curL = z(cur.l); e.curR = z(cur.r); e.manual = manual;
        if (manual && !cf.overwriteManual) { res.spacingSkipped.push(e); return; }
        res.spacing.push(e);
      });
    }

    // ---- สระ/วรรณยุกต์ ----
    const wantMarks = cf.marks || cf.globals;
    const sc = wantMarks ? (ctx.scene || AM().buildScene(ctx)) : null;
    if (sc && Object.keys(sc.marks).length) {
      if (cf.globals) {
        const g = AM().proposeGlobals(sc, S0);
        res.stemW = g.stemW;
        Object.keys(g.marks).forEach(k => {
          if (S0.marks[k] === g.marks[k]) return;
          const ent = { key: k, from: S0.marks[k], to: g.marks[k], manual: isManualGlobal(S0, k) };
          if (ent.manual && !cf.overwriteManual) { res.globalsSkipped.push(ent); return; }
          res.globals.push(ent);
          P.marks[k] = g.marks[k];
        });
      }
      const minClear = cf.minClear;
      res.before = gridOf(sc, S0, ctx.allConsonants, minClear);
      if (cf.marks) {
        const mAnc = AM().marksAnc(sc, P);
        const cons = ctx.consonants.filter(d => sc.bases[d.code] && !d.isCutVariant);
        cons.forEach(def => {
          const sol = AM().solveBase(sc, P, def, cf, mAnc);
          Object.keys(sol).forEach(code => {
            const cur = S0.anchors[code] || {};
            const manual = isManualAnchor(S0, code);
            const ent = { code, def: G().BY_CODE[code], ov: sol[code], manual, cur: {} };
            ANCHOR_KEYS.forEach(k => { ent.cur[k] = z(cur[k]); });
            if (manual && !cf.overwriteManual) { res.anchorsSkipped.push(ent); return; }
            res.anchors.push(ent);
          });
        });
        // ใส่ลง P เพื่อวัดผลหลังปรับ
        res.anchors.forEach(e => {
          const cur = Object.assign({}, P.anchors[e.code] || {});
          ANCHOR_KEYS.forEach(k => { if (e.ov[k] != null) cur[k] = e.ov[k]; });
          if (ANCHOR_KEYS.some(k => z(cur[k])) || Object.keys(cur).some(k => ANCHOR_KEYS.indexOf(k) < 0 && z(cur[k]))) P.anchors[e.code] = cur;
          else delete P.anchors[e.code];
        });
      } else { P.anchors = clone(S0.anchors); }
      res.after = gridOf(sc, P, ctx.allConsonants, minClear);
    }
    res.counts = {
      spacing: res.spacing.filter(e => e.dl !== e.curL || e.dr !== e.curR).length,
      anchors: res.anchors.filter(e => ANCHOR_KEYS.some(k => e.ov[k] != null && z(e.ov[k]) !== e.cur[k])).length,
      globals: res.globals.length,
      skipped: res.spacingSkipped.length + res.anchorsSkipped.length + res.globalsSkipped.length
    };
    res.P = P;
    return res;
  }

  /** ผลตรวจทุกพยัญชนะ: { code: {worst, items, minDist} } */
  function gridOf(sc, S, consonants, minClear) {
    const grid = {}, mAnc = AM().marksAnc(sc, S);
    consonants.forEach(def => {
      if (def.isCutVariant || !sc.bases[def.code]) return;
      const ev = AM().evalBase(sc, S, def, minClear, mAnc);
      if (ev) grid[def.code] = ev;
    });
    return grid;
  }
  function gridCounts(grid) {
    const c = { ok: 0, near: 0, collide: 0 };
    Object.keys(grid || {}).forEach(k => { c[grid[k].worst === 'through' ? 'ok' : grid[k].worst]++; });
    return c;
  }

  // ------------------------------------------------------------- apply / undo
  function snapshot(S) {
    return clone({ glyphSpacing: S.glyphSpacing, anchors: S.anchors, marks: S.marks, applied: (S.autoTune && S.autoTune.applied) || { spacing: {}, anchors: {}, globals: {} } });
  }
  function restore(S, snap) {
    S.glyphSpacing = clone(snap.glyphSpacing); S.anchors = clone(snap.anchors); S.marks = clone(snap.marks);
    S.autoTune = S.autoTune || defaults(); S.autoTune.applied = clone(snap.applied);
  }

  /** ใส่ข้อเสนอลงค่าจริง คืน snapshot สำหรับย้อนกลับ */
  function apply(S, prop) {
    const snap = snapshot(S);
    S.autoTune = Object.assign(defaults(), S.autoTune || {});
    const ap = S.autoTune.applied = { spacing: Object.assign({}, S.autoTune.applied && S.autoTune.applied.spacing), anchors: Object.assign({}, S.autoTune.applied && S.autoTune.applied.anchors), globals: Object.assign({}, S.autoTune.applied && S.autoTune.applied.globals) };
    prop.spacing.forEach(e => {
      if (e.dl || e.dr) S.glyphSpacing[e.code] = { l: e.dl, r: e.dr }; else delete S.glyphSpacing[e.code];
      ap.spacing[e.code] = { l: e.dl, r: e.dr };
    });
    prop.globals.forEach(g => { S.marks[g.key] = g.to; ap.globals[g.key] = g.to; });
    prop.anchors.forEach(e => {
      const cur = Object.assign({}, S.anchors[e.code] || {});
      const rec = {};
      ANCHOR_KEYS.forEach(k => { if (e.ov[k] != null) { cur[k] = e.ov[k]; rec[k] = e.ov[k]; } });
      if (Object.keys(cur).some(k => z(cur[k]))) S.anchors[e.code] = cur; else delete S.anchors[e.code];
      ap.anchors[e.code] = Object.assign(ap.anchors[e.code] || {}, rec);
    });
    return snap;
  }

  /** ค่าตั้งค่าทดลอง (สำเนา) ที่ใส่ข้อเสนอแล้ว — ใช้คอมไพล์ฟอนต์ "หลัง" เทียบกับ "ก่อน" */
  function previewSettings(S0, prop) { const S = clone(S0); apply(S, prop); return S; }

  const AutoTune = { defaults, cfgOf, analyze, apply, restore, snapshot, previewSettings, gridOf, gridCounts, isManualSpacing, isManualAnchor, isManualGlobal, proposeSpacing, ANCHOR_KEYS };
  root.AutoTune = AutoTune;
  if (typeof module !== 'undefined' && module.exports) module.exports = AutoTune;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'auto-tune': '2.0.0-cba108e5' });
