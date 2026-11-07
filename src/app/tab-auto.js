/**
 * แท็บ จูนอัตโนมัติ — วิเคราะห์ → ดูก่อน/หลัง → ใช้ทั้งหมด/ย้อนกลับ + ตารางตรวจสระ/วรรณยุกต์
 */
(function () {
  'use strict';
  const { $, el, scrub, bindSeg, toast, debounce } = window.UI;
  const GD = window.GlyphData;
  const A = window.TFSApp;
  const { state, S, isDrawn, pt, contoursForDef, saveSettings, changed } = A;

  const AU = { prop: null, snap: null, scene: null, sceneKey: '', baseKey: '', sel: null, face: null, grid: null, gridKey: '', shapeCtl: null, advCtl: [] };
  const AT = () => window.AutoTune;
  const CONS = GD.THAI_GLYPHS.filter(d => d.thaiConsonant && !d.isCutVariant);
  const AU_STYLES = { tight: { curve: 0.8, follow: 0.3, minClear: 5 }, normal: { curve: 0.6, follow: 0.5, minClear: 8 }, loose: { curve: 0.45, follow: 0.7, minClear: 12 } };
  const AU_WORDS = ['ปั่นป่วน ฟ้าฝน', 'ผู้ใหญ่ ญี่ปุ่น', 'กิ่งไม้ พื้นที่ น้ำใจ', 'ก๊วน ทุกข์ ปี่ สิ้น', 'Hamburgefonstiv'];
  const GAP_ORDER = ['upperGap', 'level2Gap', 'lowerGap', 'tallGap'];
  const GAP_NAMES = { upperGap: 'A สระบน', level2Gap: 'B วรรณยุกต์', lowerGap: 'C สระล่าง', tallGap: 'D หลบหางสูง' };
  const auCfg = () => { if (!S().autoTune) S().autoTune = AT().defaults(); return S().autoTune; };
  let auScopeCtl, auStyleCtl;

  function auScene() {
    const key = GD.ALL_GLYPHS.filter(d => d.thaiConsonant || GD.isMark(d)).map(d => d.code + (isDrawn(d.code) ? (state.sigs[d.code] || '1') : '0')).join('|') + S().canvas.cap + '/' + S().canvas.baseline + JSON.stringify(S().glyphAdjust || {});
    if (!AU.scene || AU.sceneKey !== key) { AU.scene = window.AutoMarks.buildScene({ contoursFor: contoursForDef }); AU.sceneKey = key; AU.grid = null; }
    return AU.scene;
  }
  const settingsKey = () => JSON.stringify([S().glyphSpacing, S().glyphAdjust, S().anchors, S().marks, S().spacing]);

  function auCtx() {
    const cf = auCfg(), sel = state.active;
    const defs = cf.scope === 'all' ? GD.ALL_GLYPHS : cf.scope === 'selected' ? [sel] : GD.THAI_GLYPHS;
    const consonants = cf.scope === 'selected' ? CONS.filter(d => d === sel || d.code === sel.baseCode) : CONS;
    return { contoursFor: contoursForDef, defs, consonants, allConsonants: CONS, scene: auScene() };
  }

  function auAnalyze() {
    const sc = auScene();
    if (!Object.keys(sc.bases).length && !GD.ALL_GLYPHS.some(d => !GD.isMark(d) && isDrawn(d.code))) { toast('ยังไม่มีตัวที่วาด — วาดอย่างน้อยหนึ่งตัวก่อน', { error: true }); return; }
    const btn = $('btnAuAnalyze'); btn.disabled = true; btn.textContent = 'กำลังวิเคราะห์…';
    setTimeout(() => {
      try {
        AU.prop = AT().analyze(auCtx(), S());
        AU.baseKey = settingsKey();
        AU.grid = null;
        $('auCmp').classList.add('stale');
        schedAuFont();
      } catch (e) { console.error(e); toast('วิเคราะห์ไม่สำเร็จ: ' + e.message, { error: true }); }
      btn.disabled = false;
      renderAuto();
    }, 30);
  }
  const reanalyze = debounce(() => { if (AU.prop) { AU.prop = AT().analyze(auCtx(), S()); AU.baseKey = settingsKey(); AU.grid = null; schedAuFont(); renderAuto(); } }, 200);
  const schedAuFont = debounce(buildAuFont, 500);
  async function buildAuFont() {
    if (!AU.prop) return;
    try {
      const Sx = AT().previewSettings(S(), AU.prop);
      const res = window.FontCompiler.compile({ settings: Sx, outlines: state.outlines, glyphs: GD.ALL_GLYPHS, mode: 'preview', previewBoxes: true });
      const face = new FontFace('TFSProposal', res.buffer);
      await face.load();
      document.fonts.add(face);
      if (AU.face) document.fonts.delete(AU.face);
      AU.face = face;
    } catch (e) { console.error(e); }
    $('auCmp').classList.remove('stale');
  }

  function auApply() {
    const p = AU.prop; if (!p) return;
    AU.snap = AT().apply(S(), p); AU.prop = null; AU.grid = null;
    A.buildMarksControls();
    changed();
    toast('ใช้ค่าจูนแล้ว — ปรับละเอียดต่อได้ในแท็บ ช่องไฟ / สระ/วรรณยุกต์', { ms: 8000, action: { label: 'ย้อนกลับ', fn: auUndo } });
  }
  function auUndo() {
    if (!AU.snap) return;
    AT().restore(S(), AU.snap); AU.snap = null; AU.prop = null; AU.grid = null;
    A.buildMarksControls(); changed();
    toast('ย้อนกลับไปก่อนจูนแล้ว');
  }

  function bindAutoUI() {
    const cf = auCfg();
    [['auSpacing', 'spacing'], ['auGlobals', 'globals'], ['auMarks', 'marks'], ['auOverwrite', 'overwriteManual']].forEach(([id, k]) => {
      $(id).checked = !!cf[k];
      $(id).onchange = () => { cf[k] = $(id).checked; saveSettings(); reanalyze(); };
    });
    auScopeCtl.set(cf.scope);
    const host = $('auAdv'); host.innerHTML = '';
    const add = (label, key, min, max, step, base, title) => host.appendChild(scrub({ label, title, value: cf[key], min, max, step, base,
      onInput: v => { cf[key] = v; auStyleCtl.set(''); saveSettings(); reanalyze(); } }).el);
    add('ความลึกขอบเว้าที่นับ', 'depthCap', 0.05, 0.4, 0.01, 0.2, 'สัดส่วนความสูงตัวอักษร — ขอบเว้าลึกกว่านี้ไม่นับเพิ่ม');
    add('ผลของขอบโค้ง', 'curve', 0, 1, 0.05, 0.6, 'มาก = ตัวที่ขอบเว้า/โค้งได้ช่องไฟน้อยลงมาก');
    add('ตามรูปทรงหัวตัว', 'follow', 0, 1, 0.1, 0.5, '0 = สระอยู่ระดับเดียวกันทุกตัว · 1 = ลดลงตามหัวที่เตี้ยกว่า');
    add('ระยะต่ำสุด (pt)', 'minClear', 2, 30, 1, 8, 'สระใกล้ขอบหมึกกว่านี้ถือว่า "ชิดเกินไป"');
    // กลุ่มรูปทรง
    const sh = $('auShapes'); sh.innerHTML = ''; AU.shapeCtl = {};
    [['flat', 'ขอบตรง'], ['soft', 'โค้งเล็กน้อย'], ['deep', 'เว้าลึก']].forEach(([k, label]) => {
      const mem = el('div', { class: 'mem' });
      const sc = scrub({ label, value: cf.shapeAdjust[k] || 0, min: -60, max: 60, unit: 'pt', base: 0, title: 'เพิ่ม/ลดช่องไฟของทุกขอบในกลุ่มนี้',
        onInput: v => { cf.shapeAdjust[k] = v; saveSettings(); reanalyze(); } });
      sh.appendChild(el('div', { class: 'au-shape' }, sc.el, mem));
      AU.shapeCtl[k] = mem;
    });
  }

  function renderAuto() {
    const sc = auScene();
    const nBase = Object.keys(sc.bases).length, nMark = Object.keys(sc.marks).length;
    // ข้อเสนอเก่าเกินไป (วาดใหม่/แก้ค่าเอง) → ทิ้ง
    if (AU.prop && AU.baseKey !== settingsKey()) { AU.prop = null; AU.grid = null; }
    $('btnAuAnalyze').textContent = AU.prop ? 'วิเคราะห์ใหม่' : 'วิเคราะห์';
    $('btnAuUndo').classList.toggle('hidden', !AU.snap);
    const empty = $('auEmpty');
    empty.classList.toggle('hidden', !!nBase);
    if (!nBase) empty.textContent = 'ยังไม่มีพยัญชนะที่วาด — วาดในแท็บ วาด แล้วกลับมาที่นี่ (ลองนำเข้าจากฟอนต์ที่มีอยู่ในแท็บ ส่งออก เพื่อดูตัวอย่างได้)';
    renderAuResult();
    renderAuGrid(sc, nMark);
  }

  function renderAuResult() {
    const p = AU.prop;
    $('auResult').classList.toggle('hidden', !p);
    if (!p) return;
    const cf = p.cf, c = p.counts;
    $('auStem').textContent = p.stemW ? 'เส้นหนา ≈ ' + Math.round(p.stemW) + ' pt' : '';
    const sum = $('auSummary'); sum.innerHTML = '';
    const row = (k, v, cls) => sum.appendChild(el('div', { class: 'li' }, el('span', { class: 'k' }, k), el('span', { class: 'v ' + (cls || '') }, v)));
    let total = 0;
    if (cf.spacing) { row('ช่องไฟ', c.spacing ? el('span', null, 'ปรับ ', el('b', null, String(c.spacing)), ' ตัว') : 'ไม่ต้องปรับ'); total += c.spacing; }
    if (cf.globals) {
      if (p.globals.length) p.globals.slice().sort((a, b) => a.key === b.key ? 0 : (GAP_ORDER.indexOf(a.key) - GAP_ORDER.indexOf(b.key))).forEach(g => row(GAP_NAMES[g.key] || g.key, g.from + ' → ' + g.to + ' pt'));
      else if (!p.globalsSkipped.length) row('ระยะรวม A–D', 'ไม่ต้องปรับ');
      p.globalsSkipped.forEach(g => row(GAP_NAMES[g.key] || g.key, g.from + ' pt · ปรับเองไว้ (ล็อก)'));
      total += p.globals.length;
    }
    if (cf.marks) { row('ตำแหน่งสระ/วรรณยุกต์', c.anchors ? el('span', null, 'ปรับ ', el('b', null, String(c.anchors)), ' ตัว') : 'ไม่ต้องปรับ'); total += c.anchors; }
    if (p.before && p.after) {
      const b = AT().gridCounts(p.before), a = AT().gridCounts(p.after);
      const bp = b.near + b.collide, ap = a.near + a.collide;
      row('ตรวจสระ/วรรณยุกต์ (ชิด/ชน)', bp + ' → ' + ap + ' ตัว', ap < bp ? 'good' : ap > bp ? 'bad' : '');
    }
    if (c.skipped) row('ข้ามตัวที่คุณปรับเองไว้', c.skipped + ' รายการ (ล็อก)');
    $('btnAuApply').disabled = total === 0;
    // ก่อน/หลัง
    const cmp = $('auCmp'); cmp.innerHTML = '';
    AU_WORDS.forEach(w => {
      cmp.appendChild(el('div', { class: 'lab' }, 'ก่อน'));
      cmp.appendChild(el('div', { class: 'txt before' }, w));
      cmp.appendChild(el('div', { class: 'lab new' }, 'หลัง'));
      cmp.appendChild(el('div', { class: 'txt after' }, w));
    });
    // กลุ่มรูปทรง
    const all = p.spacing.concat(p.spacingSkipped);
    $('auShapeSec').classList.toggle('hidden', !all.length || !cf.spacing);
    ['flat', 'soft', 'deep'].forEach(k => {
      const mem = []; all.forEach(e => { if ((e.clsL === k || e.clsR === k) && mem.indexOf(e.def.char) < 0) mem.push(e.def.char); });
      AU.shapeCtl[k].textContent = mem.length ? mem.slice(0, 40).join(' ') + (mem.length > 40 ? ' …' : '') : '—';
    });
    // ช่องไฟที่จะเปลี่ยน
    const chg = p.spacing.filter(e => e.dl !== e.curL || e.dr !== e.curR).sort((a, b) => (Math.abs(b.dl - b.curL) + Math.abs(b.dr - b.curR)) - (Math.abs(a.dl - a.curL) + Math.abs(a.dr - a.curR)));
    $('auSpCount').textContent = chg.length ? chg.length + ' ตัว' : '';
    const chips = $('auSpChips'); chips.innerHTML = '';
    if (!chg.length) chips.appendChild(el('span', { class: 'note' }, 'ไม่มี'));
    chg.slice(0, 16).forEach(e => chips.appendChild(el('button', {
      class: 'chip', title: e.def.name + ' — ซ้าย ' + e.newL + ' (ปรับ ' + pt(e.dl) + ') · ขวา ' + e.newR + ' (ปรับ ' + pt(e.dr) + ')',
      onclick: () => { A.selectGlyph(e.def); A.setTab('spacing'); }
    }, e.def.char + ' ' + pt(e.dl) + '/' + pt(e.dr))));
    if (chg.length > 16) chips.appendChild(el('span', { class: 'note' }, '+' + (chg.length - 16) + ' ตัว'));
  }

  function renderAuGrid(sc, nMark) {
    const grid = $('auGrid'); grid.innerHTML = '';
    const g = AU.prop && AU.prop.after ? AU.prop.after : null;
    $('auGridTitle').textContent = g ? 'ตารางตรวจ (หลังจูน)' : 'ตารางตรวจสระ/วรรณยุกต์';
    const detail = $('auDetail');
    if (!nMark) {
      detail.classList.add('hidden'); $('auGridCount').textContent = '';
      grid.appendChild(el('div', { class: 'tip', style: 'grid-column:1/-1' }, 'ยังไม่ได้วาดสระ/วรรณยุกต์ — ตารางตรวจจะทำงานเมื่อวาดอย่างน้อยหนึ่งตัว'));
      return;
    }
    let cur = g;
    if (!cur) {
      const key = AU.sceneKey + settingsKey() + auCfg().minClear;
      if (!AU.grid || AU.gridKey !== key) { AU.grid = AT().gridOf(sc, S(), CONS, auCfg().minClear); AU.gridKey = key; }
      cur = AU.grid;
    }
    const cnt = AT().gridCounts(cur);
    $('auGridCount').textContent = 'ผ่าน ' + cnt.ok + ' · ชิด ' + cnt.near + ' · ชน ' + cnt.collide;
    CONS.forEach(def => {
      const ev = cur[def.code];
      const cls = ev ? (ev.worst === 'through' ? 'ok' : ev.worst) : 'none';
      const lock = AT().isManualAnchor(S(), def.code);
      const b = el('button', { class: 'au-cell ' + cls + (lock ? ' lock' : '') + (AU.sel === def.code ? ' on' : ''), title: def.name + (lock ? ' · ปรับเองไว้ (ล็อก)' : ''),
        onclick: () => { if (!ev) return; AU.sel = def.code; renderAuto(); } }, def.char);
      grid.appendChild(b);
    });
    renderAuDetail(cur);
  }

  function renderAuDetail(cur) {
    const box = $('auDetail'), code = AU.sel, ev = code && cur[code];
    box.classList.toggle('hidden', !ev);
    if (!ev) return;
    const def = GD.BY_CODE[code]; box.innerHTML = '';
    box.appendChild(el('div', { class: 't' }, el('span', null, def.char + '  ' + def.name), el('span', { class: 'spacer' }),
      el('span', { class: 'dim num', style: 'font-weight:400' }, 'ใกล้สุด ' + (ev.minDist >= window.AutoMarks.CUT ? '—' : ev.minDist.toFixed(1) + ' pt'))));
    const items = el('div', { class: 'au-items' });
    ev.items.slice().sort((a, b) => (window.AutoMarks.RANK[b.status] - window.AutoMarks.RANK[a.status]) || (a.dist - b.dist)).forEach(it => {
      items.appendChild(el('span', { class: 'au-it ' + it.status, title: it.status === 'collide' ? 'ชนกัน' : it.status === 'near' ? 'ชิดเกินไป' : it.status === 'through' ? 'ทะลุหางสูงตามที่ตั้งไว้' : 'ผ่าน' },
        '◌' + it.label, el('small', null, it.dist >= window.AutoMarks.CUT ? (it.status === 'through' ? 'ทะลุ' : '—') : it.dist.toFixed(0))));
    });
    box.appendChild(items);
    if (AU.prop) { box.appendChild(el('p', { class: 'note' }, 'นี่คือผลหลังจูน (ยังไม่ได้ใช้) — กด "ใช้ทั้งหมด" ก่อนจึงปรับเฉพาะตัวได้')); return; }
    const lowCode = window.AutoMarks.VARIANT[code] || code;
    const get = (c, k) => ((S().anchors[c] || {})[k]) || 0;
    const set = (c, k, v) => {
      const o = S().anchors[c] || {}; o[k] = v;
      if (!Object.keys(o).some(x => o[x])) delete S().anchors[c]; else S().anchors[c] = o;
      changed('quiet'); schedAuGrid();
    };
    const grid = el('div', { class: 'scrub-grid' });
    grid.appendChild(scrub({ label: 'สระบน ←→', value: get(code, 'tx'), min: -200, max: 200, unit: 'pt', base: 0, onInput: v => set(code, 'tx', v) }).el);
    grid.appendChild(scrub({ label: 'สระบน ↑↓', value: get(code, 'ty'), min: -200, max: 200, unit: 'pt', base: 0, onInput: v => set(code, 'ty', v) }).el);
    grid.appendChild(scrub({ label: 'สระล่าง ←→', value: get(lowCode, 'bx'), min: -200, max: 200, unit: 'pt', base: 0, onInput: v => set(lowCode, 'bx', v) }).el);
    grid.appendChild(scrub({ label: 'สระล่าง ↑↓', value: get(lowCode, 'by'), min: -200, max: 200, unit: 'pt', base: 0, onInput: v => set(lowCode, 'by', v) }).el);
    box.appendChild(grid);
    const r = el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { class: 'btn', onclick: () => { A.selectGlyph(def); A.setTab('marks'); } }, 'ดูในแท็บสระ/วรรณยุกต์'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn quiet', onclick: () => { delete S().anchors[code]; delete S().anchors[lowCode]; changed('quiet'); AU.grid = null; renderAuto(); } }, 'คืนค่าตัวนี้'));
    box.appendChild(r);
    if (AT().isManualAnchor(S(), code) || AT().isManualAnchor(S(), lowCode)) box.appendChild(el('p', { class: 'note' }, 'ตัวนี้คุณปรับเองไว้ — การจูนอัตโนมัติจะข้ามไป (เว้นแต่เลือกเขียนทับ)'));
  }
  const schedAuGrid = debounce(() => { AU.grid = null; if (state.tab === 'auto') renderAuto(); }, 150);

  function wire() {
    auScopeCtl = bindSeg($('auScope'), 'data-v', 'thai', v => { auCfg().scope = v; saveSettings(); reanalyze(); });
    auStyleCtl = bindSeg($('auStyle'), 'data-v', 'normal', v => {
      Object.assign(auCfg(), AU_STYLES[v]); saveSettings(); bindAutoUI(); reanalyze();
    });
    $('btnAuAnalyze').onclick = auAnalyze;
    $('btnAuApply').onclick = auApply;
    $('btnAuCancel').onclick = () => { AU.prop = null; renderAuto(); };
    $('btnAuUndo').onclick = auUndo;
  }

  A.tabs.auto = { render: renderAuto, bind: bindAutoUI, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-auto': '2.0.0-2e84cd1e' });
