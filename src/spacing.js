/**
 * Spacing engine — คำนวณช่องไฟ (LSB / RSB) อัตโนมัติ + Auto-kern
 *
 * แนวคิด (อธิบายให้ผู้ใช้เข้าใจง่าย):
 *   ช่องไฟอัตโนมัติ = "ช่องไฟพื้นฐาน" × ความแน่น − (ความเว้าของขอบตัวอักษร × ค่าความโค้ง)
 *   ตัวที่ขอบตรง (เช่น น, H) ได้ช่องไฟเต็ม ตัวที่ขอบโค้ง/เว้า (เช่น อ, O, A) ได้ช่องไฟน้อยลง
 *   ผู้ใช้ปรับเพิ่ม/ลด (delta) ทับค่าอัตโนมัติได้ทีละตัว
 *
 * อ้างอิงแนวคิดการวัด 24 ชั้นจาก F0NT Autokern (ชุมชนออกแบบฟอนต์ไทย)
 * หน่วยทั้งหมดเป็น pt บน Canvas
 */
(function (root) {
  'use strict';
  const O = () => root.Outline;
  const S = () => root.ProjectSettings;

  const SLICES = 24;

  function zoneFor(bbox, canvas) {
    const H = canvas.cap - canvas.baseline;
    let y0 = canvas.baseline, y1 = canvas.cap;
    // ตัวเล็ก ๆ ที่อยู่นอกโซน (เช่น จุด, ขีดล่าง, เครื่องหมายคำพูด) ใช้ความสูงของตัวเอง
    const overlap = Math.min(y1, bbox.yMax) - Math.max(y0, bbox.yMin);
    if (overlap < H * 0.3) { y0 = bbox.yMin; y1 = bbox.yMax; }
    return { y0, y1, H: Math.max(1, y1 - y0) };
  }

  /**
   * วัดช่องไฟของ glyph ฐาน
   * def: glyph definition, contours: เส้นที่ normalize แล้ว (pt)
   * คืน { bbox, xMin, xMax, autoL, autoR, dl, dr, lsb, rsb, originX, advance, profile }
   */
  function measure(def, contours, settings) {
    const canvas = settings.canvas;
    const bbox = O().bbox(contours);
    if (!bbox) return null;
    let xMin = bbox.xMin, xMax = bbox.xMax;

    // หางที่ล้นใต้เส้นฐาน (ผู้ใช้ติ๊ก "ไม่นับหาง"): วัดช่องไฟจากหมึกเหนือเส้นฐานเท่านั้น หางจึงยื่นออกนอกกรอบได้
    const adj = S().adjustOf(settings, def && def.code);
    if (adj.tail) {
      const above = O().inkRangeX(contours, canvas.baseline, bbox.yMax + 1);
      if (above) { xMin = Math.max(xMin, above.xl); xMax = Math.min(xMax, above.xr); }
    }

    // สระหน้าสูง (โ ใ ไ): หางด้านบนยื่นทับพยัญชนะถัดไปได้ → วัดความกว้างจากลำตัวใต้เส้น Cap
    if (def && def.tallLeading) {
      const body = O().inkRangeX(contours, canvas.baseline - 20, canvas.cap + 10);
      if (body) xMax = Math.min(xMax, body.xr);
    }

    const z = zoneFor(bbox, canvas);
    const prof = O().profile(contours, z.y0, z.y1, SLICES);
    const maxDepth = z.H * 0.3;
    let sumL = 0, sumR = 0, n = 0;
    prof.forEach(s => {
      if (s.xl == null) return;
      sumL += Math.min(maxDepth, Math.max(0, s.xl - xMin));
      sumR += Math.min(maxDepth, Math.max(0, xMax - Math.min(xMax, s.xr)));
      n++;
    });
    const depthL = n ? sumL / n : 0;
    const depthR = n ? sumR / n : 0;

    const sp = settings.spacing;
    const base = sp.base * S().densityFactor(sp.density);
    const k = sp.roundness;
    let autoL = Math.max(base * 0.2, base - k * depthL);
    let autoR = Math.max(base * 0.2, base - k * depthR);
    if (def && def.leadingVowel) autoR = Math.max(base * 0.12, autoR * sp.leadingVowelRight);
    autoL = Math.round(autoL); autoR = Math.round(autoR);

    const ov = (settings.glyphSpacing && def && settings.glyphSpacing[def.code]) || {};
    const dl = Number(ov.l) || 0, dr = Number(ov.r) || 0;
    const lsb = autoL + dl, rsb = autoR + dr;
    const originX = xMin - lsb;
    const advance = Math.max(0, Math.round(xMax + rsb - originX));
    return { bbox, xMin, xMax, autoL, autoR, dl, dr, lsb, rsb, originX, advance, profile: prof, zone: z, depthL, depthR };
  }

  /** ค่า kerning อัตโนมัติระหว่างสองตัว (pt, ค่าลบ = ชิดเข้า) */
  function autoKern(L, R, settings) {
    if (!L || !R || !L.profile || !R.profile) return 0;
    const canvas = settings.canvas;
    // วัดใหม่ในโซนเดียวกันเพื่อเทียบชั้นต่อชั้น
    const gaps = [];
    const y0 = canvas.baseline, y1 = canvas.cap;
    const step = (y1 - y0) / SLICES;
    const sample = (m, y) => {
      if (m.zone.y0 !== y0 || m.zone.y1 !== y1) return null;
      const s = m.profile[Math.floor((y - y0) / step)];
      return s && s.xl != null ? s : null;
    };
    for (let i = 0; i < SLICES; i++) {
      const y = y0 + (i + 0.5) * step;
      const a = sample(L, y), b = sample(R, y);
      if (!a || !b) continue;
      const rightGap = (L.originX + L.advance) - a.xr;     // จากหมึกขวาของตัวซ้ายถึงขอบ advance
      const leftGap = b.xl - R.originX;                    // จากจุดเริ่มตัวขวาถึงหมึกซ้าย
      gaps.push(rightGap + leftGap);
    }
    if (gaps.length < 4) return 0;
    const min = Math.min.apply(null, gaps);
    const avg = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const sp = settings.spacing;
    const target = 2 * sp.base * S().densityFactor(sp.density);
    const effective = 0.7 * min + 0.3 * avg;
    if (effective < target * 1.15) return 0;
    let k = -(effective - target) * 0.6 * (settings.kerning.strength || 1);
    k = Math.max(k, -(min - target * 0.35));     // ไม่ให้ชนกัน
    k = Math.max(k, -canvas.em * 0.12);
    k = Math.round(Math.min(0, k));
    return Math.abs(k) < 3 ? 0 : k;
  }

  const Spacing = { measure, autoKern, SLICES };
  root.Spacing = Spacing;
  if (typeof module !== 'undefined' && module.exports) module.exports = Spacing;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'spacing': '2.0.0-cba108e5' });
