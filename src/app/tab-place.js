/**
 * แท็บ ใส่เส้น — เลือกเส้นบน Canvas (เช่น ลายมือที่ trace มา วางไว้นอก Artboard ใน Layer Reference)
 * แล้วคลิกช่องตัวอักษร → คัดลอกไป Layer ของตัวนั้น ย่อขยาย/จัดตำแหน่งให้ แล้วไปตัวถัดไปที่ยังไม่วาด
 * ปุ่ม × บนช่อง = ลบเส้นของตัวนั้น · "เลือกลบหลายตัว" = เลือกหลายช่องแล้วลบทีเดียว (ถามยืนยันก่อนเสมอ)
 */
(function () {
  'use strict';
  const { $, el, toast, bindSeg, confirmDialog } = window.UI;
  const GD = window.GlyphData;
  const A = window.TFSApp;
  const { state, S, statusOf, displayChar, setGlyphs, isDrawn } = A;

  const LATIN_XH = 'acemnorsuvwxz', LATIN_DESC = 'gjpqy';

  /** ความสูงที่ตัวนี้ควรเป็นบน Canvas — ใช้ตั้งอัตราย่อขยายร่วม (0 = ตัวนี้ใช้ตั้งไม่ได้ เช่น มีหาง/สระ/เครื่องหมาย) */
  function refHeight(def, c) {
    const H = c.cap - c.baseline;
    if (def.thaiConsonant) return (def.tallStem || def.longDescender || def.cutTail || def.isCutVariant) ? 0 : H;
    if (def.group === 'latin-upper') return 'JQ'.indexOf(def.char) >= 0 ? 0 : H;
    if (def.group === 'latin-lower') return LATIN_XH.indexOf(def.char) >= 0 ? Math.round(H * 0.75) : 0;
    if (def.group === 'digit') return H;
    return 0;
  }

  /** จุดยึดแนวตั้ง: ตัวทั่วไปตั้งบนเส้นฐาน · ตัวที่มีหางล่างชิดบนกับหัวตัว/x-height · สระ/วรรณยุกต์วางเหนือ/ใต้ไว้ให้เห็น (ระบบจัดตำแหน่งจริงให้เอง) */
  function placeAnchor(def, c) {
    const H = c.cap - c.baseline;
    if (def.kind === 'mark-bottom') return { anchor: 'top', y: c.baseline - Math.round(H * 0.08) };
    if (GD.isMark(def)) return { anchor: 'bottom', y: c.cap + Math.round(H * 0.08) };
    if (def.longDescender || def.cutTail && !def.isCutVariant) return { anchor: 'top', y: c.cap };
    if (def.group === 'latin-lower' && LATIN_DESC.indexOf(def.char) >= 0) return { anchor: 'top', y: c.baseline + Math.round(H * 0.75) };
    if (def.char === 'Q' || def.char === 'J') return { anchor: 'top', y: c.cap };
    return { anchor: 'bottom', y: c.baseline };
  }

  /** ตัวถัดไปที่ยังไม่วาด ตามลำดับในตาราง */
  function nextMissing(def) {
    const list = setGlyphs();
    const i = list.indexOf(def);
    for (let k = 1; k <= list.length; k++) {
      const d = list[(i + k) % list.length];
      if (d !== def && statusOf(d) === 'missing' && d.kind !== 'auto') return d;
    }
    return null;
  }

  const PLACE_ERR = {
    NO_SELECTION: 'ยังไม่ได้เลือกเส้นบน Canvas',
    ONLY_IMAGES: 'ที่เลือกเป็นภาพ ไม่ใช่เส้น — Image Trace แล้วกด Expand ก่อน',
    TEXT_EDITING: 'กำลังพิมพ์ข้อความอยู่ — กด Esc ใน Illustrator ก่อน',
    SELECTION_IN_TARGET: 'เส้นที่เลือกอยู่ใน Layer ของตัวนี้อยู่แล้ว',
    EMPTY: 'เส้นที่เลือกไม่มีขนาด'
  };

  async function placeInto(def, replace) {
    if (def.kind === 'auto') { toast(def.char + ' สร้างอัตโนมัติ ไม่ต้องใส่'); return; }
    const c = S().canvas, p = S().place;
    const opts = Object.assign({
      scale: p.keepSize ? 1 : (p.scale || 0), refH: refHeight(def, c), keepSize: !!p.keepSize,
      cx: (c.lsbGuide + c.rsbGuide) / 2, replace: !!replace, dim: true
    }, placeAnchor(def, c));
    let r;
    try { r = await window.Host.call('placeSelection', def.code, opts); }
    catch (e) {
      if (e.message === 'HAS_ART') {
        toast(def.char + ' วาดไว้แล้ว — แทนที่ด้วยเส้นที่เลือก?', { action: { label: 'แทนที่', fn: () => placeInto(def, true) }, ms: 6000 });
        return;
      }
      toast((e.message === 'NO_SELECTION' ? '' : 'ใส่ไม่สำเร็จ: ') + (PLACE_ERR[e.message] || e.message), { error: e.message !== 'NO_SELECTION' });
      return;
    }
    let note = '';
    if (r.newScale) { p.scale = r.scale; p.from = def.code; A.saveSettings(); note = ' · ตั้งขนาด ' + Math.round(r.scale * 100) + '% จาก ' + def.char; }
    else if (!p.keepSize && !p.scale) note = ' · ใส่ขนาดเดิม (ใส่ ก น หรือ H ก่อน เพื่อตั้งขนาดให้ทุกตัว)';
    if (r.skipped) note += ' · ข้ามภาพ ' + r.skipped + ' ชิ้น';
    await A.fetchOutlines([def.code]);
    const next = nextMissing(def);
    await A.selectGlyph(next || def);   // สลับ Layer ใน Illustrator ไปตัวถัดไป (และวาดแท็บนี้ใหม่)
    A.updateCounts(); A.schedulePreview();
    toast('ใส่ ' + def.char + ' แล้ว' + (next ? ' → ต่อไป ' + displayChar(next) : '') + note + ' (Ctrl+Z ใน Illustrator เพื่อย้อนกลับ)');
  }

  // ------------------------------------------------------ ลบเส้น
  // ลบตัวเดียว: ปุ่ม × บนช่อง · ลบหลายตัว: กด "เลือกลบหลายตัว" แล้วคลิกช่องที่จะลบ → "ลบที่เลือก"
  let pickMode = false;
  const picked = new Set();

  /** ลบเส้นของหลายตัวในครั้งเดียว — ถามยืนยันก่อน แล้วคืนความเข้มให้ต้นฉบับบน Canvas */
  async function clearGlyphs(defs) {
    defs = defs.filter(d => isDrawn(d.code));
    if (!defs.length) return false;
    const chars = defs.map(d => displayChar(d));
    const list = chars.length > 40 ? chars.slice(0, 40).join(' ') + ' … (+' + (chars.length - 40) + ')' : chars.join(' ');
    const yes = await confirmDialog({
      title: defs.length === 1 ? 'ลบเส้นของ ' + chars[0] + ' ?' : 'ลบเส้น ' + defs.length + ' ตัว ?',
      text: (defs.length === 1 ? defs[0].name + ' (' + defs[0].code + ')' : list) +
        ' — Layer ของตัวเหล่านี้จะถูกลบทิ้ง (ใส่ใหม่เมื่อไรจะสร้าง Layer ให้เอง) ต้นฉบับที่ใส่มาจะกลับมาเข้มเหมือนเดิม · Ctrl+Z ใน Illustrator เพื่อย้อนกลับ',
      ok: defs.length === 1 ? 'ลบ' : 'ลบ ' + defs.length + ' ตัว', danger: true
    });
    if (!yes) return false;
    const codes = defs.map(d => d.code);
    try {
      const r = await window.Host.call('clearGlyphs', codes);
      for (let k = 0; k < codes.length; k += 16) await A.fetchOutlines(codes.slice(k, k + 16));
      A.updateCounts(); A.schedulePreview();
      const bad = (r.failed || []);
      if (bad.length) {
        console.warn('[TFS] clearGlyphs failed', bad);
        toast('ลบไม่สำเร็จ ' + bad.length + ' ตัว (' + bad.map(f => displayChar(GD.BY_CODE[f.code] || { char: f.code })).join(' ') + '): ' + bad[0].error, { error: true });
        return false;
      }
      toast('ลบ ' + (defs.length === 1 ? chars[0] : defs.length + ' ตัว') + ' แล้ว' + (r.restored ? ' · คืนความเข้มต้นฉบับ ' + r.restored + ' ชิ้น' : '') + ' — คลิกช่องเพื่อใส่ใหม่');
      return true;
    } catch (e) { toast('ลบไม่สำเร็จ: ' + e.message, { error: true }); return false; }
    finally { render(); }
  }

  function setPickMode(on) {
    pickMode = on; picked.clear();
    render();
  }

  function togglePick(def, cell) {
    if (!isDrawn(def.code)) { toast(displayChar(def) + ' ยังไม่มีเส้น'); return; }
    if (picked.has(def.code)) picked.delete(def.code); else picked.add(def.code);
    if (cell) cell.classList.toggle('picked', picked.has(def.code));
    renderPickBar();
  }

  function renderPickBar() {
    $('btnPickDel').classList.toggle('on', pickMode);
    $('btnPickDel').textContent = pickMode ? 'เลิกเลือก' : 'เลือกลบหลายตัว';
    $('pickBar').classList.toggle('hidden', !pickMode);
    $('pickCount').textContent = picked.size ? 'เลือกแล้ว ' + picked.size + ' ตัว' : 'คลิกช่องที่ต้องการลบ (คลิกซ้ำเพื่อยกเลิก)';
    $('btnPickRun').disabled = !picked.size;
    $('placeGrid').classList.toggle('picking', pickMode);
  }

  /** คลิกโดนปุ่ม × ไหม — วัดจากตำแหน่งเมาส์ ไม่พึ่ง event ของปุ่มย่อยในปุ่ม (บาง Chromium ใน CEP ส่ง click ให้แค่ปุ่มแม่) */
  function hitDelete(cell, e) {
    const del = cell && cell.querySelector('.cell-del');
    if (!del || !e) return false;
    const r = del.getBoundingClientRect();
    return r.width > 0 && e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
  }

  /** คลิกช่อง: ปุ่ม × = ลบ · โหมดเลือกลบ = เลือก/ยกเลิก · ปกติ = ใส่เส้นที่เลือกบน Canvas */
  function onCell(def, e) {
    const cell = e && e.currentTarget;
    if (!pickMode && hitDelete(cell, e)) return clearGlyphs([def]);
    if (!pickMode) return placeInto(def);
    togglePick(def, document.querySelector('#placeGrid .cell[data-code="' + def.code + '"]'));
  }

  /** ปุ่ม × บนช่องที่มีเส้นแล้ว (โผล่เมื่อชี้) · โหมดเลือกลบ: ทำเครื่องหมายช่องที่เลือกไว้ */
  function decorate(b, def) {
    if (!isDrawn(def.code)) return;
    if (pickMode) { b.classList.toggle('picked', picked.has(def.code)); b.appendChild(el('span', { class: 'cell-pick' }, '✓')); return; }
    b.appendChild(el('span', { class: 'cell-del', title: 'ลบ ' + def.char + ' (ใส่ผิดตัว)' }, '×'));   // การคลิกจัดการใน onCell
  }

  // ------------------------------------------------------ Layer อ้างอิง
  // ตอนเข้าแท็บ: ถ้ายังไม่มีเส้นใน Layer อ้างอิง → แจ้งเตือน (ครั้งแรกต่อเอกสารเป็นกล่องข้อความ) และแสดงแถบเตือนค้างไว้จนกว่าจะมี
  const warnedDocs = {};
  let refState = null;

  async function prepareReference(quiet) {
    try {
      const r = await window.Host.call('activateReference');
      if (!quiet) toast('พร้อมวางที่ Layer "' + r.name + '"' + (r.created ? ' (สร้างใหม่)' : '') + ' — กด Ctrl+V ใน Illustrator แล้วลากไปไว้นอก Artboard');
      await checkReference(false);
    } catch (e) { toast('เตรียม Layer อ้างอิงไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  function renderRefBanner() {
    const box = $('placeRefWarn'); box.innerHTML = '';
    const r = refState;
    const msgs = [];
    if (r && r.hasDoc) {
      if (!r.items) msgs.push('ยังไม่มีเส้นใน Layer อ้างอิง — วาง (Paste) หรือสร้างเส้นที่ trace มาใน Layer "Reference" ก่อน แล้ววางไว้นอก Artboard');
      else if (r.onBoard) msgs.push('มีเส้นอ้างอิง ' + r.onBoard + ' ชิ้นทับอยู่ใน Artboard — ลากไปไว้นอก Artboard จะได้ไม่บังตัวที่กำลังใส่');
      if (r.items && r.locked) msgs.push('Layer อ้างอิงถูกล็อกอยู่ — ปลดล็อกก่อนจึงจะเลือกเส้นได้');
      if (r.items && r.hidden) msgs.push('Layer อ้างอิงถูกซ่อนอยู่ — เปิดตาก่อนจึงจะเห็นเส้น');
    }
    box.classList.toggle('hidden', !msgs.length);
    if (!msgs.length) return;
    msgs.forEach(m => box.appendChild(el('div', { class: 'issue' }, el('span', { class: 'txt' }, m))));
    box.appendChild(el('div', { class: 'place-ref-actions' },
      el('button', { class: 'btn', onclick: () => prepareReference(false), title: 'สร้าง/ปลดล็อก/แสดง Layer Reference แล้วตั้งเป็น Layer ที่ใช้งาน เพื่อให้ Ctrl+V วางลงที่นั่น' }, 'เตรียม Layer Reference ให้วาง'),
      el('button', { class: 'btn quiet', onclick: () => checkReference(false), title: 'ตรวจ Layer อ้างอิงอีกครั้ง' }, 'ตรวจอีกครั้ง')));
  }

  async function checkReference(allowDialog) {
    try { refState = await window.Host.call('referenceInfo'); } catch (e) { refState = null; }
    renderRefBanner();
    const r = refState;
    if (!allowDialog || !r || !r.hasDoc || r.items) return;
    const key = state.docKey || '_';
    if (warnedDocs[key]) return;
    warnedDocs[key] = true;
    const go = await confirmDialog({
      title: 'ยังไม่มีเส้นใน Layer อ้างอิง',
      text: 'ก่อนใส่เส้น ให้วาง (Paste) หรือสร้างเส้นที่ trace มาไว้ใน Layer "Reference" ของเอกสารนี้ก่อน · ' +
        'วางไว้นอก Artboard (ข้าง ๆ กรอบ) เท่านั้น ถ้าวางทับ Artboard จะบังตัวที่กำลังใส่ · ' +
        'ถ้า trace มา ให้ Expand แล้ว Ungroup ก่อน เพื่อให้คลิกเลือกทีละตัวได้',
      ok: 'เตรียม Layer Reference ให้วาง', cancel: 'ไว้ทีหลัง'
    });
    if (go) prepareReference(false);
  }

  function renderScale() {
    const p = S().place;
    if (A.ctl.placeSize) A.ctl.placeSize.set(p.keepSize ? 'keep' : 'same');
    const from = GD.BY_CODE[p.from];
    $('placeScale').textContent = p.keepSize ? '' : p.scale
      ? 'อัตรา ' + Math.round(p.scale * 100) + '%' + (from ? ' (ตั้งจาก ' + from.char + ')' : '')
      : 'ตัวแรกที่ใส่ควรเป็น ก น หรือ H — ใช้ตั้งขนาดให้ทุกตัว';
    $('btnPlaceReset').classList.toggle('hidden', p.keepSize || !p.scale);
  }

  function render() {
    renderScale();
    if (A.ctl.placeSet) A.ctl.placeSet.set(state.set);
    A.renderGlyphGrid($('placeGrid'), setGlyphs(), onCell, decorate);
    renderPickBar();
  }

  function wire() {
    A.ctl.placeSet = bindSeg($('placeSetSeg'), 'data-set', state.set, v => {
      state.set = v; S().ui.glyphSet = v;
      if (A.ctl.set) A.ctl.set.set(v);
      A.renderGrid(); render();
    });
    A.ctl.placeSize = bindSeg($('placeSizeSeg'), 'data-size', 'same', v => { S().place.keepSize = v === 'keep'; A.saveSettings(); renderScale(); });
    $('btnPlaceReset').onclick = () => { S().place.scale = 0; S().place.from = ''; A.saveSettings(); renderScale(); };
    $('btnPickDel').onclick = () => setPickMode(!pickMode);
    $('btnPickCancel').onclick = () => setPickMode(false);
    $('btnPickAll').onclick = () => { setGlyphs().forEach(d => { if (isDrawn(d.code)) picked.add(d.code); }); render(); };
    $('btnPickRun').onclick = async () => {
      const defs = setGlyphs().filter(d => picked.has(d.code));
      if (await clearGlyphs(defs)) setPickMode(false);
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && pickMode && state.tab === 'place' && !document.querySelector('.dialog')) setPickMode(false); });
  }

  A.placeInto = placeInto;
  A.tabs.place = { render, wire, enter: () => { if (state.ready) checkReference(true); } };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-place': '2.0.0-cba108e5' });
