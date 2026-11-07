/**
 * Thai OpenType rules — สร้างโครงสร้าง GDEF / GSUB / GPOS สำหรับภาษาไทย
 *
 * GSUB  ccmp : ำ → ํ + า (แตกสระอำให้วรรณยุกต์ซ้อนได้)
 *              ญ ฐ + สระล่าง → ญ/ฐ ตัดเชิง
 * GPOS  kern : ระยะคู่ตัวอักษร (ข้ามสระ/วรรณยุกต์)
 *       mark : วางสระบน วรรณยุกต์ และสระล่างบนพยัญชนะตามจุดยึด
 *       mkmk : วรรณยุกต์ซ้อนเหนือสระบน (ปี่ กิ้ น้ำ)
 */
(function (root) {
  'use strict';

  const SCRIPTS = ['DFLT', 'latn', 'thai'];

  /**
   * records: [{ gid, code, kind, isCutVariant, baseCode, anchors:{top,bottom} (font units) , mark:{anchor, top2, side} }]
   * kernPairs: Map(firstGid -> [{second, value}])
   */
  function build(records, kernPairs) {
    const byCode = {};
    records.forEach(r => { if (r.code) byCode[r.code] = r; });

    // ---- GDEF ----
    const classes = {};
    records.forEach(r => { if (r.gid > 0) classes[r.gid] = r.mark ? 3 : 1; });

    // ---- GSUB ----
    const gsub = { scripts: SCRIPTS, features: [], lookups: [] };
    const ccmp = [];
    const am = byCode['U+0E33'], nik = byCode['U+0E4D'], aa = byCode['U+0E32'];
    if (am && nik && aa) {
      gsub.lookups.push({ type: 2, flag: 0, subtables: [{ kind: 'multiple', map: { [am.gid]: [nik.gid, aa.gid] } }] });
      ccmp.push(gsub.lookups.length - 1);
    }
    const lowerMarks = records.filter(r => r.mark && r.mark.side === 'bottom').map(r => r.gid);
    const cutMap = {};
    records.filter(r => r.isCutVariant && byCode[r.baseCode]).forEach(r => { cutMap[byCode[r.baseCode].gid] = r.gid; });
    if (Object.keys(cutMap).length && lowerMarks.length) {
      const chainIdx = gsub.lookups.length;
      const singleIdx = chainIdx + 1;
      gsub.lookups.push({
        type: 6, flag: 0, subtables: [{
          kind: 'chain3', backtrack: [], input: [Object.keys(cutMap).map(Number)], lookahead: [lowerMarks],
          records: [{ seq: 0, lookup: singleIdx }]
        }]
      });
      gsub.lookups.push({ type: 1, flag: 0, subtables: [{ kind: 'single', map: cutMap }] });
      ccmp.push(chainIdx);
    }
    if (ccmp.length) gsub.features.push({ tag: 'ccmp', lookups: ccmp });

    // รูปสลับ (calt): ตัวที่ตามหลังรูปจังหวะ k จะกลายเป็นรูปจังหวะ k+1 พอครบรอบก็กลับเป็นรูปปกติ
    // GSUB ทำจากซ้ายไปขวาและ backtrack เห็นรูปที่สลับแล้ว จึงหมุนเวียนได้ด้วยกฎเดียว · ต้องอยู่หลัง ccmp เพื่อให้ตัวตัดเชิงมีรูปสลับด้วย
    const cycling = records.filter(r => r.alts && r.alts.length);
    if (cycling.length) {
      const states = [cycling.map(r => r.gid)];
      cycling[0].alts.forEach((_, k) => states.push(cycling.map(r => r.alts[k].gid)));
      // นับข้ามสระหน้า/สระหลัง (สูงสุด 2 ตัว เช่น นาเน) ส่วนสระบน/ล่างและวรรณยุกต์ข้ามด้วย IgnoreMarks
      const vowels = records.filter(r => r.def && r.def.group === 'vowel' && !r.mark).map(r => r.gid);
      const depths = vowels.length ? [[], [vowels], [vowels, vowels]] : [[]];
      const chainIdx = gsub.lookups.length;
      const subtables = [];
      for (let k = 0; k + 1 < states.length; k++) {
        const map = {};
        states[0].forEach((gid, i) => { map[gid] = states[k + 1][i]; });
        const singleIdx = chainIdx + 1 + k;
        depths.forEach(skip => subtables.push({ kind: 'chain3', backtrack: skip.concat([states[k]]), input: [states[0]], lookahead: [], records: [{ seq: 0, lookup: singleIdx }] }));
        gsub.lookups[singleIdx] = { type: 1, flag: 0, subtables: [{ kind: 'single', map }] };
      }
      gsub.lookups[chainIdx] = { type: 6, flag: 0x0008, subtables };
      gsub.features.push({ tag: 'calt', lookups: [chainIdx] });
    }

    // ---- GPOS ----
    const gpos = { scripts: SCRIPTS, features: [], lookups: [] };
    if (kernPairs && kernPairs.size) {
      const chunks = root.OTLWriter.chunkPairs(kernPairs, 3000);
      gpos.lookups.push({ type: 2, flag: 0x0008, extension: true, subtables: chunks.map(p => ({ kind: 'pair', pairs: p })) });
      gpos.features.push({ tag: 'kern', lookups: [gpos.lookups.length - 1] });
    }
    const marks = records.filter(r => r.mark);
    const bases = records.filter(r => r.anchors && (r.anchors.top || r.anchors.bottom));
    if (marks.length && bases.length) {
      gpos.lookups.push({
        type: 4, flag: 0, subtables: [{
          kind: 'markBase', classCount: 3,
          // class 0 = สระบน/วรรณยุกต์ (หลบหางสูง), 1 = สระล่าง, 2 = เครื่องหมายที่ทะลุหางสูงได้ (เช่น ั)
          marks: marks.map(r => ({ gid: r.gid, cls: r.mark.side === 'bottom' ? 1 : r.mark.side === 'through' ? 2 : 0, x: r.mark.anchor.x, y: r.mark.anchor.y })),
          bases: bases.map(r => ({ gid: r.gid, anchors: [r.anchors.top || null, r.anchors.bottom || null, r.anchors.through || r.anchors.top || null] }))
        }]
      });
      gpos.features.push({ tag: 'mark', lookups: [gpos.lookups.length - 1] });
    }
    const tones = records.filter(r => r.mark && r.kind === 'mark-tone');
    const stackers = records.filter(r => r.mark && r.mark.top2);
    if (tones.length && stackers.length) {
      gpos.lookups.push({
        type: 6, flag: 0, subtables: [{
          kind: 'markMark', classCount: 1,
          marks: tones.map(r => ({ gid: r.gid, cls: 0, x: r.mark.anchor.x, y: r.mark.anchor.y })),
          bases: stackers.map(r => ({ gid: r.gid, anchors: [r.mark.top2] }))
        }]
      });
      const mkmkLookups = [gpos.lookups.length - 1];

      // วรรณยุกต์บนเครื่องหมายที่ทะลุหาง (ปั่ ฝั้): ตัวเครื่องหมายไม่หลบ แต่วรรณยุกต์ต้องหลบซ้ายตามหาง
      const throughMarks = records.filter(r => r.mark && r.mark.side === 'through' && r.mark.top2).map(r => r.gid);
      const tallBases = bases.filter(r => r.anchors.tall && r.anchors.through && r.anchors.through.x !== r.anchors.top.x);
      if (throughMarks.length && tallBases.length) {
        const singleIdx = {};
        const chainSubs = [];
        const chainIdx = gpos.lookups.length;
        gpos.lookups.push(null); // จองตำแหน่งให้ chain อยู่หลัง mkmk
        tallBases.forEach(b => {
          const dx = b.anchors.top.x - b.anchors.through.x;
          if (singleIdx[dx] == null) {
            singleIdx[dx] = gpos.lookups.length;
            gpos.lookups.push({ type: 1, flag: 0, subtables: [{ kind: 'single', glyphs: tones.map(t => t.gid), x: dx }] });
          }
          chainSubs.push({ kind: 'chain3', backtrack: [throughMarks, [b.gid]], input: [tones.map(t => t.gid)], lookahead: [], records: [{ seq: 0, lookup: singleIdx[dx] }] });
        });
        gpos.lookups[chainIdx] = { type: 8, flag: 0, subtables: chainSubs };
        mkmkLookups.push(chainIdx);
      }
      gpos.features.push({ tag: 'mkmk', lookups: mkmkLookups });
    }

    return { gdef: classes, gsub, gpos };
  }

  const ThaiLayout = { build, SCRIPTS };
  root.ThaiLayout = ThaiLayout;
  if (typeof module !== 'undefined' && module.exports) module.exports = ThaiLayout;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'thai-typography': '2.0.0-1b04fcfe' });
