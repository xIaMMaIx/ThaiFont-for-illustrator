/**
 * Project settings — ค่าตั้งค่าทั้งหมดของโปรเจกต์ฟอนต์ (บันทึกลงไฟล์ .ai)
 * หน่วยระยะทั้งหมดเป็น pt บน Canvas (1 em = canvas.em pt)
 */
(function (root) {
  'use strict';

  const TONE_CODES = ['U+0E48', 'U+0E49', 'U+0E4A', 'U+0E4B', 'U+0E4C', 'U+0E4E'];

  function defaults() {
    return {
      version: 2,
      canvas: { em: 800, baseline: 200, cap: 560, ascender: 650, descender: 100, lsbGuide: 120, rsbGuide: 680 },
      info: { family: 'MyThaiFont', style: 'Regular', version: '1.000', designer: '', copyright: '', upm: 1000 },
      spacing: { density: 3, base: 40, leadingVowelRight: 0.4, roundness: 0.35 },
      glyphSpacing: {},               // { code: { l: delta, r: delta } }
      glyphAdjust: {},                // { code: { dy: เลื่อนแนวตั้ง (pt, + = ขึ้น), tail: true/false = ทับค่าเริ่มต้น (ฎ ฏ ฤ ฦ ญ ฐ ไม่นับหางเป็นค่าเริ่มต้น); เก็บเฉพาะที่ต่างจากค่าเริ่มต้น } }
      glyphBaseline: {},              // { code: ยกเส้นฐานตอนคอมไพล์ (pt, + = ขึ้น) } — ไม่กระทบช่องไฟ/จุดยึด สระย้ายตามตัวฐาน
      baselineFx: { scope: 'thai', style: 'two', amount: 30, seed: 1 },   // ตัวเลือกของ "ลูกเล่นเส้นฐาน" ในแท็บ ช่องไฟ
      baselineAlt: { on: false, scope: 'thai', steps: 2, amount: 30 },    // รูปสลับ: สร้าง glyph ที่ยกเส้นฐานต่างกัน แล้วให้ calt หมุนเวียนตามลำดับที่พิมพ์
      kerning: { auto: false, strength: 1, scope: 'latin', pairs: {}, depth: 1, clear: 0.35, tuck: 0.65, flat: 0.6, smooth: true },  // scope: 'latin' | 'all'  // pairs: { "U+0041|U+0056": -40 }
      marks: {
        upperGap: 22, lowerGap: 20, level2Gap: 16, tallGap: 14, upperX: 0, lowerX: 0,
        stackX: 0,                         // เลื่อนวรรณยุกต์ที่ซ้อนบนสระบนทุกตัว (+ = ขวา) — บวกเพิ่มจากตำแหน่งปกติ
        passThrough: { 'U+0E31': true },   // เครื่องหมายบนที่ทะลุหางสูงได้ (ไม่หลบซ้าย)
        tones: { 'U+0E48': 0, 'U+0E49': 0, 'U+0E4A': 0, 'U+0E4B': 0, 'U+0E4C': 0, 'U+0E4E': 0 },
        tonesStack: { 'U+0E48': 0, 'U+0E49': 0, 'U+0E4A': 0, 'U+0E4B': 0, 'U+0E4C': 0, 'U+0E4E': 0 }   // เลื่อนเพิ่มเฉพาะตอนซ้อนบนสระบน (+ = ขวา)
      },
      anchors: {},                    // base: {tx,ty,bx,by}  mark: {x,y}
      autoTune: {                     // แท็บ จูนอัตโนมัติ
        spacing: true, marks: true, globals: true, overwriteManual: false, scope: 'thai',
        depthCap: 0.2, curve: 0.6, follow: 0.5, minClear: 8,
        shapeAdjust: { flat: 0, soft: 0, deep: 0 },
        applied: { spacing: {}, anchors: {}, globals: {} }   // ค่าที่ระบบใส่ไว้ — ใช้แยกจากค่าที่ผู้ใช้ปรับเอง
      },
      metrics: { mode: 'auto', ascender: 900, descender: -300, lineGap: 0, spaceWidth: 220 },
      export: { thai: true, latin: true, symbols: true, onlyDrawn: true, fallback: false, path: '' },
      place: { scale: 0, from: '', keepSize: false },   // ใส่จากที่เลือก: อัตราย่อขยายร่วมทุกตัว (0 = ยังไม่ตั้ง) และตัวที่ใช้ตั้ง
      ui: { previewText: 'ที่นี่ปู่ผู้ใหญ่ ก่อสร้าง ปิ่นโต ฝ้าย ฟ้อนรำ น้ำ ญุ ฐู Hamburgefonstiv 123', previewSize: 36, glyphSet: 'thai', presetCat: 'stack' }
    };
  }

  const DENSITY = [
    { v: 1, factor: 0.75, label: 'ชิดมาก' },
    { v: 2, factor: 0.88, label: 'ชิด' },
    { v: 3, factor: 1.0, label: 'ปกติ' },
    { v: 4, factor: 1.15, label: 'โปร่ง' },
    { v: 5, factor: 1.3, label: 'โปร่งมาก' }
  ];

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(base, over) {
    if (!isObj(over)) return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(k => {
      out[k] = (isObj(base[k]) && isObj(over[k])) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }

  /** รวมค่าที่บันทึกไว้เข้ากับค่าเริ่มต้น (รองรับรูปแบบเก่าของปลั๊กอินเวอร์ชันแรก) */
  function hydrate(saved) {
    let s = defaults();
    if (!saved || typeof saved !== 'object') return s;
    if (saved.version === 2) return deepMerge(s, saved);

    // --- migrate v1 (offsets / glyphOverrides / metadata) ---
    const o = saved.offsets || {};
    s.marks.upperGap += (o.upperY || 0);
    s.marks.lowerGap -= (o.lowerY || 0);
    s.marks.level2Gap += (o.level2Y || 0);
    s.marks.upperX = o.upperX || 0;
    s.marks.lowerX = o.lowerX || 0;
    const legacyTone = { 'U+0E48': 'maiEk', 'U+0E49': 'maiTho', 'U+0E4A': 'maiTri', 'U+0E4B': 'maiChattawa', 'U+0E4C': 'thanthakhat' };
    Object.keys(legacyTone).forEach(code => { if (o[legacyTone[code]]) s.marks.tones[code] = o[legacyTone[code]]; });
    const go = saved.glyphOverrides || {};
    Object.keys(go).forEach(code => {
      const v = go[code] || {};
      if (v.lsb || v.rsb) s.glyphSpacing[code] = { l: v.lsb || 0, r: v.rsb || 0 };
      if (v.x || v.y) s.anchors[code] = { x: v.x || 0, y: v.y || 0, tx: v.x || 0, ty: v.y || 0 };
    });
    const m = saved.metadata || {};
    if (m.fontFamily) s.info.family = m.fontFamily;
    if (m.fontStyle) s.info.style = m.fontStyle;
    if (m.designer) s.info.designer = m.designer;
    if (m.copyright) s.info.copyright = m.copyright;
    if (m.version) s.info.version = m.version;
    if (saved.testText) s.ui.previewText = saved.testText;
    return s;
  }

  function densityFactor(level) {
    const d = DENSITY.find(x => x.v === Number(level));
    return d ? d.factor : 1;
  }

  /** ค่าเริ่มต้นของ "ไม่นับหาง": อักษรหางยาว (ฎ ฏ ฤ ฦ) และตัวเชิง (ญ ฐ และตัวตัดเชิง) */
  function defaultTail(code) {
    const d = root.GlyphData && root.GlyphData.BY_CODE && root.GlyphData.BY_CODE[code];
    return !!(d && (d.longDescender || d.cutTail || d.isCutVariant));
  }
  /** ค่าปรับเฉพาะตัว (แนวตั้ง / หาง) — คืน { dy, tail } เสมอ
   *  glyphAdjust เก็บเฉพาะค่าที่ต่างจากค่าเริ่มต้น: tail ที่ไม่ได้ระบุ = ค่าเริ่มต้นของตัวนั้น */
  function adjustOf(settings, code) {
    const a = (settings && settings.glyphAdjust && settings.glyphAdjust[code]) || null;
    return { dy: a && Number(a.dy) ? Number(a.dy) : 0, tail: a && typeof a.tail === 'boolean' ? a.tail : defaultTail(code) };
  }
  /** เลื่อนเส้น (รูปแบบ path จาก Illustrator: จุด [x,y,inx,iny,outx,outy]) ขึ้น dy */
  function shiftPaths(paths, dy) {
    if (!dy || !paths) return paths;
    return paths.map(pp => {
      const q = Object.assign({}, pp);
      q.p = (pp.p || []).map(pt => { const r = pt.slice(); [1, 3, 5].forEach(i => { if (r[i] != null) r[i] += dy; }); return r; });
      return q;
    });
  }
  /** ใช้ค่า dy ของทุกตัวกับ outlines { code: [path] } (ไม่แก้ต้นฉบับ) */
  function applyAdjust(outlines, settings) {
    const ga = settings && settings.glyphAdjust; if (!ga) return outlines;
    let out = null;
    Object.keys(ga).forEach(code => {
      const dy = Number(ga[code] && ga[code].dy) || 0;
      if (!dy || !outlines[code] || !outlines[code].length) return;
      if (!out) out = Object.assign({}, outlines);
      out[code] = shiftPaths(outlines[code], dy);
    });
    return out || outlines;
  }

  /** ตัวตัดเชิงใช้เส้นฐานร่วมกับตัวเต็ม (GSUB สลับรูปตอนมีสระล่าง ความสูงต้องไม่กระโดด) */
  function baselineCode(code) {
    const d = root.GlyphData && root.GlyphData.BY_CODE && root.GlyphData.BY_CODE[code];
    return d && d.isCutVariant ? d.baseCode : code;
  }
  function baselineOf(settings, code) {
    const gb = settings && settings.glyphBaseline;
    return (gb && Number(gb[baselineCode(code)])) || 0;
  }
  function setBaseline(settings, code, v) {
    if (!settings.glyphBaseline) settings.glyphBaseline = {};
    const k = baselineCode(code), n = Math.round(Number(v) || 0);
    if (n) settings.glyphBaseline[k] = n; else delete settings.glyphBaseline[k];
  }
  /** รหัสตัวอักษรที่ "ลูกเล่นเส้นฐาน" ใช้ได้ — scope: 'thai' | 'latin' | 'all' */
  function baselineTargets(scope) {
    const all = (root.GlyphData && root.GlyphData.ALL_GLYPHS) || [];
    return all.filter(d => {
      if (d.isCutVariant) return false;
      const thai = !!d.thaiConsonant, latin = /^latin-(upper|lower)$/.test(d.group || '');
      return scope === 'thai' ? thai : scope === 'latin' ? latin : thai || latin;
    }).map(d => d.code);
  }
  /** แจกความสูงให้แต่ละตัวแบบกำหนดซ้ำได้จาก seed — style: 'two' สูง/ต่ำ | 'three' สูง/กลาง/ต่ำ | 'free' อิสระ
   *  คืน { code: pt } เฉพาะตัวที่ไม่เป็น 0 */
  function baselineBounce(codes, opts) {
    const a = Math.abs(Math.round(Number(opts.amount) || 0));
    let t = (Number(opts.seed) || 0) >>> 0;
    const rnd = () => { // mulberry32
      t = (t + 0x6D2B79F5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    const levels = opts.style === 'three' ? [a, 0, -a] : [a, -a];
    // สับลำดับแล้วแจกวนตามระดับ: แต่ละระดับได้จำนวนตัวเท่ากัน
    const order = codes.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = order[i]; order[i] = order[j]; order[j] = x; }
    const out = {};
    order.forEach((code, i) => {
      const v = opts.style === 'free' ? Math.round((rnd() * 2 - 1) * a) : levels[i % levels.length];
      if (v) out[code] = v;
    });
    return out;
  }

  /** ค่ายกของรูปสลับแต่ละรูป (บวกเพิ่มจากเส้นฐานของตัวนั้น) — [] = ไม่สร้างรูปสลับ
   *  2 จังหวะ: ปกติ → ขึ้น · 3 จังหวะ: ปกติ → ขึ้น → ลง */
  function altLifts(settings) {
    const alt = settings && settings.baselineAlt;
    const a = alt && alt.on ? Math.abs(Math.round(Number(alt.amount) || 0)) : 0;
    if (!a) return [];
    return Number(alt.steps) === 3 ? [a, -a] : [a];
  }

  const Settings = { defaults, hydrate, deepMerge, DENSITY, densityFactor, TONE_CODES, adjustOf, defaultTail, shiftPaths, applyAdjust, baselineOf, setBaseline, baselineTargets, baselineBounce, altLifts };
  root.ProjectSettings = Settings;
  if (typeof module !== 'undefined' && module.exports) module.exports = Settings;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'settings': '2.0.0-cba108e5' });
