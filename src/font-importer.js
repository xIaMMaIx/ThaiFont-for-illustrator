/**
 * Font Importer — อ่านไฟล์ฟอนต์เดิม (.otf / .ttf / .woff) แล้วแปลงเป็นเส้นบน Canvas
 * พร้อมดึงช่องไฟเดิมและ kerning มาเป็นค่าปรับ (เพื่อให้ export ออกมาเหมือนต้นฉบับมากที่สุด)
 */
(function (root) {
  'use strict';
  const G = () => root.GlyphData;

  const FEATURE_NAMES = {
    kern: 'Kerning', mark: 'Mark positioning', mkmk: 'Mark-to-mark', ccmp: 'Glyph composition',
    liga: 'Ligatures', locl: 'Localized forms', calt: 'Contextual alternates', salt: 'Stylistic alternates',
    case: 'Case-sensitive forms', frac: 'Fractions', sups: 'Superscript', subs: 'Subscript', ss01: 'Stylistic set 1'
  };

  function parse(arrayBuffer, fileName) {
    const ot = root.FontCompiler.getOpentype();
    const sig = new Uint8Array(arrayBuffer.slice(0, 4));
    const tag = String.fromCharCode.apply(null, sig);
    if (tag === 'wOF2') throw new Error('ยังไม่รองรับไฟล์ WOFF2 — กรุณาใช้ .otf, .ttf หรือ .woff');
    const font = ot.parse(arrayBuffer);
    const name = key => { try { return font.getEnglishName(key) || ''; } catch (e) { return ''; } };

    const scripts = new Set(); const features = new Set();
    ['gsub', 'gpos'].forEach(t => {
      const tb = font.tables[t];
      if (!tb) return;
      (tb.scripts || []).forEach(sr => scripts.add(sr.tag));
      (tb.features || []).forEach(fr => features.add(fr.tag));
    });
    const os2 = font.tables.os2 || {}; const hhea = font.tables.hhea || {};
    return {
      font, fileName,
      info: {
        family: name('fontFamily') || name('preferredFamily') || fileName,
        style: name('fontSubfamily') || 'Regular',
        designer: name('designer'), version: name('version'), copyright: name('copyright'),
        upm: font.unitsPerEm,
        ascender: os2.sTypoAscender != null ? os2.sTypoAscender : hhea.ascender,
        descender: os2.sTypoDescender != null ? os2.sTypoDescender : hhea.descender,
        lineGap: os2.sTypoLineGap != null ? os2.sTypoLineGap : (hhea.lineGap || 0),
        glyphCount: font.numGlyphs
      },
      scripts: Array.from(scripts),
      features: Array.from(features).map(t => ({ tag: t, description: FEATURE_NAMES[t] || t }))
    };
  }

  function findGlyph(font, def) {
    if (def.isCutVariant) {
      const names = [def.glyphName, def.glyphName.replace('.short', '.cut'), def.glyphName.replace('.short', '.descless')];
      for (let i = 0; i < font.glyphs.length; i++) {
        const g = font.glyphs.get(i);
        if (g && names.indexOf(g.name) >= 0) return g;
      }
    }
    const u = G().codeToInt(def.code);
    const idx = font.encoding.charToGlyphIndex(String.fromCodePoint(u));
    if (!idx) return null;
    return font.glyphs.get(idx);
  }

  /**
   * เตรียมเส้นสำหรับนำเข้า
   * คืน [{ code, name, paths, fontLsb, fontRsb, glyphIndex }]
   */
  /** สเกลจากหน่วยฟอนต์ → pt: 'cap' = ให้ความสูงพยัญชนะไทย (หรือ H) พอดีเส้น Cap, 'em' = 1 em = Canvas */
  function scaleFor(parsed, settings, fit) {
    const font = parsed.font; const c = settings.canvas;
    const em = c.em / font.unitsPerEm;
    if (fit !== 'cap') return em;
    const refs = ['น', 'ก', 'H'];
    for (let i = 0; i < refs.length; i++) {
      const g = font.charToGlyph(refs[i]);
      if (g && g.index && g.path && g.path.commands.length) {
        const h = g.getBoundingBox().y2;
        if (h > 0) return (c.cap - c.baseline) / h;
      }
    }
    return em;
  }

  function prepare(parsed, defs, settings, fit) {
    const font = parsed.font; const c = settings.canvas;
    const k = scaleFor(parsed, settings, fit || 'cap');
    const out = [];
    defs.forEach(def => {
      if (def.kind === 'auto') return;
      const g = findGlyph(font, def);
      if (!g || !g.path || !g.path.commands || !g.path.commands.length) return;
      const bb = g.getBoundingBox();
      let shiftX;
      if (G().isMark(def)) shiftX = c.em / 2 - (bb.x1 + bb.x2) / 2 * k;
      else shiftX = c.lsbGuide - bb.x1 * k;
      const map = (x, y) => [x * k + shiftX, c.baseline + y * k];
      const contours = root.Outline.fromOtCommands(g.path.commands, map);
      if (!contours.length) return;
      out.push({
        code: def.code, name: def.name, glyphIndex: g.index,
        paths: contours.map(pts => ({ p: pts, c: true, f: true, s: false, sw: 0, g: 0, eo: false })),
        fontLsb: bb.x1 * k, fontRsb: ((g.advanceWidth || 0) - bb.x2) * k, mark: G().isMark(def), scale: k
      });
    });
    return out;
  }

  /** ช่องไฟเดิมของฟอนต์ → ค่าปรับ (delta) เทียบกับช่องไฟอัตโนมัติ */
  function spacingOverrides(prepared, settings) {
    const res = {};
    prepared.forEach(p => {
      if (p.mark) return;
      const def = G().BY_CODE[p.code];
      const norm = root.Outline.normalize(p.paths);
      const tmp = Object.assign({}, settings, { glyphSpacing: {}, glyphAdjust: {} });
      const m = root.Spacing.measure(def, norm.contours, tmp);
      if (!m) return;
      // ระยะขวาเทียบจากขอบที่ใช้วัดช่องไฟ (สระหน้าสูงใช้ลำตัว)
      const rsbFont = p.fontRsb + (m.bbox.xMax - m.xMax);
      const l = Math.round(p.fontLsb - m.autoL), r = Math.round(rsbFont - m.autoR);
      if (l || r) res[p.code] = { l, r };
    });
    return res;
  }

  /** kerning เดิมของฟอนต์ (pt) */
  function kerningPairs(parsed, prepared, settings) {
    const font = parsed.font; const k = prepared.length ? prepared[0].scale : settings.canvas.em / font.unitsPerEm;
    const bases = prepared.filter(p => !p.mark && !G().BY_CODE[p.code].isCutVariant);
    const pairs = {};
    if (bases.length > 400) return pairs;
    bases.forEach(a => bases.forEach(b => {
      let v = 0;
      try { v = font.getKerningValue(font.glyphs.get(a.glyphIndex), font.glyphs.get(b.glyphIndex)); } catch (e) { v = 0; }
      if (v) pairs[a.code + '|' + b.code] = Math.round(v * k);
    }));
    return pairs;
  }

  const FontImporter = { parse, prepare, scaleFor, spacingOverrides, kerningPairs };
  root.FontImporter = FontImporter;
  if (typeof module !== 'undefined' && module.exports) module.exports = FontImporter;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'font-importer': '2.0.0-2e84cd1e' });
