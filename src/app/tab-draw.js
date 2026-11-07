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

  /** ช่องตัวอักษร 1 ช่อง · onClick: ค่าเริ่มต้น = เลือกตัวนั้น · decorate(b, def): เพิ่มของในช่อง (แท็บ ใส่เส้น ใช้ทั้งสองอย่าง) */
  function makeCell(def, onClick, decorate) {
    const st = statusOf(def);
    const click = onClick || A.selectGlyph;
    const b = el('button', {
      class: 'cell ' + st + (def === state.active ? ' on' : ''), 'data-code': def.code,
      title: def.name + ' (' + def.code + ')', onclick: e => click(def, e)
    });
    b._click = click; b._decorate = decorate;
    let svg = glyphSvg(def.code);
    if (!svg && def.isCutVariant && isDrawn(def.baseCode)) svg = glyphSvg(def.baseCode, '', cutPreview(def));
    b.appendChild(svg || el('span', { class: 'ph' }, displayChar(def)));
    b.appendChild(el('i', { class: 'dot' }));
    if (def.isCutVariant) b.appendChild(el('span', { class: 'tag' }, 'ตัด'));
    if (isCustomized(def)) b.appendChild(el('i', { class: 'mod', title: 'คุณปรับเฉพาะตัวนี้เอง (ช่องไฟ / แนวตั้ง / ตำแหน่งสระ)' }));
    if (decorate) decorate(b, def);
    return b;
  }

  function updateCell(code) {
    const def = GD.BY_CODE[code];
    // ช่องเดียวกันอาจอยู่หลายตาราง (แท็บ วาด / ใส่เส้น) — แทนที่ทุกช่องโดยคงการทำงานตอนคลิกของตารางนั้นไว้
    if (def) document.querySelectorAll('.cell[data-code="' + code + '"]').forEach(old => old.parentNode.replaceChild(makeCell(def, old._click, old._decorate), old));
    if (code === 'U+0E4D' || code === 'U+0E32') updateCell('U+0E33');
    if (code === 'U+0E0D') updateCell('U+F70F');
    if (code === 'U+0E10') updateCell('U+F700');
  }

  /** ตารางตัวอักษรแบ่งตามหมวด (ใช้ร่วมกับแท็บ ใส่เส้น) */
  function renderGlyphGrid(host, list, onClick, decorate) {
    host.innerHTML = '';
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
      g.items.forEach(d => grid.appendChild(makeCell(d, onClick, decorate)));
      host.appendChild(grid);
    });
    if (!groups.length) host.appendChild(el('p', { class: 'note' }, 'ไม่พบตัวอักษรที่ตรงกับตัวกรอง'));
  }

  function renderGrid() {
    renderGlyphGrid($('grid'), visibleList());
    updateCounts();
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
    $('btnTweak').onclick = () => { const d = state.active; A.setTab(GD.isMark(d) ? 'marks' : 'spacing'); };
    document.addEventListener('keydown', e => {
      const t = e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (e.key === '[') { e.preventDefault(); step(-1); }
      else if (e.key === ']') { e.preventDefault(); step(1); }
    });
  }

  Object.assign(A, { renderGrid, renderGlyphGrid, renderCurrent, updateCell, updateCounts });
  A.tabs.draw = { render() { renderGrid(); renderCurrent(); }, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-draw': '2.0.0-cba108e5' });
