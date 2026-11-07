/**
 * แท็บ วาด — ตารางตัวอักษร, ตัวที่เลือก + คำเตือน/คำแนะนำ, ตัดเชิงอัตโนมัติ, แปลง Stroke
 */
(function () {
  'use strict';
  const { $, el, toast, debounce, bindSeg } = window.UI;
  const GD = window.GlyphData;
  const A = window.TFSApp;
  const { state, S, isDrawn, hostWarn, statusOf, norm, displayChar, setGlyphs, cutPreview, glyphSvg, isCustomized } = A;

  function visibleList() {
    const q = state.search.trim().toLowerCase();
    return setGlyphs().filter(d => {
      const st = statusOf(d);
      if (state.filter === 'done' && st === 'missing') return false;
      if (state.filter === 'missing' && st !== 'missing') return false;
      if (state.filter === 'custom' && !isCustomized(d)) return false;
      if (state.filter === 'warn' && st !== 'warn' && !(state.warn[d.code] && (state.warn[d.code].strokes || state.warn[d.code].text))) return false;
      if (!q) return true;
      return d.char.toLowerCase() === q || d.name.toLowerCase().indexOf(q) >= 0 || d.code.toLowerCase().indexOf(q) >= 0;
    });
  }

  function step(dir) {
    const vis = visibleList();
    const list = vis.length ? vis : setGlyphs();
    let i = list.indexOf(state.active);
    i = i < 0 ? 0 : (i + dir + list.length) % list.length;
    A.selectGlyph(list[i]);
  }

  function renderCurrent() {
    const def = state.active, st = statusOf(def);
    const spec = $('curSpec'); spec.innerHTML = '';
    let svg = glyphSvg(def.code, '', null, true);
    if (!svg && def.isCutVariant && isDrawn(def.baseCode)) svg = glyphSvg(def.baseCode, '', cutPreview(def), true);
    if (svg) spec.appendChild(svg);
    else spec.appendChild(el('div', { class: 'ph' }, displayChar(def)));
    $('curName').textContent = def.name;
    $('curCode').textContent = def.code + (def.isCutVariant ? ' · ใช้แทนเมื่อมีสระล่าง' : '');
    const pill = $('curStatus');
    pill.className = 'status-pill' + (st === 'done' || st === 'auto' ? ' done' : st === 'warn' ? ' warn' : '');
    pill.querySelector('span').textContent = st === 'done' ? 'วาดแล้ว' : st === 'warn' ? 'วาดแล้ว — มีจุดที่ควรแก้' :
      st === 'auto' ? 'สร้างอัตโนมัติ' : 'ยังไม่ได้วาด';
    const tw = $('btnTweak'); tw.classList.toggle('on', isCustomized(def));
    tw.textContent = isCustomized(def) ? '✎ ปรับเฉพาะตัวแล้ว' : '✎ ปรับเฉพาะตัว';
    renderIssues(def);
  }

  function renderIssues(def) {
    const box = $('curIssues'); box.innerHTML = '';
    const w = hostWarn(def.code);
    const n = norm(def.code);
    const add = (txt, btn) => box.appendChild(el('div', { class: 'issue' }, el('span', { class: 'txt' }, txt), btn || null));
    if (w.strokes) add('มีเส้น Stroke ' + w.strokes + ' เส้น — ตอนส่งออกจะแปลงเป็นรูปทรงให้อัตโนมัติ',
      el('button', { class: 'btn', onclick: () => outlineInPlace(def) }, 'แปลงตอนนี้'));
    if (w.text) add('มีข้อความ ' + w.text + ' กล่อง — จะถูกแปลงเป็นเส้นตอนส่งออก');
    if (w.white) add('มีรูปสีขาว ' + w.white + ' ชิ้น ระบบจะใช้เป็นรูเจาะ — ทางที่ถูกคือเลือกทั้งหมดแล้ว Object › Compound Path › Make (Ctrl+8)');
    if (w.clip) add('มี Clipping Mask — ส่วนที่ถูกซ่อนจะโผล่ในฟอนต์ ควร Release Clipping Mask ก่อน');
    if (w.image) add('มีภาพ ' + w.image + ' ภาพ — ภาพไม่ถูกใส่ในฟอนต์ (ใช้เป็นภาพร่างได้)');
    if (w.other) add('มีวัตถุพิเศษ ' + w.other + ' ชิ้น (Symbol/Effect) — จะ Expand ตอนส่งออก');
    if (n && n.issues.open) add('มีเส้นเปิดที่ไม่มีสีพื้น ' + n.issues.open + ' เส้น — จะไม่ปรากฏในฟอนต์');

    const tip = (txt, btn) => box.appendChild(el('div', { class: 'tip' }, el('span', null, txt), btn || null));
    if (def.isCutVariant) {
      const base = GD.BY_CODE[def.baseCode];
      tip(isDrawn(def.code) ? 'วาดเองแล้ว — จะใช้ตัวนี้แทนการตัดอัตโนมัติ' : 'ถ้าไม่วาด ระบบจะตัดเชิงจาก ' + base.char + ' ให้ตอนส่งออก',
        el('button', { class: 'btn', onclick: () => autoCut(def) }, 'ตัดเชิงอัตโนมัติ'));
    } else if (def.kind === 'auto') {
      tip('สร้างจาก ํ (นิคหิต) + า (สระอา) ให้อัตโนมัติ ไม่ต้องวาด');
    } else if (GD.isMark(def) && !isDrawn(def.code)) {
      tip('วาดที่ตำแหน่งใดก็ได้ ระบบจะวางบนพยัญชนะให้เอง ปรับระยะได้ในแท็บ สระ/วรรณยุกต์');
    }
  }

  async function outlineInPlace(def) {
    try {
      await window.Host.call('outlineStrokesInPlace', def.code);
      await A.fetchOutlines([def.code]); renderCurrent(); A.schedulePreview();
      toast('แปลงเส้น Stroke เป็นรูปทรงแล้ว (Ctrl+Z เพื่อย้อนกลับใน Illustrator)');
    } catch (e) { toast('แปลงไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  async function autoCut(def) {
    if (!isDrawn(def.baseCode)) { toast('ต้องวาด ' + GD.BY_CODE[def.baseCode].char + ' ก่อน', { error: true }); return; }
    try {
      const r = await window.Host.call('autoCut', def.baseCode, def.code, S().canvas);
      await A.fetchOutlines([def.code]);
      await A.selectGlyph(def, true);
      updateCounts(); A.schedulePreview();
      toast(r.method === 'crop' ? 'ตัดเชิงแล้ว — ตรวจดูรอยตัดได้ใน Illustrator' : 'ตัดชิ้นที่อยู่ใต้เส้นฐานออกแล้ว (เชิงที่ต่อกับตัวต้องตัดเองด้วยมีด/Pathfinder)');
    } catch (e) { toast('ตัดเชิงไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  // ============================================================ ใส่จากที่เลือก
  // เลือกเส้น (เช่น ลายมือที่ trace มา วางไว้นอก Artboard ใน Layer Reference) แล้วคลิกช่อง → คัดลอกไป Layer ของตัวนั้น
  let placeMode = A.store.get('tfsPlaceMode') === '1';
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

  /** ตัวถัดไปที่ยังไม่วาด (ตามลำดับในตารางที่มองเห็น) */
  function nextMissing(def) {
    const list = visibleList().length ? visibleList() : setGlyphs();
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
    if (def.kind === 'auto') { toast(def.char + ' สร้างอัตโนมัติ ไม่ต้องใส่'); A.selectGlyph(def); return; }
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
      if (e.message === 'NO_SELECTION') { await A.selectGlyph(def); toast(PLACE_ERR.NO_SELECTION + ' — เลือก ' + def.char + ' ให้แทน'); return; }
      toast('ใส่ไม่สำเร็จ: ' + (PLACE_ERR[e.message] || e.message), { error: true });
      return;
    }
    let note = '';
    if (r.newScale) { p.scale = r.scale; p.from = def.code; A.saveSettings(); renderPlaceBar(); note = ' · ตั้งขนาด ' + Math.round(r.scale * 100) + '% จาก ' + def.char; }
    else if (!p.keepSize && !p.scale) note = ' · ใส่ขนาดเดิม (ใส่ น หรือ H ก่อน เพื่อตั้งขนาดให้ทุกตัว)';
    if (r.skipped) note += ' · ข้ามภาพ ' + r.skipped + ' ชิ้น';
    await A.fetchOutlines([def.code]);
    const next = nextMissing(def);
    await A.selectGlyph(next || def);
    updateCounts(); A.schedulePreview();
    toast('ใส่ ' + def.char + ' แล้ว' + (next ? ' → ต่อไป ' + displayChar(next) : '') + note + ' (Ctrl+Z ใน Illustrator เพื่อย้อนกลับ)');
  }

  function renderPlaceBar() {
    $('btnPlaceMode').classList.toggle('on', placeMode);
    $('placeBar').classList.toggle('hidden', !placeMode);
    const g = $('grid'); if (g) g.classList.toggle('placing', placeMode);
    const p = S().place;
    if (A.ctl.placeSize) A.ctl.placeSize.set(p.keepSize ? 'keep' : 'same');
    const from = GD.BY_CODE[p.from];
    $('placeScale').textContent = p.keepSize ? '' : p.scale
      ? 'อัตรา ' + Math.round(p.scale * 100) + '%' + (from ? ' (ตั้งจาก ' + from.char + ')' : '')
      : 'ตัวแรกที่ใส่ควรเป็น น หรือ H — ใช้ตั้งขนาดให้ทุกตัว';
    $('btnPlaceReset').classList.toggle('hidden', p.keepSize || !p.scale);
  }

  function makeCell(def) {
    const st = statusOf(def);
    const b = el('button', {
      class: 'cell ' + st + (def === state.active ? ' on' : ''), 'data-code': def.code,
      title: def.name + ' (' + def.code + ')', onclick: () => (placeMode ? placeInto(def) : A.selectGlyph(def))
    });
    let svg = glyphSvg(def.code);
    if (!svg && def.isCutVariant && isDrawn(def.baseCode)) svg = glyphSvg(def.baseCode, '', cutPreview(def));
    b.appendChild(svg || el('span', { class: 'ph' }, displayChar(def)));
    b.appendChild(el('i', { class: 'dot' }));
    if (def.isCutVariant) b.appendChild(el('span', { class: 'tag' }, 'ตัด'));
    if (isCustomized(def)) b.appendChild(el('i', { class: 'mod', title: 'คุณปรับเฉพาะตัวนี้เอง (ช่องไฟ / แนวตั้ง / ตำแหน่งสระ)' }));
    return b;
  }

  function updateCell(code) {
    const old = document.querySelector('.cell[data-code="' + code + '"]');
    const def = GD.BY_CODE[code];
    if (old && def) old.parentNode.replaceChild(makeCell(def), old);
    if (code === 'U+0E4D' || code === 'U+0E32') updateCell('U+0E33');
    if (code === 'U+0E0D') updateCell('U+F70F');
    if (code === 'U+0E10') updateCell('U+F700');
  }

  function renderGrid() {
    const host = $('grid'); host.innerHTML = '';
    const list = visibleList();
    const groups = [];
    list.forEach(d => {
      let g = groups.find(x => x.key === d.group);
      if (!g) { g = { key: d.group, items: [] }; groups.push(g); }
      g.items.push(d);
    });
    groups.forEach(g => {
      const all = setGlyphs().filter(d => d.group === g.key);
      const done = all.filter(d => statusOf(d) !== 'missing').length;
      const bar = el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(done / all.length * 100) + '%' }));
      host.appendChild(el('div', { class: 'group-h' }, el('b', null, GD.GROUP_LABELS[g.key] || g.key), el('span', { class: 'num' }, done + '/' + all.length), bar));
      const grid = el('div', { class: 'grid' });
      g.items.forEach(d => grid.appendChild(makeCell(d)));
      host.appendChild(grid);
    });
    if (!groups.length) host.appendChild(el('p', { class: 'note' }, 'ไม่พบตัวอักษรที่ตรงกับตัวกรอง'));
    updateCounts();
    renderPlaceBar();
  }

  function updateCounts() {
    const all = setGlyphs();
    $('setCount').textContent = all.filter(d => statusOf(d) !== 'missing').length + '/' + all.length;
  }

  function wire() {
    A.ctl.set = bindSeg($('setSeg'), 'data-set', state.set, v => { state.set = v; S().ui.glyphSet = v; renderGrid(); });
    $('filterSel').onchange = () => { state.filter = $('filterSel').value; renderGrid(); };
    $('search').oninput = debounce(() => { state.search = $('search').value; renderGrid(); }, 150);
    $('btnPrev').onclick = () => step(-1); $('btnNext').onclick = () => step(1);
    $('btnPlaceMode').onclick = () => { placeMode = !placeMode; A.store.set('tfsPlaceMode', placeMode ? '1' : '0'); renderPlaceBar(); };
    A.ctl.placeSize = bindSeg($('placeSizeSeg'), 'data-size', 'same', v => { S().place.keepSize = v === 'keep'; A.saveSettings(); renderPlaceBar(); });
    $('btnPlaceReset').onclick = () => { S().place.scale = 0; S().place.from = ''; A.saveSettings(); renderPlaceBar(); };
    $('btnTweak').onclick = () => { const d = state.active; A.setTab(GD.isMark(d) ? 'marks' : 'spacing'); };
    document.addEventListener('keydown', e => {
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (e.key === '[') { e.preventDefault(); step(-1); }
      else if (e.key === ']') { e.preventDefault(); step(1); }
    });
  }

  Object.assign(A, { renderGrid, renderCurrent, updateCell, updateCounts });
  A.tabs.draw = { render() { renderGrid(); renderCurrent(); }, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-draw': '2.0.0-1b04fcfe' });
