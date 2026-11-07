/**
 * แท็บ เลือก/วาง — เลือกเส้นบน Canvas (เช่น ลายมือที่ trace มา วางไว้นอก Artboard ใน Layer Reference)
 * แล้วคลิกช่องตัวอักษร → คัดลอกไป Layer ของตัวนั้น ย่อขยาย/จัดตำแหน่งให้ แล้วไปตัวถัดไปที่ยังไม่วาด
 *
 *  • ปุ่ม × บนช่อง = ลบตัวนั้น · "เลือกลบหลายตัว" = เลือกหลายช่องแล้วลบทีเดียว (ถามยืนยันก่อนเสมอ)
 *  • เข้าแท็บแล้ว Layer อ้างอิงยังว่าง → เตือน (กล่องข้อความครั้งแรกต่อเอกสาร + แถบเตือนค้างไว้)
 */
(function () {
  'use strict';
  const { $, el, toast, bindSeg, confirmDialog } = window.UI;
  const GD = window.GlyphData;
  const A = window.TFSApp;
  const { state, S, statusOf, displayChar, setGlyphs, isDrawn } = A;

  const LATIN_XH = 'acemnorsuvwxz', LATIN_DESC = 'gjpqy';
  const UNDO_HINT = 'Ctrl+Z ใน Illustrator เพื่อย้อนกลับ';
  const FETCH_BATCH = 16;       // อ่านเส้นกลับจาก Illustrator ครั้งละกี่ตัว
  const LIST_MAX = 40;          // แสดงรายชื่อในกล่องยืนยันลบได้กี่ตัว

  // ================================================================ วาง
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
    if (def.longDescender || (def.cutTail && !def.isCutVariant)) return { anchor: 'top', y: c.cap };
    if (def.group === 'latin-lower' && LATIN_DESC.indexOf(def.char) >= 0) return { anchor: 'top', y: c.baseline + Math.round(H * 0.75) };
    if (def.char === 'Q' || def.char === 'J') return { anchor: 'top', y: c.cap };
    return { anchor: 'bottom', y: c.baseline };
  }

  /** ตัวถัดไปที่ยังไม่วาด ตามลำดับในตาราง */
  function nextMissing(def) {
    const list = setGlyphs(), i = list.indexOf(def);
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

  function placeOptions(def, replace) {
    const c = S().canvas, p = S().place;
    return Object.assign({
      scale: p.keepSize ? 1 : (p.scale || 0), refH: refHeight(def, c), keepSize: !!p.keepSize,
      cx: (c.lsbGuide + c.rsbGuide) / 2, replace: !!replace, dim: true
    }, placeAnchor(def, c));
  }

  /** ข้อความต่อท้ายหลังวาง: ตั้งอัตราใหม่ / ยังไม่มีอัตรา / ข้ามภาพ (และจำอัตราใหม่ไว้ในโปรเจกต์) */
  function placeNote(def, r) {
    const p = S().place;
    let note = '';
    if (r.newScale) {
      p.scale = r.scale; p.from = def.code; A.saveSettings();
      note = ' · ตั้งขนาด ' + Math.round(r.scale * 100) + '% จาก ' + def.char;
    } else if (!p.keepSize && !p.scale) note = ' · ใช้ขนาดเดิม (วาง ก น หรือ H ก่อน เพื่อตั้งขนาดให้ทุกตัว)';
    if (r.skipped) note += ' · ข้ามภาพ ' + r.skipped + ' ชิ้น';
    return note;
  }

  async function placeInto(def, replace) {
    if (def.kind === 'auto') { toast(def.char + ' สร้างอัตโนมัติ ไม่ต้องวาง'); return; }
    let r;
    try { r = await window.Host.call('placeSelection', def.code, placeOptions(def, replace)); }
    catch (e) {
      const code = e.message;
      if (code === 'HAS_ART') toast(def.char + ' มีเส้นแล้ว — แทนที่ด้วยเส้นที่เลือก?', { action: { label: 'แทนที่', fn: () => placeInto(def, true) }, ms: 6000 });
      else if (code === 'NO_SELECTION') toast(PLACE_ERR.NO_SELECTION);
      else toast('วางไม่สำเร็จ: ' + (PLACE_ERR[code] || code), { error: true });
      return;
    }
    const note = placeNote(def, r);
    await A.fetchOutlines([def.code]);
    const next = nextMissing(def);
    await A.selectGlyph(next || def);   // สลับ Layer ใน Illustrator ไปตัวถัดไป (และวาดแท็บนี้ใหม่)
    A.updateCounts(); A.schedulePreview();
    toast('วาง ' + def.char + ' แล้ว' + (next ? ' → ต่อไป ' + displayChar(next) : '') + note + ' (' + UNDO_HINT + ')');
  }

  // ================================================================ ลบ
  let pickMode = false;
  const picked = new Set();

  function confirmClear(defs) {
    const chars = defs.map(displayChar);
    const one = defs.length === 1;
    const list = chars.length > LIST_MAX ? chars.slice(0, LIST_MAX).join(' ') + ' … (+' + (chars.length - LIST_MAX) + ')' : chars.join(' ');
    return confirmDialog({
      title: one ? 'ลบ ' + chars[0] + ' ?' : 'ลบ ' + defs.length + ' ตัว ?',
      text: (one ? defs[0].name + ' (' + defs[0].code + ')' : list) +
        ' — Layer ของตัวเหล่านี้จะถูกลบทิ้ง (วางใหม่เมื่อไรจะสร้าง Layer ให้เอง) ต้นฉบับที่วางมาจะกลับมาเข้มเหมือนเดิม · ' + UNDO_HINT,
      ok: one ? 'ลบ' : 'ลบ ' + defs.length + ' ตัว', danger: true
    });
  }

  /** ลบหลายตัวในครั้งเดียว (ถามยืนยันก่อน) · คืน true ถ้าลบครบ */
  async function clearGlyphs(defs) {
    defs = defs.filter(d => isDrawn(d.code));
    if (!defs.length || !(await confirmClear(defs))) return false;
    const codes = defs.map(d => d.code);
    try {
      const r = await window.Host.call('clearGlyphs', codes);
      for (let k = 0; k < codes.length; k += FETCH_BATCH) await A.fetchOutlines(codes.slice(k, k + FETCH_BATCH));
      A.updateCounts(); A.schedulePreview();
      const bad = r.failed || [];
      if (bad.length) {
        console.warn('[TFS] clearGlyphs failed', bad);
        const names = bad.map(f => GD.BY_CODE[f.code] ? displayChar(GD.BY_CODE[f.code]) : f.code).join(' ');
        toast('ลบไม่สำเร็จ ' + bad.length + ' ตัว (' + names + '): ' + bad[0].error, { error: true });
        return false;
      }
      const what = defs.length === 1 ? displayChar(defs[0]) : defs.length + ' ตัว';
      toast('ลบ ' + what + ' แล้ว' + (r.restored ? ' · คืนความเข้มต้นฉบับ ' + r.restored + ' ชิ้น' : '') + ' — คลิกช่องเพื่อวางใหม่');
      return true;
    } catch (e) { toast('ลบไม่สำเร็จ: ' + e.message, { error: true }); return false; }
    finally { render(); }
  }

  function setPickMode(on) { pickMode = on; picked.clear(); render(); }

  function togglePick(def, cell) {
    if (!isDrawn(def.code)) { toast(displayChar(def) + ' ยังไม่มีเส้น'); return; }
    if (picked.has(def.code)) picked.delete(def.code); else picked.add(def.code);
    if (cell) cell.classList.toggle('picked', picked.has(def.code));
    renderPickBar();
  }

  function renderPickBar() {
    const btn = $('btnPickDel');
    btn.classList.toggle('on', pickMode);
    btn.textContent = pickMode ? 'เลิกเลือก' : 'เลือกลบหลายตัว';
    $('pickBar').classList.toggle('hidden', !pickMode);
    $('pickCount').textContent = picked.size ? 'เลือกแล้ว ' + picked.size + ' ตัว' : 'คลิกช่องที่ต้องการลบ (คลิกซ้ำเพื่อยกเลิก)';
    $('btnPickRun').disabled = !picked.size;
    $('placeGrid').classList.toggle('picking', pickMode);
  }

  /** คลิกโดนปุ่ม × ไหม — วัดจากตำแหน่งเมาส์ ไม่พึ่ง event ของปุ่มย่อย (บาง Chromium ใน CEP ส่ง click ให้แค่ปุ่มแม่) */
  function hitDelete(cell, e) {
    const del = cell && cell.querySelector('.cell-del');
    if (!del || !e) return false;
    const r = del.getBoundingClientRect(), pad = 2;
    return r.width > 0 && e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  }

  /** คลิกช่อง: โหมดเลือกลบ = เลือก/ยกเลิก · โดน × = ลบ · ปกติ = วางเส้นที่เลือกบน Canvas */
  function onCell(def, e) {
    const cell = e && e.currentTarget;
    if (pickMode) return togglePick(def, cell);
    if (hitDelete(cell, e)) return clearGlyphs([def]);
    return placeInto(def);
  }

  /** ของในช่องที่มีเส้นแล้ว: ปุ่ม × (โผล่เมื่อชี้) หรือวงเลือกในโหมดเลือกลบ — การคลิกจัดการใน onCell */
  function decorate(b, def) {
    if (!isDrawn(def.code)) return;
    if (pickMode) {
      b.classList.toggle('picked', picked.has(def.code));
      b.appendChild(el('span', { class: 'cell-pick' }, '✓'));
    } else b.appendChild(el('span', { class: 'cell-del', title: 'ลบ ' + def.char + ' (วางผิดตัว)' }, '×'));
  }

  // ======================================================= Layer อ้างอิง
  const warnedDocs = new Set();
  let refState = null;

  async function prepareReference() {
    try {
      const r = await window.Host.call('activateReference');
      toast('พร้อมวางที่ Layer "' + r.name + '"' + (r.created ? ' (สร้างใหม่)' : '') + ' — กด Ctrl+V ใน Illustrator แล้วลากไปไว้นอก Artboard');
      await checkReference(false);
    } catch (e) { toast('เตรียม Layer อ้างอิงไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  function refWarnings(r) {
    if (!r || !r.hasDoc) return [];
    if (!r.items) return ['ยังไม่มีเส้นใน Layer อ้างอิง — วาง (Paste) หรือสร้างเส้นที่ trace มาใน Layer "Reference" ก่อน แล้ววางไว้นอก Artboard'];
    const out = [];
    if (r.onBoard) out.push('มีเส้นอ้างอิง ' + r.onBoard + ' ชิ้นทับอยู่ใน Artboard — ลากไปไว้นอก Artboard จะได้ไม่บังตัวที่กำลังวาง');
    if (r.locked) out.push('Layer อ้างอิงถูกล็อกอยู่ — ปลดล็อกก่อนจึงจะเลือกเส้นได้');
    if (r.hidden) out.push('Layer อ้างอิงถูกซ่อนอยู่ — เปิดตาก่อนจึงจะเห็นเส้น');
    return out;
  }

  function renderRefBanner() {
    const box = $('placeRefWarn'), msgs = refWarnings(refState);
    box.innerHTML = '';
    box.classList.toggle('hidden', !msgs.length);
    if (!msgs.length) return;
    msgs.forEach(m => box.appendChild(el('div', { class: 'issue' }, el('span', { class: 'txt' }, m))));
    box.appendChild(el('div', { class: 'place-ref-actions' },
      el('button', { class: 'btn', onclick: prepareReference, title: 'สร้าง/ปลดล็อก/แสดง Layer Reference แล้วตั้งเป็น Layer ที่ใช้งาน เพื่อให้ Ctrl+V วางลงที่นั่น' }, 'เตรียม Layer Reference ให้วาง'),
      el('button', { class: 'btn quiet', onclick: () => checkReference(false), title: 'ตรวจ Layer อ้างอิงอีกครั้ง' }, 'ตรวจอีกครั้ง')));
  }

  /** ตรวจ Layer อ้างอิง แล้ววาดแถบเตือน · allowDialog: เด้งกล่องเตือนถ้ายังว่าง (ครั้งแรกต่อเอกสาร) */
  async function checkReference(allowDialog) {
    try { refState = await window.Host.call('referenceInfo'); } catch (e) { refState = null; }
    renderRefBanner();
    const r = refState, key = state.docKey || '_';
    if (!allowDialog || !r || !r.hasDoc || r.items || warnedDocs.has(key)) return;
    warnedDocs.add(key);
    const go = await confirmDialog({
      title: 'ยังไม่มีเส้นใน Layer อ้างอิง',
      text: 'ก่อนวาง ให้วาง (Paste) หรือสร้างเส้นที่ trace มาไว้ใน Layer "Reference" ของเอกสารนี้ก่อน · ' +
        'วางไว้นอก Artboard (ข้าง ๆ กรอบ) เท่านั้น ถ้าวางทับ Artboard จะบังตัวที่กำลังวาง · ' +
        'ถ้า trace มา ให้ Expand แล้ว Ungroup ก่อน เพื่อให้คลิกเลือกทีละตัวได้',
      ok: 'เตรียม Layer Reference ให้วาง', cancel: 'ไว้ทีหลัง'
    });
    if (go) prepareReference();
  }

  // ================================================================ แท็บ
  function renderScale() {
    const p = S().place, from = GD.BY_CODE[p.from];
    if (A.ctl.placeSize) A.ctl.placeSize.set(p.keepSize ? 'keep' : 'same');
    $('placeScale').textContent = p.keepSize ? '' : p.scale
      ? 'อัตรา ' + Math.round(p.scale * 100) + '%' + (from ? ' (ตั้งจาก ' + from.char + ')' : '')
      : 'ตัวแรกที่วางควรเป็น ก น หรือ H — ใช้ตั้งขนาดให้ทุกตัว';
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
    $('btnPickRun').onclick = async () => { if (await clearGlyphs(setGlyphs().filter(d => picked.has(d.code)))) setPickMode(false); };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && pickMode && state.tab === 'place' && !document.querySelector('.dialog')) setPickMode(false);
    });
  }

  A.tabs.place = { render, wire, enter: () => { if (state.ready) checkReference(true); } };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-place': '2.0.0-2e84cd1e' });
