/**
 * Font Compiler — แปลงเส้นจาก Illustrator เป็นไฟล์ OpenType (.otf, CFF)
 *
 * ขั้นตอน:
 *  1. จัดทิศทางเส้น (รูเจาะ/รวมรูป) และวัดช่องไฟ  → Spacing
 *  2. หาจุดยึดสระ/วรรณยุกต์                       → Anchors
 *  3. สร้าง glyph ด้วย opentype.js
 *  4. เขียน GDEF / GSUB / GPOS เอง                → ThaiLayout + OTLWriter
 *  5. ค่าความสูงบรรทัด (win/typo/hhea) คำนวณจากเส้นจริง กันหัว/หางถูกตัด
 */
(function (root) {
  'use strict';
  const G = () => root.GlyphData;
  const O = () => root.Outline;

  function getOpentype() {
    if (root.opentype) return root.opentype;
    if (typeof require !== 'undefined') {
      try { return require('opentype.js'); } catch (e) { /* ignore */ }
    }
    throw new Error('ไม่พบไลบรารี opentype.js');
  }

  const WEIGHTS = [
    [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300], [/semi\s*bold|demi/i, 600],
    [/extra\s*bold|ultra\s*bold/i, 800], [/black|heavy/i, 900], [/medium/i, 500], [/bold/i, 700]
  ];
  function weightOf(style) {
    for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
    return 400;
  }

  function boxContours(x0, y0, x1, y1, t) {
    const P = (x, y) => [x, y, x, y, x, y];
    return [
      { p: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], c: true, g: -1 },
      { p: [P(x0 + t, y0 + t), P(x0 + t, y1 - t), P(x1 - t, y1 - t), P(x1 - t, y0 + t)], c: true, g: -1 }
    ];
  }

  function dottedCircle(canvas) {
    const H = canvas.cap - canvas.baseline;
    const cx = canvas.lsbGuide + H * 0.36, cy = canvas.baseline + H * 0.5, R = H * 0.32, r = H * 0.04;
    const out = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      const k = r * 0.5523;
      out.push({
        c: true, g: -1, p: [
          [x + r, y, x + r, y - k, x + r, y + k], [x, y + r, x + k, y + r, x - k, y + r],
          [x - r, y, x - r, y + k, x - r, y - k], [x, y - r, x - k, y - r, x + k, y - r]
        ]
      });
    }
    return out;
  }

  /**
   * compile(options)
   *  settings: ProjectSettings
   *  outlines: { 'U+0E01': [hostPath...] }  (pt)
   *  glyphs: glyph definitions ที่จะใส่ในฟอนต์
   *  mode: 'export' | 'preview'
   */
  function compile(options) {
    const ot = getOpentype();
    const settings = options.settings;
    const outlines = root.ProjectSettings.applyAdjust(options.outlines || {}, settings);
    const mode = options.mode || 'export';
    const c = settings.canvas;
    const upm = parseInt(settings.info.upm, 10) || 1000;
    const s = upm / c.em;
    const mk = settings.marks;
    const defaultRsb = settings.spacing.base * root.ProjectSettings.densityFactor(settings.spacing.density);
    const report = { warnings: [], glyphIssues: {}, missing: [], drawn: 0, kernPairs: 0 };

    const recs = [];          // record ต่อ glyph (ยังไม่มี gid)
    const byCode = {};
    const addRec = r => { recs.push(r); if (r.code) byCode[r.code] = r; return r; };

    const wanted = options.glyphs || G().ALL_GLYPHS;
    const hasArt = code => Array.isArray(outlines[code]) && outlines[code].length > 0;

    // --- 1) วัดและเตรียมทุกตัว ---
    function prepareBase(def, contours) {
      const m = root.Spacing.measure(def, contours, settings);
      if (!m) return null;
      const r = { def, code: def.code, kind: 'base', contours, m, name: G().glyphName(def), unicode: G().codeToInt(def.code) };
      if (def.thaiConsonant || def.code === 'U+25CC') r.anchorsPt = root.Anchors.baseAnchors(def, contours, m, settings);
      return r;
    }

    const later = [];
    wanted.forEach(def => {
      if (def.kind === 'auto') { later.push(def); return; }
      if (def.isCutVariant) { later.push(def); return; }
      if (!hasArt(def.code)) {
        report.missing.push(def.code);
        const wantBox = (settings.export.fallback && mode === 'export') || (mode === 'preview' && options.previewBoxes);
        if (mode === 'preview' && options.previewBoxes && G().isMark(def)) {
          // กล่องเล็กแทนสระ/วรรณยุกต์ที่ยังไม่วาด (ให้ทั้งพยางค์ยังแสดงด้วยฟอนต์ทดลอง)
          const H = c.cap - c.baseline, sz = H * 0.16, x0 = c.em / 2;
          const y0 = def.kind === 'mark-bottom' ? c.baseline - sz * 2 : c.cap + sz;
          const box = boxContours(x0, y0, x0 + sz, y0 + sz, 4);
          const ma = root.Anchors.markAnchor(def, box, settings);
          if (ma) addRec({ def, code: def.code, kind: def.kind, contours: box, markPt: ma, name: G().glyphName(def), unicode: G().codeToInt(def.code), fallback: true });
          return;
        }
        if (wantBox && !G().isMark(def)) {
          const H = c.cap - c.baseline;
          const box = boxContours(c.lsbGuide, c.baseline, c.lsbGuide + H * 0.62, c.cap, mode === 'preview' ? 6 : 30);
          const r = prepareBase(def, box); if (r) { r.fallback = true; addRec(r); }
        }
        return;
      }
      try {
        const norm = O().normalize(outlines[def.code], { previewStrokes: true });
        if (norm.issues.strokes || norm.issues.open || norm.issues.white) report.glyphIssues[def.code] = norm.issues;
        if (!norm.contours.length) { report.missing.push(def.code); return; }
        if (G().isMark(def)) {
          const ma = root.Anchors.markAnchor(def, norm.contours, settings);
          if (ma) addRec({ def, code: def.code, kind: def.kind, contours: norm.contours, markPt: ma, name: G().glyphName(def), unicode: G().codeToInt(def.code) });
        } else {
          const r = prepareBase(def, norm.contours); if (r) addRec(r);
        }
        report.drawn++;
      } catch (err) {
        // ตัวเดียวพังไม่ควรทำให้ทั้งฟอนต์ทดลองสร้างไม่ได้
        report.warnings.push(def.name + ': ข้ามตัวนี้ — ' + (err && err.message));
        report.missing.push(def.code);
      }
    });

    // ตัดเชิง ญ / ฐ
    later.filter(d => d.isCutVariant).forEach(def => {
      const parent = byCode[def.baseCode];
      let contours = null; let derived = false;
      if (hasArt(def.code)) {
        contours = O().normalize(outlines[def.code], { previewStrokes: true }).contours;
      } else if (parent) {
        const cutY = c.baseline + 4;
        contours = parent.contours.filter(ct => { const b = O().bbox([ct]); return b && b.yMax > cutY; });
        derived = true;
        if (contours.length === parent.contours.length) {
          report.warnings.push(def.name + ': เชิงต่อเป็นชิ้นเดียวกับตัวอักษร ตัดอัตโนมัติตอน export ไม่ได้ — กดปุ่ม "ตัดเชิงอัตโนมัติ" ใน Illustrator');
          return;
        }
      }
      if (!contours || !contours.length) return;
      const r = prepareBase(def, contours);
      if (!r) return;
      if (parent) { r.m.originX = parent.m.originX; r.m.advance = parent.m.advance; }
      r.isCutVariant = true; r.baseCode = def.baseCode; r.derived = derived;
      r.unicode = G().codeToInt(def.code);    // คง PUA เดิมไว้เพื่อโปรแกรมรุ่นเก่า
      addRec(r);
    });

    // วงกลมจุด (◌) สำหรับสระที่ไม่มีพยัญชนะนำ
    const hasMarks = recs.some(r => r.markPt);
    if (hasMarks) {
      const dc = prepareBase({ code: 'U+25CC', kind: 'base', thaiConsonant: false }, dottedCircle(c));
      if (dc) { dc.name = 'uni25CC'; addRec(dc); }
    }

    // --- 2) แปลงเป็นหน่วยฟอนต์ ---
    const legacyX = -Math.round(defaultRsb * s);
    const legacyTopY = Math.round((c.cap + mk.upperGap - c.baseline) * s);
    const legacyBottomY = Math.round(-mk.lowerGap * s);

    // เส้นฐานเฉพาะตัว/รูปสลับ: วัดช่องไฟ/จุดยึดจากรูปเดิมแล้วค่อยยกตอนแปลงพิกัด จุดยึดจึงยกตาม สระย้ายไปพร้อมตัวฐาน
    function placeBase(r, lift) {
      const ox = r.m.originX;
      r.map = (x, y) => [(x - ox) * s, (y + lift - c.baseline) * s];
      r.advance = Math.round(r.m.advance * s);
      if (r.anchorsPt) {
        const t = r.map(r.anchorsPt.top.x, r.anchorsPt.top.y), b = r.map(r.anchorsPt.bottom.x, r.anchorsPt.bottom.y);
        const thr = r.anchorsPt.through || r.anchorsPt.top;
        const th = r.map(thr.x, thr.y);
        r.anchors = {
          top: { x: Math.round(t[0]), y: Math.round(t[1]) }, bottom: { x: Math.round(b[0]), y: Math.round(b[1]) },
          through: { x: Math.round(th[0]), y: Math.round(th[1]) }, tall: !!r.anchorsPt.tall
        };
      }
      r.path = O().toOtPath(ot, r.contours, r.map);
    }
    const altLifts = root.ProjectSettings.altLifts(settings);
    const altCodes = new Set(altLifts.length ? root.ProjectSettings.baselineTargets(settings.baselineAlt.scope) : []);

    recs.slice().forEach(r => {
      if (r.markPt) {
        const a = r.markPt.anchor;
        const Ax = legacyX, Ay = r.markPt.side === 'bottom' ? legacyBottomY : legacyTopY;  // 'through' ใช้ตำแหน่งบนเหมือนสระบน
        r.map = (x, y) => [(x - a.x) * s + Ax, (y - a.y) * s + Ay];
        r.advance = 0;
        r.mark = { side: r.markPt.side, anchor: { x: Ax, y: Ay } };
        if (r.markPt.top2) {
          const t = r.map(r.markPt.top2.x, r.markPt.top2.y);
          r.mark.top2 = { x: Math.round(t[0]), y: Math.round(t[1]) };
        }
        if (r.markPt.stack) {
          const t = r.map(r.markPt.stack.x, r.markPt.stack.y);
          r.mark.stack = { x: Math.round(t[0]), y: Math.round(t[1]) };
        }
        r.path = O().toOtPath(ot, r.contours, r.map);
        return;
      }
      const lift = root.ProjectSettings.baselineOf(settings, r.code);
      placeBase(r, lift);
      // รูปสลับ: ไม่มี code/def จึงไม่ปนกับรูปปกติใน byCode, Kerning อัตโนมัติ และคำเตือน Descender
      if (!r.fallback && altCodes.has(r.isCutVariant ? r.baseCode : r.code)) {
        r.alts = altLifts.map((d, i) => {
          const alt = { kind: 'base', contours: r.contours, m: r.m, anchorsPt: r.anchorsPt, name: r.name + '.alt' + (i + 1), altOf: r.code };
          placeBase(alt, lift + d);
          recs.push(alt);
          return alt;
        });
      }
    });

    // สระอำ: ใช้ที่วาดเอง หรือรวมรูปจาก ํ + า
    later.filter(d => d.kind === 'auto').forEach(def => {
      if (hasArt(def.code)) {
        const norm = O().normalize(outlines[def.code], { previewStrokes: true });
        const r = prepareBase(def, norm.contours);
        if (r) {
          const lift = root.ProjectSettings.baselineOf(settings, r.code);
          r.map = (x, y) => [(x - r.m.originX) * s, (y + lift - c.baseline) * s];
          r.advance = Math.round(r.m.advance * s); r.path = O().toOtPath(ot, r.contours, r.map); addRec(r);
        }
        return;
      }
      const aa = byCode['U+0E32'], nik = byCode['U+0E4D'];
      if (!aa || !nik) return;
      const p = new ot.Path();
      O().toOtPath(ot, aa.contours, aa.map, p);
      // ํ ในรูปรวมต้องยกตาม า (ถ้า า มีเส้นฐานเฉพาะตัว)
      const aaLift = root.ProjectSettings.baselineOf(settings, 'U+0E32') * s;
      O().toOtPath(ot, nik.contours, (x, y) => { const q = nik.map(x, y); return [q[0], q[1] + aaLift]; }, p);
      addRec({ def, code: def.code, kind: 'base', name: 'uni0E33', unicode: 0x0E33, path: p, advance: aa.advance, composed: true });
    });

    // --- 3) สร้าง glyph opentype ---
    const notdef = new ot.Path();
    const nd = Math.round(0.5 * upm), ndh = Math.round((c.cap - c.baseline) * s);
    O().toOtPath(ot, boxContours(0, 0, nd * 0.8, ndh, Math.round(upm * 0.05)), (x, y) => [x + upm * 0.05, y], notdef);
    const notdefGlyph = new ot.Glyph({ name: '.notdef', advanceWidth: nd, path: notdef });
    notdefGlyph.leftSideBearing = Math.round(notdef.getBoundingBox().x1);
    const glyphs = [notdefGlyph];
    glyphs.push(new ot.Glyph({ name: 'space', unicodes: [0x20, 0xA0], advanceWidth: Math.round(settings.metrics.spaceWidth * s), path: new ot.Path() }));
    glyphs.push(new ot.Glyph({ name: 'uni200B', unicodes: [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF], advanceWidth: 0, path: new ot.Path() }));

    const usedNames = new Set(['.notdef', 'space', 'uni200B']);
    let yMaxAll = 0, yMinAll = 0;
    recs.forEach(r => {
      let name = r.name;
      while (usedNames.has(name)) name += '.alt';
      usedNames.add(name);
      const bb = r.path.getBoundingBox();
      const empty = !r.path.commands.length;
      const g = new ot.Glyph({ name, unicode: r.unicode, advanceWidth: r.advance, path: r.path });
      g.leftSideBearing = empty ? 0 : Math.round(bb.x1);
      r.gid = glyphs.length;
      r.glyphName = name;
      glyphs.push(g);
      if (!empty) { yMaxAll = Math.max(yMaxAll, bb.y2); yMinAll = Math.min(yMinAll, bb.y1); }
      r.yMaxF = empty ? 0 : bb.y2; r.yMinF = empty ? 0 : bb.y1;
    });

    // --- 4) Kerning ---
    const kern = new Map();
    const LATIN_GROUPS = { 'latin-upper': 1, 'latin-lower': 1, 'digit': 1, 'punct': 1 };
    const bases = recs.filter(r => r.m && !r.markPt && !r.isCutVariant && !r.fallback && r.def && r.def.group &&
      (settings.kerning.scope === 'all' || LATIN_GROUPS[r.def.group]));
    const pairVal = {};
    if (settings.kerning.auto) {
      // ตัวอักษรละติน/ตัวเลข: คำนวณจากรูปตัวอักษรจริงในโปรเจกต์ (LatinKern) — ที่เหลือใช้วิธีเดิม
      const LK_GROUPS = { 'latin-upper': 1, 'latin-lower': 1, 'digit': 1 };
      const useLK = !!root.LatinKern;
      if (useLK) {
        try {
          const lk = root.LatinKern.compute(bases.filter(r => LK_GROUPS[r.def.group]).map(r => ({ def: r.def, code: r.code, contours: r.contours, m: r.m })), settings);
          Object.keys(lk).forEach(k => { pairVal[k] = lk[k]; });
        } catch (eLK) { report.warnings.push('kerning ละติน: ' + eLK.message); }
      }
      bases.forEach(L => bases.forEach(R => {
        if (useLK && LK_GROUPS[L.def.group] && LK_GROUPS[R.def.group]) return;
        const v = root.Spacing.autoKern(L.m, R.m, settings);
        if (v) pairVal[L.code + '|' + R.code] = v;
      }));
    }
    Object.keys(settings.kerning.pairs || {}).forEach(k => { pairVal[k] = Number(settings.kerning.pairs[k]) || 0; });
    Object.keys(pairVal).forEach(k => {
      const v = Math.round(pairVal[k] * s); if (!v) return;
      const [a, b] = k.split('|'); const L = byCode[a], R = byCode[b];
      if (!L || !R || L.markPt || R.markPt) return;
      // รูปสลับใช้ kerning เดียวกับรูปปกติ
      [L].concat(L.alts || []).forEach(l => {
        if (!kern.has(l.gid)) kern.set(l.gid, []);
        [R].concat(R.alts || []).forEach(r => kern.get(l.gid).push({ second: r.gid, value: v }));
      });
      report.kernPairs++;
    });

    // --- 5) Line metrics (กันหัว/หางถูกตัดบน Windows) ---
    const topBases = recs.filter(r => r.anchors);
    const uppers = recs.filter(r => r.mark && r.mark.top2);
    const tones = recs.filter(r => r.mark && r.kind === 'mark-tone');
    const lowers = recs.filter(r => r.mark && r.mark.side === 'bottom');
    const maxOf = (arr, f) => arr.reduce((v, x) => Math.max(v, f(x)), 0);
    let stackTop = 0, stackBottom = 0;
    if (topBases.length) {
      const baseTop = maxOf(topBases, r => r.anchors.top.y);
      const upperH = maxOf(uppers, r => r.mark.top2.y - r.mark.anchor.y);
      const toneH = maxOf(tones, r => r.yMaxF - r.mark.anchor.y);
      const upperOnly = maxOf(uppers, r => r.yMaxF - r.mark.anchor.y);
      stackTop = baseTop + Math.max(upperOnly, upperH + toneH, toneH);
      const baseBottom = topBases.reduce((v, r) => Math.min(v, r.anchors.bottom.y), 0);
      const lowerH = maxOf(lowers, r => r.mark.anchor.y - r.yMinF);
      stackBottom = baseBottom - lowerH;
    }
    const winAscent = Math.ceil(Math.max(yMaxAll, stackTop, upm * 0.75));
    const winDescent = Math.ceil(Math.max(-yMinAll, -stackBottom, upm * 0.25));
    let asc, desc, gap;
    if (settings.metrics.mode === 'manual') {
      asc = parseInt(settings.metrics.ascender, 10) || winAscent;
      desc = parseInt(settings.metrics.descender, 10) || -winDescent;
      gap = parseInt(settings.metrics.lineGap, 10) || 0;
    } else { asc = winAscent; desc = -winDescent; gap = 0; }
    report.metrics = { ascender: asc, descender: desc, lineGap: gap, winAscent, winDescent, upm, lineHeight: (asc - desc + gap) / upm };

    // --- ตัวที่หมึกลงต่ำกว่าเส้น Descender ที่ตั้งไว้ (เช่น หางอักษรวิจิตร) ---
    {
      const guide = (c.descender - c.baseline) * s;           // ค่าลบ (หน่วยฟอนต์)
      const deep = recs.filter(r => r.def && !G().isMark(r.def) && r.yMinF < guide - 1)
        .sort((a, b) => a.yMinF - b.yMinF);
      report.deepGlyphs = deep.map(r => ({ code: r.code, name: r.name, below: Math.round(guide - r.yMinF) }));
      if (deep.length) {
        const list = deep.slice(0, 6).map(r => (r.def.char || r.name) + ' (' + Math.round(r.yMinF) + ')').join(' ') + (deep.length > 6 ? ' …' : '');
        const baseDesc = Math.ceil(Math.max(-guide, upm * 0.25));
        report.warnings.push('หมึกลงต่ำกว่าเส้น Descender: ' + list + ' หน่วย — ' +
          (settings.metrics.mode === 'manual'
            ? 'โหมด Manual: ส่วนที่เกิน ' + desc + ' อาจถูกตัดในบางโปรแกรม'
            : 'Descender ของฟอนต์จึงเป็น ' + (-desc) + ' (ปกติ ' + baseDesc + ') ระยะบรรทัดกว้างขึ้น ' + Math.round(((-desc) - baseDesc) / upm * 100) + '% ของ em — ยกตัวขึ้นด้วยช่อง "แนวตั้ง" หรือตั้ง Metrics เป็น Manual'));
      }
    }

    // --- 6) Font object ---
    const info = settings.info;
    const style = (info.style || 'Regular').trim() || 'Regular';
    const weight = weightOf(style);
    const italic = /italic|oblique/i.test(style);
    let fsSel = 0x80; // USE_TYPO_METRICS
    if (italic) fsSel |= 0x01;
    if (weight >= 700 && /bold/i.test(style)) fsSel |= 0x20;
    if (!italic && !(fsSel & 0x20)) fsSel |= 0x40;
    const year = new Date().getFullYear();
    const version = String(info.version || '1.000').replace(/^version\s*/i, '');
    const font = new ot.Font({
      familyName: (info.family || 'MyThaiFont').trim(), styleName: style, unitsPerEm: upm,
      ascender: asc, descender: desc,
      designer: info.designer || '', manufacturer: info.designer || '',
      copyright: info.copyright || ('Copyright (c) ' + year + ' ' + (info.designer || info.family)),
      version: 'Version ' + version,
      description: 'Created with Thai Font Studio for Adobe Illustrator',
      glyphs
    });
    font.tables.os2 = {
      usWeightClass: weight, fsSelection: fsSel,
      sTypoAscender: asc, sTypoDescender: desc, sTypoLineGap: gap,
      usWinAscent: winAscent, usWinDescent: winDescent,
      ulCodePageRange1: 0x00010001,
      sCapHeight: Math.round((c.cap - c.baseline) * s),
      sxHeight: Math.round((c.cap - c.baseline) * s * 0.75)
    };

    let buffer = font.toArrayBuffer();

    // --- 7) OpenType Layout ---
    const layout = root.ThaiLayout.build(recs, kern);
    const W = root.OTLWriter;
    const add = {};
    if (options.layout !== false) {      // layout:false = ไม่ใส่ GDEF/GSUB/GPOS (ใช้วินิจฉัยเมื่อเบราว์เซอร์ไม่รับฟอนต์)
      add.GDEF = W.buildGDEF(layout.gdef);
      if (layout.gsub.lookups.length) add.GSUB = W.buildGSUB(layout.gsub);
      if (layout.gpos.lookups.length) add.GPOS = W.buildGPOS(layout.gpos);
    }
    buffer = W.repack(buffer, { add, remove: ['ltag'], hhea: { ascender: asc, descender: desc, lineGap: gap } });

    report.glyphCount = glyphs.length;
    report.features = { gsub: layout.gsub.features.map(f => f.tag), gpos: layout.gpos.features.map(f => f.tag) };
    report.fileName = (info.family || 'MyThaiFont').replace(/[\\/:*?"<>|]+/g, '').trim() + '-' + style.replace(/\s+/g, '') + '.otf';
    report.records = recs.map(r => ({ code: r.code, gid: r.gid, name: r.glyphName, advance: r.advance, anchors: r.anchors, mark: r.mark }));
    return { buffer, report };
  }

  const FontCompiler = { compile, getOpentype, weightOf };
  root.FontCompiler = FontCompiler;
  if (typeof module !== 'undefined' && module.exports) module.exports = FontCompiler;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'font-compiler': '2.0.0-cba108e5' });
