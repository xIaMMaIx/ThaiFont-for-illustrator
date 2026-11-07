/**
 * OTL Writer — เขียนตาราง OpenType Layout (GDEF / GSUB / GPOS) เป็นไบนารี
 * และประกอบไฟล์ SFNT ใหม่ (แทนที่/เพิ่มตาราง + คำนวณ checksum ใหม่ทั้งหมด)
 *
 * opentype.js 2.0 ไม่รองรับการเขียน GPOS และ kern จึงต้องเขียนเองที่นี่
 * โครงสร้างข้อมูลที่รับเข้าเป็น "abstract layout" จาก thai-typography.js
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1) Binary node tree serializer
  //    node = { f: [[type, value], ...] }  type: u8 u16 i16 u32 tag off16 off32
  //    off16 children ถูกวางต่อท้าย parent (DFS) — off32 children ถูกเลื่อนไปท้ายสุด
  // ---------------------------------------------------------------------------
  function N(fields) { return { f: fields }; }

  function nodeSize(node) {
    let s = 0;
    for (const [t] of node.f) {
      if (t === 'u8') s += 1;
      else if (t === 'u16' || t === 'i16' || t === 'off16') s += 2;
      else if (t === 'u32' || t === 'tag' || t === 'off32') s += 4;
      else throw new Error('Unknown field type ' + t);
    }
    return s;
  }

  function serialize(rootNode) {
    const placed = [];            // {node, pos}
    const deferred = [];          // off32 targets
    let cursor = 0;
    const posOf = new Map();

    function emitTree(node) {
      if (posOf.has(node)) return;
      posOf.set(node, cursor);
      placed.push(node);
      cursor += nodeSize(node);
      for (const [t, v] of node.f) {
        if (t === 'off16' && v) emitTree(v);
        else if (t === 'off32' && v) deferred.push(v);
      }
    }
    emitTree(rootNode);
    while (deferred.length) emitTree(deferred.shift());

    const out = new Uint8Array(cursor);
    const dv = new DataView(out.buffer);
    for (const node of placed) {
      let p = posOf.get(node);
      const base = p;
      for (const [t, v] of node.f) {
        switch (t) {
          case 'u8': dv.setUint8(p, v); p += 1; break;
          case 'u16': dv.setUint16(p, v & 0xFFFF); p += 2; break;
          case 'i16': dv.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(v)))); p += 2; break;
          case 'u32': dv.setUint32(p, v >>> 0); p += 4; break;
          case 'tag':
            for (let i = 0; i < 4; i++) dv.setUint8(p + i, (v.charCodeAt(i) || 32) & 0xFF);
            p += 4; break;
          case 'off16': {
            const off = v ? posOf.get(v) - base : 0;
            if (off < 0 || off > 0xFFFF) throw new Error('Offset16 overflow (' + off + ')');
            dv.setUint16(p, off); p += 2; break;
          }
          case 'off32': {
            const off = v ? posOf.get(v) - base : 0;
            dv.setUint32(p, off >>> 0); p += 4; break;
          }
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 2) Common OpenType structures
  // ---------------------------------------------------------------------------
  function uniqSorted(arr) {
    return Array.from(new Set(arr)).sort((a, b) => a - b);
  }

  function coverage(glyphs) {
    const g = uniqSorted(glyphs);
    // format 2 (ranges) เมื่อประหยัดกว่า
    const ranges = [];
    for (let i = 0; i < g.length; i++) {
      const last = ranges[ranges.length - 1];
      if (last && last.end === g[i] - 1) last.end = g[i];
      else ranges.push({ start: g[i], end: g[i], idx: i });
    }
    if (ranges.length * 3 < g.length) {
      const f = [['u16', 2], ['u16', ranges.length]];
      ranges.forEach(r => { f.push(['u16', r.start], ['u16', r.end], ['u16', r.idx]); });
      return N(f);
    }
    const f = [['u16', 1], ['u16', g.length]];
    g.forEach(id => f.push(['u16', id]));
    return N(f);
  }

  function classDef(map) { // map: gid -> class (non-zero)
    const ids = Object.keys(map).map(Number).filter(id => map[id]).sort((a, b) => a - b);
    const ranges = [];
    ids.forEach(id => {
      const c = map[id];
      const last = ranges[ranges.length - 1];
      if (last && last.end === id - 1 && last.cls === c) last.end = id;
      else ranges.push({ start: id, end: id, cls: c });
    });
    const f = [['u16', 2], ['u16', ranges.length]];
    ranges.forEach(r => f.push(['u16', r.start], ['u16', r.end], ['u16', r.cls]));
    return N(f);
  }

  function anchor(a) {
    return N([['u16', 1], ['i16', a.x], ['i16', a.y]]);
  }

  function scriptList(scripts, featureCount) {
    const tags = scripts.slice().sort();
    const f = [['u16', tags.length]];
    tags.forEach(tag => {
      const langSys = N([['off16', null], ['u16', 0xFFFF], ['u16', featureCount]]
        .concat(Array.from({ length: featureCount }, (_, i) => ['u16', i])));
      const script = N([['off16', langSys], ['u16', 0]]);
      f.push(['tag', tag], ['off16', script]);
    });
    return N(f);
  }

  function featureList(features) {
    // features ต้องเรียงตาม tag แล้ว
    const f = [['u16', features.length]];
    features.forEach(ft => {
      const feat = N([['off16', null], ['u16', ft.lookups.length]].concat(ft.lookups.map(i => ['u16', i])));
      f.push(['tag', ft.tag], ['off16', feat]);
    });
    return N(f);
  }

  function lookupList(lookups, buildSubtable, extType) {
    const f = [['u16', lookups.length]];
    lookups.forEach(lk => {
      const subs = lk.subtables.map(st => buildSubtable(st, lk.type));
      let type = lk.type;
      let subNodes = subs;
      if (lk.extension) {
        subNodes = subs.map(s => N([['u16', 1], ['u16', lk.type], ['off32', s]]));
        type = extType;
      }
      const lf = [['u16', type], ['u16', lk.flag || 0], ['u16', subNodes.length]];
      subNodes.forEach(s => lf.push(['off16', s]));
      f.push(['off16', N(lf)]);
    });
    return N(f);
  }

  function layoutTable(layout, buildSubtable, extType) {
    const features = layout.features.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    // re-map lookups referenced by features (no change — indices stay)
    const root = N([
      ['u16', 1], ['u16', 0],
      ['off16', scriptList(layout.scripts, features.length)],
      ['off16', featureList(features)],
      ['off16', lookupList(layout.lookups, buildSubtable, extType)]
    ]);
    return serialize(root);
  }

  // ---------------------------------------------------------------------------
  // 3) GSUB subtables
  // ---------------------------------------------------------------------------
  function gsubSubtable(st) {
    if (st.kind === 'single') {
      const keys = uniqSorted(Object.keys(st.map).map(Number));
      const f = [['u16', 2], ['off16', coverage(keys)], ['u16', keys.length]];
      keys.forEach(k => f.push(['u16', st.map[k]]));
      return N(f);
    }
    if (st.kind === 'multiple') {
      const keys = uniqSorted(Object.keys(st.map).map(Number));
      const f = [['u16', 1], ['off16', coverage(keys)], ['u16', keys.length]];
      keys.forEach(k => {
        const seq = st.map[k];
        f.push(['off16', N([['u16', seq.length]].concat(seq.map(g => ['u16', g])))]);
      });
      return N(f);
    }
    if (st.kind === 'chain3') return chain3(st);
    throw new Error('Unsupported GSUB subtable ' + st.kind);
  }

  function chain3(st) {
    const f = [['u16', 3], ['u16', st.backtrack.length]];
    st.backtrack.forEach(c => f.push(['off16', coverage(c)]));
    f.push(['u16', st.input.length]);
    st.input.forEach(c => f.push(['off16', coverage(c)]));
    f.push(['u16', st.lookahead.length]);
    st.lookahead.forEach(c => f.push(['off16', coverage(c)]));
    f.push(['u16', st.records.length]);
    st.records.forEach(r => f.push(['u16', r.seq], ['u16', r.lookup]));
    return N(f);
  }

  // ---------------------------------------------------------------------------
  // 4) GPOS subtables
  // ---------------------------------------------------------------------------
  function gposSubtable(st) {
    if (st.kind === 'single') {   // SinglePos format 1: เลื่อน X เท่ากันทุกตัว
      return N([['u16', 1], ['off16', coverage(st.glyphs)], ['u16', 0x0001], ['i16', st.x]]);
    }
    if (st.kind === 'chain3') return chain3(st);
    if (st.kind === 'pair') {
      // st.pairs: Map(first -> [{second, value}])  value = XAdvance
      const firsts = uniqSorted(Array.from(st.pairs.keys()));
      const f = [['u16', 1], ['off16', coverage(firsts)], ['u16', 0x0004], ['u16', 0], ['u16', firsts.length]];
      firsts.forEach(first => {
        const recs = st.pairs.get(first).slice().sort((a, b) => a.second - b.second);
        const pf = [['u16', recs.length]];
        recs.forEach(r => pf.push(['u16', r.second], ['i16', r.value]));
        f.push(['off16', N(pf)]);
      });
      return N(f);
    }
    if (st.kind === 'markBase' || st.kind === 'markMark') {
      const marks = st.marks.slice().sort((a, b) => a.gid - b.gid);
      const bases = st.bases.slice().sort((a, b) => a.gid - b.gid);
      const markArr = [['u16', marks.length]];
      marks.forEach(m => markArr.push(['u16', m.cls], ['off16', anchor(m)]));
      const baseArr = [['u16', bases.length]];
      bases.forEach(b => {
        for (let c = 0; c < st.classCount; c++) {
          const a = b.anchors[c];
          baseArr.push(['off16', a ? anchor(a) : null]);
        }
      });
      return N([
        ['u16', 1],
        ['off16', coverage(marks.map(m => m.gid))],
        ['off16', coverage(bases.map(b => b.gid))],
        ['u16', st.classCount],
        ['off16', N(markArr)],
        ['off16', N(baseArr)]
      ]);
    }
    throw new Error('Unsupported GPOS subtable ' + st.kind);
  }

  // ---------------------------------------------------------------------------
  // 5) Public builders
  // ---------------------------------------------------------------------------
  function buildGDEF(glyphClasses) {
    const root = N([['u16', 1], ['u16', 0], ['off16', classDef(glyphClasses)], ['off16', null], ['off16', null], ['off16', null]]);
    return serialize(root);
  }
  function buildGSUB(layout) { return layoutTable(layout, gsubSubtable, 7); }
  function buildGPOS(layout) { return layoutTable(layout, gposSubtable, 9); }

  /** แยก pairs ใหญ่ ๆ เป็นหลาย subtable ป้องกัน Offset16 overflow */
  function chunkPairs(pairMap, maxRecords) {
    maxRecords = maxRecords || 3000;
    const chunks = [];
    let cur = new Map(); let count = 0;
    uniqSorted(Array.from(pairMap.keys())).forEach(first => {
      const recs = pairMap.get(first);
      if (count + recs.length > maxRecords && cur.size) { chunks.push(cur); cur = new Map(); count = 0; }
      cur.set(first, recs); count += recs.length;
    });
    if (cur.size) chunks.push(cur);
    return chunks;
  }

  // ---------------------------------------------------------------------------
  // 6) SFNT repack
  // ---------------------------------------------------------------------------
  function readTables(buffer) {
    const dv = new DataView(buffer);
    const sfntVersion = dv.getUint32(0);
    const num = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < num; i++) {
      const r = 12 + i * 16;
      const tag = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
      const off = dv.getUint32(r + 8); const len = dv.getUint32(r + 12);
      tables[tag] = new Uint8Array(buffer.slice(off, off + len));
    }
    return { sfntVersion, tables };
  }

  function checksum(bytes) {
    let sum = 0;
    const n = bytes.length;
    for (let i = 0; i < n; i += 4) {
      const w = ((bytes[i] << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0)) >>> 0;
      sum = (sum + w) >>> 0;
    }
    return sum;
  }

  function writeTables(sfntVersion, tables) {
    const tags = Object.keys(tables).sort();
    const num = tags.length;
    let entrySelector = 0; while ((1 << (entrySelector + 1)) <= num) entrySelector++;
    const searchRange = (1 << entrySelector) * 16;
    const rangeShift = num * 16 - searchRange;
    let offset = 12 + num * 16;
    const layout = tags.map(tag => {
      const data = tables[tag];
      const rec = { tag, data, offset, length: data.length };
      offset += (data.length + 3) & ~3;
      return rec;
    });
    const out = new Uint8Array(offset);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, sfntVersion); dv.setUint16(4, num); dv.setUint16(6, searchRange);
    dv.setUint16(8, entrySelector); dv.setUint16(10, rangeShift);
    let headOffset = -1;
    layout.forEach((rec, i) => {
      if (rec.tag === 'head') {
        // checkSumAdjustment = 0 ก่อนคำนวณ
        rec.data = rec.data.slice(); new DataView(rec.data.buffer).setUint32(8, 0);
        headOffset = rec.offset;
      }
      out.set(rec.data, rec.offset);
      const r = 12 + i * 16;
      for (let k = 0; k < 4; k++) dv.setUint8(r + k, rec.tag.charCodeAt(k));
      dv.setUint32(r + 4, checksum(rec.data));
      dv.setUint32(r + 8, rec.offset);
      dv.setUint32(r + 12, rec.length);
    });
    if (headOffset >= 0) {
      const adj = (0xB1B0AFBA - checksum(out)) >>> 0;
      dv.setUint32(headOffset + 8, adj);
    }
    return out.buffer;
  }

  /**
   * แก้ไขไฟล์ฟอนต์: เพิ่ม/แทนตาราง, ลบตาราง, patch ค่า hhea
   * opts: { add: {GSUB: Uint8Array,...}, remove: ['ltag'], hhea: {ascender, descender, lineGap} }
   */
  function repack(buffer, opts) {
    const { sfntVersion, tables } = readTables(buffer);
    (opts.remove || []).forEach(t => { delete tables[t]; });
    Object.keys(opts.add || {}).forEach(t => { if (opts.add[t]) tables[t] = opts.add[t]; });
    if (opts.hhea && tables.hhea) {
      const h = tables.hhea.slice(); const dv = new DataView(h.buffer);
      if (opts.hhea.ascender != null) dv.setInt16(4, opts.hhea.ascender);
      if (opts.hhea.descender != null) dv.setInt16(6, opts.hhea.descender);
      if (opts.hhea.lineGap != null) dv.setInt16(8, opts.hhea.lineGap);
      tables.hhea = h;
    }
    return writeTables(sfntVersion, tables);
  }

  const OTLWriter = { buildGDEF, buildGSUB, buildGPOS, chunkPairs, repack, readTables, _serialize: serialize, _N: N };
  root.OTLWriter = OTLWriter;
  if (typeof module !== 'undefined' && module.exports) module.exports = OTLWriter;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'otl-writer': '2.0.0-2e84cd1e' });
