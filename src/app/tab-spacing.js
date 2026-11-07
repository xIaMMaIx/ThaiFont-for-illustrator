/**
 * แท็บ ช่องไฟ — ความแน่น/ช่องไฟพื้นฐาน, เวทีลากช่องไฟซ้าย/ขวา, ปรับแนวตั้ง/หาง, รายการที่ปรับเอง, Kerning
 */
(function () {
  'use strict';
  const { $, el, scrub, seg, bindSeg, toast, svgEl } = window.UI;
  const GD = window.GlyphData;
  const PS = window.ProjectSettings;
  const OL = window.Outline;
  const A = window.TFSApp;
  const { state, S, isDrawn, outlinesOf, measureOf, displayChar, pt, cutPreview, customOf, contoursForDef, saveSettings, changed, schedulePreview } = A;

  let densityCtl, kernScopeCtl, fxScopeCtl, fxStyleCtl, altScopeCtl, altStepsCtl;
  let fxUndo = null;     // glyphBaseline ก่อนสุ่ม/ล้างครั้งล่าสุด

  function ctxOptions(def) {
    if (!def) return [];
    if (def.group === 'latin-upper') return ['H', 'O', 'HO'];
    if (def.group === 'latin-lower') return ['n', 'o', 'no'];
    if (def.group === 'digit' && def.code < 'U+0E00') return ['0', '1'];
    if (def.group === 'punct') return ['n', 'H'];
    if (def.group === 'math') return ['1', 'H'];
    return ['น', 'อ', 'นอ'];
  }

  function renderSpacing() {
    const def = state.active;
    $('sbTitle').textContent = def.char !== def.name ? def.name : def.code;
    $('sbBadge').textContent = displayChar(def);
    const m = measureOf(def);
    const empty = $('sbEmpty');
    const opts = ctxOptions(def);
    if (opts.indexOf(state.ctx) < 0 && state.ctx !== '—') state.ctx = opts[0];
    if (GD.isMark(def) || def.kind === 'auto' || !m) {
      $('sbBody').classList.add('hidden'); empty.classList.remove('hidden');
      empty.textContent = GD.isMark(def) ? 'สระบน/ล่างและวรรณยุกต์ไม่มีช่องไฟ (กว้าง 0) — ปรับตำแหน่งได้ที่แท็บ สระ/วรรณยุกต์'
        : def.kind === 'auto' ? 'สระอำใช้ช่องไฟของสระอา (า)' : 'ยังไม่ได้วาดตัวนี้ — วาดใน Illustrator แล้วช่องไฟจะคำนวณให้อัตโนมัติ';
      $('btnSbReset').classList.add('hidden');
      $('sbState').textContent = '—'; $('sbState').classList.remove('on');
    } else {
      $('sbBody').classList.remove('hidden'); empty.classList.add('hidden');
      const adj = PS.adjustOf(S(), def.code);
      const cu = customOf(def);
      const lift = PS.baselineOf(S(), def.code);
      const nAdj = (cu.manualSp ? 1 : 0) + (adj.dy ? 1 : 0) + (adj.tail !== PS.defaultTail(def.code) ? 1 : 0) + (lift ? 1 : 0);
      $('btnSbReset').classList.toggle('hidden', !nAdj && !cu.autoSp);
      $('sbState').textContent = nAdj ? 'ปรับแล้ว ' + nAdj + ' รายการ' : cu.autoSp ? 'จูนแล้ว' : 'อัตโนมัติ';
      $('sbState').classList.toggle('on', nAdj > 0);
      $('sbState').classList.toggle('auto', !nAdj && cu.autoSp);
      $('sbState').title = !nAdj && cu.autoSp ? 'ค่านี้ระบบใส่ให้จากแท็บ จูนอัตโนมัติ (ยังไม่ได้ปรับเอง)' : '';
      renderVAdj(def, m, adj);
      $('blTotal').innerHTML = pt(lift) + '<small>pt</small>';
      if (document.activeElement !== $('blIn')) $('blIn').value = pt(lift);
      $('sbLTotal').innerHTML = Math.round(m.lsb) + '<small>pt</small>';
      $('sbRTotal').innerHTML = Math.round(m.rsb) + '<small>pt</small>';
      $('sbLCalc').textContent = 'อัตโนมัติ ' + m.autoL + '  ' + (m.dl < 0 ? '−' : '+') + ' ปรับ ' + Math.abs(m.dl);
      $('sbRCalc').textContent = 'อัตโนมัติ ' + m.autoR + '  ' + (m.dr < 0 ? '−' : '+') + ' ปรับ ' + Math.abs(m.dr);
      if (document.activeElement !== $('sbL')) $('sbL').value = pt(m.dl);
      if (document.activeElement !== $('sbR')) $('sbR').value = pt(m.dr);
      $('sbAdv').textContent = Math.round(m.advance);
      drawStage(def, m);
    }
    // context chips
    const chips = $('sbCtx'); chips.innerHTML = '';
    opts.concat(['—']).forEach(o => chips.appendChild(el('button', {
      class: 'chip' + (state.ctx === o ? ' on' : ''), title: o === '—' ? 'ดูตัวเดียว' : 'วางระหว่างตัว ' + o,
      onclick: () => { state.ctx = o; renderSpacing(); }
    }, o === '—' ? 'ตัวเดียว' : o.split('').join(displayChar(def)).replace(/^(.)$/, '$1' + displayChar(def) + '$1'))));
    renderOverrides();
    renderKerning();
    const nFx = Object.keys(S().glyphBaseline || {}).length;
    $('fxCount').textContent = nFx ? 'ยกเส้นฐาน ' + nFx + ' ตัว' : '';
    $('btnFxUndo').classList.toggle('hidden', !fxUndo);
  }

  function setAdjust(code, patch) {
    if (!S().glyphAdjust) S().glyphAdjust = {};
    const ga = S().glyphAdjust;
    const cur = Object.assign(PS.adjustOf(S(), code), patch);
    const e = { dy: Math.round(Number(cur.dy) || 0) };
    if (!!cur.tail !== PS.defaultTail(code)) e.tail = !!cur.tail;      // เก็บเฉพาะที่ต่างจากค่าเริ่มต้น
    if (!e.dy && e.tail === undefined) delete ga[code]; else ga[code] = e;
  }
  /** ส่วน "แนวตั้ง / หาง" ในการ์ดปรับเฉพาะตัว */
  function renderVAdj(def, m, adj) {
    $('vdTotal').innerHTML = pt(adj.dy) + '<small>pt</small>';
    if (document.activeElement !== $('vdIn')) $('vdIn').value = pt(adj.dy);
    $('tailChk').checked = adj.tail;
    const c = S().canvas, below = c.baseline - m.bbox.yMin, guide = c.baseline - c.descender;
    const info = $('vInfo');
    if (below > 0.5) {
      const deep = below > guide + 0.5;
      info.className = 'vinfo' + (deep ? ' warn' : '');
      info.textContent = 'หมึกลงใต้เส้นฐาน ' + Math.round(below) + ' pt' + (deep ? ' — ลึกกว่าเส้น Descender อยู่ ' + Math.round(below - guide) + ' pt (ระยะบรรทัดจะถ่างตาม ถ้าใช้โหมดอัตโนมัติ)' : ' (ในกรอบ Descender)') + (adj.tail && PS.defaultTail(def.code) ? ' · ไม่นับหางเป็นค่าเริ่มต้นของตัวนี้' : '');
    } else if (m.bbox.yMin - c.baseline > 0.5) {
      info.className = 'vinfo'; info.textContent = 'ตัวลอยเหนือเส้นฐาน ' + Math.round(m.bbox.yMin - c.baseline) + ' pt';
    } else { info.className = 'vinfo'; info.textContent = 'ตัวนั่งบนเส้นฐานพอดี'; }
  }

  /** เวทีแสดงช่องไฟ: [บริบท][ตัวที่เลือก][บริบท] + แถบซ้าย/ขวาที่ลากได้ */
  function drawStage(def, m) {
    const svg = $('sbSvg'); svg.innerHTML = '';
    const c = S().canvas;
    const ctx = state.ctx === '—' ? [] : state.ctx.split('');
    const seq = ctx.length === 1 ? [ctx[0], null, ctx[0]] : ctx.length === 2 ? [ctx[0], null, ctx[1]] : [null];
    const lift = PS.baselineOf(S(), def.code);
    let x = 0; const bottom = Math.min(c.descender - 10, (m.bbox ? m.bbox.yMin : 0) + lift - 30);
    const top = Math.max(c.ascender + 50, (m.bbox ? m.bbox.yMax : 0) + lift + 30);
    const g = svgEl('g');
    let target = null;
    seq.forEach(ch => {
      if (ch === null) {
        target = { x, m };
        const t = svgEl('g', { transform: 'translate(' + (x - m.originX) + ',' + (-lift) + ')' });
        const paths = isDrawn(def.code) ? outlinesOf(def.code) : (def.isCutVariant ? cutPreview(def) : []);
        t.innerHTML = OL.rawToSvg(paths, c.em);
        t.setAttribute('style', 'color:var(--glyph)');
        if (m.bbox) {
          // พื้นที่จับสำหรับลากขึ้น/ลง (ปรับแนวตั้ง)
          const hit = svgEl('rect', { x: m.bbox.xMin, y: c.em - m.bbox.yMax, width: Math.max(10, m.bbox.xMax - m.bbox.xMin), height: Math.max(10, m.bbox.height), fill: 'transparent', style: 'cursor:ns-resize' });
          hit.addEventListener('pointerdown', e => startDragY(e, svg));
          t.appendChild(hit);
        }
        g.appendChild(t);
        x += m.advance;
        return;
      }
      const cd = GD.findByChar(ch);
      const cm = cd ? measureOf(cd) : null;
      if (cm) {
        const t = svgEl('g', { transform: 'translate(' + (x - cm.originX) + ',' + (-PS.baselineOf(S(), cd.code)) + ')', opacity: '0.45' });
        t.innerHTML = OL.rawToSvg(outlinesOf(cd.code), c.em);
        g.appendChild(t);
        x += cm.advance;
      } else {
        const w = (c.cap - c.baseline) * 0.8;
        g.appendChild(svgEl('rect', { x: x + 20, y: c.em - c.cap, width: w, height: c.cap - c.baseline, fill: 'none', stroke: 'currentColor', 'stroke-dasharray': '6 6', opacity: '0.3' }));
        const tx = svgEl('text', { x: x + 20 + w / 2, y: c.em - c.baseline - 40, 'text-anchor': 'middle', 'font-size': 160, fill: 'currentColor', opacity: '0.25' });
        tx.textContent = ch; g.appendChild(tx);
        x += w + 40;
      }
    });
    const W = Math.max(x, 1);
    svg.setAttribute('viewBox', (-30) + ' ' + (c.em - top) + ' ' + (W + 60) + ' ' + (top - bottom));
    // เส้นฐาน & Cap
    [[c.baseline, 'var(--done)'], [c.cap, 'var(--mark)'], [c.descender, 'var(--mark)', '10 8']].forEach(([y, col, dash]) => {
      const ln = svgEl('line', { x1: -30, x2: W + 30, y1: c.em - y, y2: c.em - y, stroke: col, 'stroke-width': 2, opacity: 0.5 });
      if (dash) ln.setAttribute('stroke-dasharray', dash);
      svg.appendChild(ln);
    });
    if (target && lift) svg.appendChild(svgEl('line', { x1: target.x, x2: target.x + m.advance, y1: c.em - c.baseline - lift, y2: c.em - c.baseline - lift, stroke: 'var(--done)', 'stroke-width': 4, 'stroke-dasharray': '12 8' }));
    if (target) {
      const tm = target.m, x0 = target.x, inkL = x0 + (tm.xMin - tm.originX), inkR = x0 + (tm.xMax - tm.originX), x1 = x0 + tm.advance;
      const yT = c.em - top, h = top - bottom;
      svg.appendChild(svgEl('rect', { x: Math.min(x0, inkL), y: yT, width: Math.abs(inkL - x0), height: h, fill: 'var(--lsb)', opacity: 0.22 }));
      svg.appendChild(svgEl('rect', { x: Math.min(inkR, x1), y: yT, width: Math.abs(x1 - inkR), height: h, fill: 'var(--rsb)', opacity: 0.22 }));
      svg.appendChild(g);
      const handle = (hx, col, side) => {
        const hg = svgEl('g', { style: 'cursor:ew-resize' });
        hg.appendChild(svgEl('line', { x1: hx, x2: hx, y1: yT, y2: yT + h, stroke: col, 'stroke-width': 3 }));
        hg.appendChild(svgEl('rect', { x: hx - 14, y: yT + h / 2 - 40, width: 28, height: 80, rx: 8, fill: col }));
        hg.appendChild(svgEl('rect', { x: hx - 40, y: yT, width: 80, height: h, fill: 'transparent' }));
        hg.addEventListener('pointerdown', e => startDrag(e, side, svg));
        svg.appendChild(hg);
      };
      handle(x0, 'var(--lsb)', 'l');
      handle(x1, 'var(--rsb)', 'r');
      const lab = (tx, txt, col) => { const t = svgEl('text', { x: tx, y: c.em - bottom - 14, 'text-anchor': 'middle', 'font-size': 44, fill: col, 'font-weight': 600 }); t.textContent = txt; svg.appendChild(t); };
      lab((x0 + inkL) / 2, Math.round(tm.lsb), 'var(--lsb)');
      lab((inkR + x1) / 2, Math.round(tm.rsb), 'var(--rsb)');
    } else svg.appendChild(g);
  }

  function setDelta(code, side, v) {
    const gs = S().glyphSpacing;
    const cur = gs[code] || { l: 0, r: 0 };
    cur[side] = Math.round(v);
    if (!cur.l && !cur.r) delete gs[code]; else gs[code] = cur;
  }

  function startDragY(e, svg) {
    e.preventDefault();
    const def = state.active, code = def.code;
    const ctm = svg.getScreenCTM().inverse();
    const toY = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(ctm).y; };
    const sy = toY(e), start = PS.adjustOf(S(), code).dy;
    const move = ev => {
      let v = start - (toY(ev) - sy);
      v = ev.shiftKey ? Math.round(v / 10) * 10 : Math.round(v);
      setAdjust(code, { dy: v });
      renderSpacing(); schedulePreview();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveSettings(); A.refreshTab(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  function startDrag(e, side, svg) {
    e.preventDefault();
    const def = state.active;
    const m0 = measureOf(def); if (!m0) return;
    const ctm = svg.getScreenCTM().inverse();
    const toX = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(ctm).x; };
    const sx = toX(e), start = side === 'l' ? m0.dl : m0.dr;
    const move = ev => {
      const d = toX(ev) - sx;
      let v = side === 'l' ? start - d : start + d;
      v = ev.shiftKey ? Math.round(v / 10) * 10 : Math.round(v);
      setDelta(def.code, side, v);
      renderSpacing();
      schedulePreview();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveSettings(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }

  function renderOverrides() {
    const list = $('ovList'); list.innerHTML = '';
    const gs = S().glyphSpacing, ga = S().glyphAdjust || {};
    // แสดงเฉพาะที่ผู้ใช้ปรับเอง — ค่าที่ระบบใส่ให้จากจูนอัตโนมัติไม่ปนมาที่นี่
    const seen = {}; let nAuto = 0;
    const codes = Object.keys(gs).concat(Object.keys(ga), Object.keys(S().anchors)).filter(k => GD.BY_CODE[k] && !seen[k] && (seen[k] = 1)).filter(k => {
      const cu = customOf(GD.BY_CODE[k]);
      if (cu.manualSp || cu.manualAn || cu.adj) return true;
      if (cu.autoSp || cu.autoAn) nAuto++;
      return false;
    });
    $('ovCount').textContent = codes.length ? codes.length + ' ตัว' : '';
    const note = $('ovAutoNote'); note.innerHTML = '';
    if (nAuto) note.appendChild(el('span', null, 'ค่าจากจูนอัตโนมัติอีก ' + nAuto + ' ตัว (ไม่แสดงในรายการนี้) '), el('button', { class: 'btn quiet', onclick: () => A.setTab('auto') }, 'ดูในแท็บจูนอัตโนมัติ'));
    if (!codes.length) { list.appendChild(el('div', { class: 'empty-li' }, 'ยังไม่มีตัวที่คุณปรับเอง')); return; }
    codes.forEach(code => {
      const d = GD.BY_CODE[code], cu = customOf(d), v = cu.manualSp ? gs[code] : null, a = ga[code];
      const parts = [];
      if (cu.manualAn) parts.push(el('span', { style: 'color:var(--mark)' }, 'ตำแหน่งสระ'), '  ');
      if (v) parts.push(el('span', { style: 'color:var(--lsb)' }, 'ซ้าย ' + pt(v.l || 0)), ' ', el('span', { style: 'color:var(--rsb)' }, 'ขวา ' + pt(v.r || 0)), '  ');
      if (a && a.dy) parts.push(el('span', { style: 'color:var(--done)' }, 'ยก ' + pt(a.dy)), '  ');
      if (a && typeof a.tail === 'boolean' && a.tail !== PS.defaultTail(code)) parts.push(el('span', { style: 'color:var(--mark)' }, a.tail ? 'ไม่นับหาง' : 'นับหาง'));
      list.appendChild(el('div', { class: 'li' },
        el('button', { class: 'btn quiet', style: 'font-size:18px;min-width:34px', onclick: () => { A.selectGlyph(d); } }, displayChar(d)),
        el('span', { class: 'grow dim num' }, parts),
        el('button', { class: 'btn quiet icon', title: 'คืนค่าอัตโนมัติ', onclick: () => { if (cu.manualSp) delete gs[code]; if (S().glyphAdjust) delete S().glyphAdjust[code]; if (cu.manualAn) delete S().anchors[code]; changed(); } }, '×')));
    });
  }

  function kernKey(a, b) { return a.code + '|' + b.code; }
  function renderKerning() {
    const list = $('kernList'); list.innerHTML = '';
    const pairs = S().kerning.pairs; const keys = Object.keys(pairs);
    if (!keys.length) { list.appendChild(el('div', { class: 'empty-li' }, 'ยังไม่มีคู่ที่ปรับเอง')); }
    keys.forEach(k => {
      const [a, b] = k.split('|').map(c => GD.BY_CODE[c]);
      if (!a || !b) return;
      const sc = scrub({ label: 'ระยะ', value: pairs[k], min: -400, max: 400, unit: 'pt', base: 0, onInput: v => { pairs[k] = v; changed('quiet'); } });
      list.appendChild(el('div', { class: 'li' }, el('span', { class: 'pairtxt' }, a.char + b.char), el('div', { class: 'grow' }, sc.el),
        el('button', { class: 'btn quiet icon', title: 'ลบคู่นี้', onclick: () => { delete pairs[k]; changed(); } }, '×')));
    });
  }

  function addKernPair() {
    const chars = Array.from($('kernInput').value.trim());
    if (chars.length < 2) { toast('พิมพ์ตัวอักษร 2 ตัว เช่น AV', { error: true }); return; }
    const a = GD.findByChar(chars[0]), b = GD.findByChar(chars[1]);
    if (!a || !b || GD.isMark(a) || GD.isMark(b)) { toast('ใช้ได้เฉพาะตัวที่มีความกว้าง (ไม่ใช่สระบน/ล่างหรือวรรณยุกต์)', { error: true }); return; }
    const k = kernKey(a, b);
    if (S().kerning.pairs[k] == null) {
      const ma = measureOf(a), mb = measureOf(b);
      let auto = ma && mb ? window.Spacing.autoKern(ma, mb, S()) : 0;
      if (window.LatinKern && ma && mb && /^latin|^digit/.test(a.group || '') && /^latin|^digit/.test(b.group || '')) {
        try {
          const recs = GD.ALL_GLYPHS.filter(d => /^latin-(upper|lower)$|^digit$/.test(d.group || '')).map(d => { const c = contoursForDef(d), m = c && measureOf(d); return c && m ? { def: d, code: d.code, contours: c, m } : null; }).filter(Boolean);
          const kk = window.LatinKern.compute(recs, S(), { auto: true });
          auto = kk[a.code + '|' + b.code] || 0;
        } catch (eK) { console.warn('[TFS] LatinKern failed, using simple auto-kern', eK); }
      }
      S().kerning.pairs[k] = auto || -10;
    }
    $('kernInput').value = '';
    changed();
  }

  function bind() {
    const s = S();
    densityCtl.set(s.spacing.density);
    const mount = (id, ctl) => { $(id).innerHTML = ''; $(id).appendChild(ctl.el); };
    mount('scrubBase', scrub({ label: 'ช่องไฟพื้นฐาน', value: s.spacing.base, min: 0, max: 200, unit: 'pt', base: 40, onInput: v => { s.spacing.base = v; changed(); } }));
    mount('scrubRound', scrub({ label: 'ผลของขอบโค้ง', value: s.spacing.roundness, min: 0, max: 1, step: 0.05, base: 0.35, title: 'มาก = ตัวที่ขอบโค้ง/เฉียงได้ช่องไฟน้อยลงมาก', onInput: v => { s.spacing.roundness = v; changed(); } }));
    $('kernAuto').checked = !!s.kerning.auto; $('kernAuto').onchange = () => { s.kerning.auto = $('kernAuto').checked; changed('quiet'); };
    kernScopeCtl.set(s.kerning.scope || 'latin');
    fxUndo = null;
    fxScopeCtl.set(s.baselineFx.scope); fxStyleCtl.set(s.baselineFx.style);
    mount('scrubFxAmount', scrub({ label: 'ความสูงต่าง', value: s.baselineFx.amount, min: 0, max: 150, unit: 'pt', base: 30, title: 'ยกขึ้น/กดลงจากเส้นฐานสูงสุดกี่ pt · กดสุ่มความสูงเพื่อใช้ค่า', onInput: v => { s.baselineFx.amount = v; saveSettings(); } }));
    $('altOn').checked = !!s.baselineAlt.on; $('altBody').classList.toggle('hidden', !s.baselineAlt.on);
    altScopeCtl.set(s.baselineAlt.scope); altStepsCtl.set(s.baselineAlt.steps);
    mount('scrubAltAmount', scrub({ label: 'ความสูงต่าง', value: s.baselineAlt.amount, min: 1, max: 150, unit: 'pt', base: 30, title: 'รูปสลับยกขึ้น/กดลงจากรูปปกติกี่ pt', onInput: v => { s.baselineAlt.amount = v; changed('quiet'); } }));
    mount('scrubKernStrength', scrub({ label: 'ความแรง', value: s.kerning.strength, min: 0.2, max: 2, step: 0.1, base: 1, onInput: v => { s.kerning.strength = v; changed('quiet'); } }));
    mount('scrubKernTuck', scrub({ label: 'ชิดใต้แขน', value: s.kerning.tuck != null ? s.kerning.tuck : 0.65, min: 0.1, max: 1.5, step: 0.05, base: 0.65, onInput: v => { s.kerning.tuck = v; changed('quiet'); }, title: 'ลากซ้าย-ขวา · ดับเบิลคลิกคืนค่า' }));
    mount('scrubKernDepth', scrub({ label: 'ลึกสุด', value: s.kerning.depth != null ? s.kerning.depth : 1, min: 0.2, max: 3, step: 0.1, base: 1, onInput: v => { s.kerning.depth = v; changed('quiet'); }, title: 'ช่องเปิดใต้แขนนับเป็นพื้นที่ว่างได้ลึกกี่เท่าของความหนาเส้น' }));
  }

  function wire() {
    densityCtl = seg($('densitySeg'), PS.DENSITY.map(d => ({ v: d.v, label: d.label })), S().spacing.density, v => { S().spacing.density = Number(v); changed(); });
    $('btnSbReset').onclick = () => { delete S().glyphSpacing[state.active.code]; if (S().glyphAdjust) delete S().glyphAdjust[state.active.code]; PS.setBaseline(S(), state.active.code, 0); changed(); };
    const nudgeBl = d => { const code = state.active.code; PS.setBaseline(S(), code, PS.baselineOf(S(), code) + d); changed(); };
    document.querySelectorAll('.vstep .btn[data-bl]').forEach(b => b.addEventListener('click', e => nudgeBl(Number(b.getAttribute('data-bl')) * (e.shiftKey ? 10 : 1))));
    $('blIn').addEventListener('change', () => { const v = parseInt($('blIn').value.replace('−', '-'), 10); if (!isNaN(v)) { PS.setBaseline(S(), state.active.code, v); $('blIn').blur(); changed(); } });
    $('blIn').addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); nudgeBl((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    });
    fxScopeCtl = bindSeg($('fxScope'), 'data-v', 'thai', v => { S().baselineFx.scope = v; saveSettings(); });
    fxStyleCtl = bindSeg($('fxStyle'), 'data-v', 'two', v => { S().baselineFx.style = v; saveSettings(); });
    $('altOn').addEventListener('change', () => { S().baselineAlt.on = $('altOn').checked; $('altBody').classList.toggle('hidden', !S().baselineAlt.on); changed('quiet'); });
    altScopeCtl = bindSeg($('altScope'), 'data-v', 'thai', v => { S().baselineAlt.scope = v; changed('quiet'); });
    altStepsCtl = bindSeg($('altSteps'), 'data-v', '2', v => { S().baselineAlt.steps = Number(v); changed('quiet'); });
    $('btnFxApply').onclick = () => {
      const s = S(), fx = s.baselineFx;
      fxUndo = Object.assign({}, s.glyphBaseline);
      fx.seed = (Number(fx.seed) || 0) + 1;
      const codes = PS.baselineTargets(fx.scope);
      codes.forEach(code => PS.setBaseline(s, code, 0));
      const vals = PS.baselineBounce(codes, fx);
      Object.keys(vals).forEach(code => PS.setBaseline(s, code, vals[code]));
      changed();
    };
    $('btnFxUndo').onclick = () => { if (fxUndo) { S().glyphBaseline = fxUndo; fxUndo = null; changed(); } };
    $('btnFxClear').onclick = () => { fxUndo = Object.assign({}, S().glyphBaseline); S().glyphBaseline = {}; changed(); };
    document.querySelectorAll('.vstep .btn[data-vd]').forEach(b => b.addEventListener('click', e => {
      const d = Number(b.getAttribute('data-vd')) * (e.shiftKey ? 10 : 1), code = state.active.code;
      setAdjust(code, { dy: PS.adjustOf(S(), code).dy + d }); changed();
    }));
    $('vdIn').addEventListener('change', () => { const v = parseInt($('vdIn').value.replace('−', '-'), 10); if (!isNaN(v)) { setAdjust(state.active.code, { dy: v }); $('vdIn').blur(); changed(); } });
    $('vdIn').addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); const code = state.active.code;
      setAdjust(code, { dy: PS.adjustOf(S(), code).dy + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) }); changed();
    });
    $('tailChk').addEventListener('change', () => { setAdjust(state.active.code, { tail: $('tailChk').checked }); changed(); });
    document.querySelectorAll('.stepper .btn').forEach(b => b.addEventListener('click', e => {
      const side = b.getAttribute('data-side'), d = Number(b.getAttribute('data-d')) * (e.shiftKey ? 10 : 1);
      const m = measureOf(state.active); if (!m) return;
      setDelta(state.active.code, side, (side === 'l' ? m.dl : m.dr) + d); changed();
    }));
    ['sbL', 'sbR'].forEach(id => {
      const inp = $(id), side = id === 'sbL' ? 'l' : 'r';
      inp.addEventListener('change', () => { const v = parseInt(inp.value.replace('−', '-'), 10); if (!isNaN(v)) { setDelta(state.active.code, side, v); inp.blur(); changed(); } });
      inp.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const m = measureOf(state.active); if (!m) return;
        setDelta(state.active.code, side, (side === 'l' ? m.dl : m.dr) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
        changed();
      });
    });
    $('btnKernAdd').onclick = addKernPair;
    $('kernInput').addEventListener('keydown', e => { if (e.key === 'Enter') addKernPair(); });
    kernScopeCtl = bindSeg($('kernScope'), 'data-v', 'latin', v => { S().kerning.scope = v; changed('quiet'); });
  }

  A.tabs.spacing = { render: renderSpacing, bind, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-spacing': '2.0.0-1b04fcfe' });
