/**
 * Thai Font Studio — panel controller (core)
 * state กลาง, ตัวช่วยวัด/วาดภาพย่อ, บันทึกค่า, ฟอนต์ทดลอง, โหลดโปรเจกต์, ซิงค์กับ Illustrator, สลับแท็บ
 *
 * แต่ละแท็บอยู่ไฟล์ของตัวเอง (src/app/tab-*.js) และลงทะเบียนที่ window.TFSApp.tabs[ชื่อแท็บ] = { render, bind, wire }
 * ไฟล์แท็บโหลดหลังไฟล์นี้ จึงหยิบตัวช่วยจาก TFSApp ได้ทันที ส่วนการเรียกข้ามแท็บให้เรียกผ่าน A.ชื่อฟังก์ชัน() ตอนใช้งาน
 */
(function () {
  'use strict';
  const { $, toast, debounce, svgEl } = window.UI;
  const GD = window.GlyphData;
  const PS = window.ProjectSettings;
  const OL = window.Outline;
  const A = window.TFSApp = window.TFSApp || {};
  A.tabs = A.tabs || {};
  A.ctl = A.ctl || {};          // ตัวควบคุมที่หลายแท็บใช้ร่วมกัน (เช่น A.ctl.set = ปุ่มเลือกชุดอักษร)

  // ===================================================================== state
  const state = {
    settings: PS.defaults(),
    outlines: {}, sigs: {}, warn: {},
    active: GD.THAI_GLYPHS[0],
    set: 'thai', filter: 'all', search: '',
    tab: 'draw', doc: null, docKey: '', ready: false, busy: false,
    report: null, lastSaved: '', ctx: null, specimen: 'stack'
  };
  const S = () => state.settings;
  const normCache = {};
  function clearNormCache() { Object.keys(normCache).forEach(k => delete normCache[k]); }

  /** localStorage ที่ไม่ throw (CEP บางเครื่องปิด storage) */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { console.warn('[TFS] localStorage', e.message); } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* storage ปิดอยู่ */ } }
  };

  // ================================================================ utilities
  const isDrawn = code => !!(state.outlines[code] && state.outlines[code].length);
  function hostWarn(code) { return state.warn[code] || {}; }
  function hasProblem(code) { const w = hostWarn(code); return !!(w.white || w.clip); }
  function statusOf(def) {
    if (def.kind === 'auto') return (isDrawn(def.code) || (isDrawn('U+0E4D') && isDrawn('U+0E32'))) ? 'auto' : 'missing';
    if (isDrawn(def.code)) return hasProblem(def.code) ? 'warn' : 'done';
    if (def.isCutVariant && isDrawn(def.baseCode)) return 'auto';
    return 'missing';
  }
  /** เส้นของตัวอักษร หลังใช้ค่าเลื่อนแนวตั้งต่อตัว (glyphAdjust.dy) */
  function outlinesOf(code) {
    const o = state.outlines[code]; if (!o) return o;
    const dy = PS.adjustOf(S(), code).dy;
    return dy ? PS.shiftPaths(o, dy) : o;
  }
  function norm(code) {
    if (!isDrawn(code)) return null;
    const dy = PS.adjustOf(S(), code).dy;
    const sig = (state.sigs[code] || JSON.stringify(state.outlines[code]).length) + '/' + dy;
    if (normCache[code] && normCache[code].sig === sig) return normCache[code].res;
    const res = OL.normalize(outlinesOf(code), { previewStrokes: true });
    const bb = res && res.contours.length ? OL.bbox(res.contours) : null;
    normCache[code] = { sig, res, yMin: bb ? bb.yMin : Infinity };
    return res;
  }
  function measureOf(def) {
    if (!def) return null;
    let n = norm(def.code);
    if (!n && def.isCutVariant && isDrawn(def.baseCode)) n = OL.normalize(cutPreview(def), { previewStrokes: true });
    if (!n || !n.contours.length) return null;
    return window.Spacing.measure(def, n.contours, S());
  }
  function displayChar(def) { return GD.isMark(def) ? '◌' + def.char : def.char; }
  function setGlyphs() { return GD.SETS[state.set].glyphs; }
  function pt(v) { return (v > 0 ? '+' : '') + Math.round(v); }

  /** SVG ย่อของตัวอักษร (ช่วงแนวตั้งคงที่ เพื่อให้ทุกตัวมีสเกลเดียวกันเหมือนตัวอย่างฟอนต์) */
  function cutPreview(def) {
    const cutY = S().canvas.baseline + 4;
    return (outlinesOf(def.baseCode) || []).filter(p => p.p.some(q => q[1] > cutY));
  }
  /** จุดต่ำสุดของหมึกทั้งโปรเจกต์ (ไม่รวมสระ/วรรณยุกต์) — ใช้ขยายหน้าต่างภาพย่อให้เห็นหางทั้งหมด
   *  คำนวณครั้งเดียวต่อการวาดหนึ่งรอบ (ตารางวาดภาพย่อหลายร้อยตัวติดกัน ข้อมูลไม่เปลี่ยนระหว่างนั้น) */
  let inkMemo = null;
  function lowestInk() {
    if (inkMemo !== null) return inkMemo;
    let lo = Infinity;
    Object.keys(state.outlines).forEach(code => {
      const d = GD.BY_CODE[code]; if (!d || GD.isMark(d) || !isDrawn(code)) return;
      norm(code); const e = normCache[code]; if (e && e.yMin < lo) lo = e.yMin;
    });
    inkMemo = lo;
    Promise.resolve().then(() => { inkMemo = null; });
    return lo;
  }
  function glyphSvg(code, cls, override, refs) {
    const paths = override || outlinesOf(code);
    if (!paths || !paths.length) return null;
    const c = S().canvas;
    const top = c.ascender + 70;
    const bottom = Math.max(c.descender - 300, Math.min(c.descender - 30, lowestInk() - 24));
    const h = top - bottom;
    const n = override ? OL.normalize(override) : norm(code); const bb = n && n.contours.length ? OL.bbox(n.contours) : null;
    const cx = bb ? (bb.xMin + bb.xMax) / 2 : c.em / 2;
    const w = Math.max(h, bb ? bb.width + 60 : h);
    let yTop = c.em - top;
    // สระ/วรรณยุกต์: วางกลางกรอบ (เพราะตำแหน่งที่วาดไม่สำคัญ ระบบจัดวางให้เอง)
    const def = GD.BY_CODE[code];
    if (bb && def && GD.isMark(def)) yTop = c.em - (bb.yMin + bb.yMax) / 2 - h / 2;
    const svg = svgEl('svg', { viewBox: (cx - w / 2) + ' ' + yTop + ' ' + w + ' ' + h, class: cls || '' });
    let guides = '';
    if (refs) {
      const x1 = (cx - w / 2).toFixed(0), x2 = (cx + w / 2).toFixed(0);
      guides = '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + (c.em - c.baseline) + '" y2="' + (c.em - c.baseline) + '" stroke="var(--done)" stroke-width="5" opacity=".55"/>' +
        '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + (c.em - c.descender) + '" y2="' + (c.em - c.descender) + '" stroke="var(--mark)" stroke-width="4" stroke-dasharray="14 10" opacity=".6"/>';
    }
    svg.innerHTML = guides + OL.rawToSvg(paths, c.em);
    return svg;
  }

  /** แยกค่าที่ "ผู้ใช้ปรับเอง" ออกจากค่าที่ "ระบบใส่ให้จากจูนอัตโนมัติ" */
  function customOf(def) {
    const c = def.code, s = S(), AT = window.AutoTune;
    const sp = s.glyphSpacing[c], hasSp = !!(sp && (sp.l || sp.r));
    const an = s.anchors[c], hasAn = !!(an && Object.keys(an).some(k => an[k]));
    const manualSp = hasSp && AT.isManualSpacing(s, c);
    const manualAn = hasAn && (GD.isMark(def) || AT.isManualAnchor(s, c));
    return { manualSp, manualAn, adj: !!(s.glyphAdjust && s.glyphAdjust[c] && (s.glyphAdjust[c].dy || (typeof s.glyphAdjust[c].tail === 'boolean' && s.glyphAdjust[c].tail !== PS.defaultTail(c)))), autoSp: hasSp && !manualSp, autoAn: hasAn && !manualAn };
  }
  /** ตัวนี้มีค่าที่ผู้ใช้ปรับเองเฉพาะตัวหรือไม่ (ไม่นับค่าจากจูนอัตโนมัติ) */
  function isCustomized(def) { const c = customOf(def); return c.manualSp || c.manualAn || c.adj; }

  /** เส้นที่ใช้วิเคราะห์ (ญ ฐ ตัดเชิง: ตัดจากตัวเต็มแบบเดียวกับตอนส่งออก) */
  function contoursForDef(def) {
    const n = norm(def.code);
    if (n && n.contours.length) return n.contours;
    if (def.isCutVariant && isDrawn(def.baseCode)) {
      const p = norm(def.baseCode); if (!p) return null;
      const cutY = S().canvas.baseline + 4;
      const r = p.contours.filter(c => { const b = OL.bbox([c]); return b && b.yMax > cutY; });
      return r.length && r.length < p.contours.length ? r : null;
    }
    return null;
  }

  // ============================================================ persistence
  function storageKey() { return 'TFS_settings_' + (state.docKey || 'default'); }
  const saveSettings = debounce(async () => {
    const str = JSON.stringify(S());
    if (str === state.lastSaved) return;
    store.set(storageKey(), str);
    if (!state.ready) return;
    try { await window.Host.call('saveSettings', str); state.lastSaved = str; }
    catch (e) { toast('บันทึกค่าลงไฟล์ .ai ไม่สำเร็จ: ' + e.message, { error: true }); }
  }, 1200);

  function changed(what) {
    saveSettings();
    schedulePreview();
    if (what !== 'quiet') refreshTab();
  }

  // ================================================================= preview
  // ฟอนต์ทดลองคอมไพล์ใหม่ทั้งชุด ยิ่งวาดเยอะยิ่งนาน → รอให้หยุดแก้นานขึ้นตามเวลาที่คอมไพล์ครั้งก่อนใช้จริง
  // (ไม่ให้คอมไพล์ถี่จนแผงและ Illustrator หน่วงตอนลาก slider) และไม่คอมไพล์ขณะ panel ถูกซ่อน
  let previewFace = null, previewBusy = false, previewAgain = false, previewHiddenPending = false, lastCompileMs = 0;
  const PREVIEW_MIN_WAIT = 350, PREVIEW_MAX_WAIT = 2000;
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    const wait = Math.max(PREVIEW_MIN_WAIT, Math.min(PREVIEW_MAX_WAIT, Math.round(lastCompileMs * 1.5)));
    previewTimer = setTimeout(buildPreview, wait);
  }
  schedulePreview.flush = () => { clearTimeout(previewTimer); buildPreview(); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && previewHiddenPending) { previewHiddenPending = false; schedulePreview.flush(); }
  });
  async function buildPreview() {
    if (document.hidden) { previewHiddenPending = true; return; }
    if (previewBusy) { previewAgain = true; return; }
    previewBusy = true;
    const t0 = performance.now();
    $('previewOut').classList.add('stale');
    let stage = '';
    try {
      // ลองเต็มรูปแบบก่อน ถ้าเบราว์เซอร์ไม่รับ → ลองไม่มีตาราง OpenType เพื่อแยกว่าปัญหาอยู่ที่ไหน
      let res = null, face = null, firstErr = null;
      for (const layout of [true, false]) {
        try {
          stage = 'compile' + (layout ? '' : ' (ไม่มี GPOS/GSUB)');
          res = window.FontCompiler.compile({ settings: S(), outlines: state.outlines, glyphs: GD.ALL_GLYPHS, mode: 'preview', previewBoxes: true, layout });
          if (layout) lastCompileMs = performance.now() - t0;
          stage = 'FontFace' + (layout ? '' : ' (ไม่มี GPOS/GSUB)');
          face = new FontFace('TFSPreview', res.buffer);
          await face.load();
          break;
        } catch (err) {
          if (!firstErr) firstErr = { err, stage };
          res = null; face = null;
          if (!layout) throw err;
        }
      }
      state.report = res.report;
      document.fonts.add(face);
      if (previewFace) document.fonts.delete(previewFace);
      previewFace = face;
      if (firstErr) {
        showDockError(firstErr.err, firstErr.stage);
        $('dockStatus').textContent = 'ทดลอง (ไม่มีการจัดสระ)';
      } else { showDockError(null); $('dockStatus').textContent = 'ทดลอง ' + res.report.drawn + ' ตัว'; }
      $('dock').classList.toggle('nofont', !res.report.drawn);
      $('dockStatus').title = 'ฟอนต์ทดลองสร้างจากเส้นใน Illustrator (กล่อง = ยังไม่วาด)';
      A.renderMetricReadout();
    } catch (e) {
      console.error(e);
      $('dockStatus').textContent = 'สร้างฟอนต์ทดลองไม่ได้';
      $('dockStatus').title = e.message;
      showDockError(e, typeof stage === 'string' ? stage : '');
    } finally {
      $('previewOut').classList.remove('stale');
      previewBusy = false;
      if (previewAgain) { previewAgain = false; schedulePreview(); }
    }
  }

  /** แสดงสาเหตุที่สร้างฟอนต์ทดลองไม่ได้ในแผง (ไม่ซ่อนใน tooltip) */
  function showDockError(e, stage) {
    const box = $('dockErr'); if (!box) return;
    if (!e) { if (!box.getAttribute('data-build')) { box.classList.add('hidden'); box.textContent = ''; } return; }
    if (box.getAttribute('data-build')) return;
    const first = String((e && e.stack) || e).split('\n').slice(0, 3).join(' ⏎ ');
    box.textContent = '[' + (stage || '?') + '] ' + (e.message || e) + ' — ' + first.slice(0, 400);
    box.classList.remove('hidden');
  }

  /** ตรวจว่าไฟล์ในโฟลเดอร์ส่วนขยายเป็นชุดเดียวกัน (คัดลอกไม่ครบ/ปนเวอร์ชันจะทำให้ฟอนต์ทดลองพัง)
   *  รายชื่อไฟล์อ่านจาก <script src="src/..."> ใน index.html · ค่า build เขียนโดย `npm run stamp` */
  function checkBuild() {
    const b = window.TFS_BUILD || {};
    const files = Array.prototype.map.call(document.querySelectorAll('script[src^="src/"]'), s => s.getAttribute('src').replace(/^src\//, '').replace(/\.js$/, ''));
    const expected = b['app/core'];
    const bad = files.filter(n => b[n] !== expected);
    if (!bad.length) return true;
    const box = $('dockErr');
    box.textContent = 'ไฟล์ใน panel ไม่ตรงเวอร์ชัน (' + bad.map(n => n + (b[n] ? ' = ' + b[n] : ' ไม่พบ')).join(', ') + ') — ปิด Illustrator แล้วรัน install-windows.bat / install-mac.command ใหม่';
    box.classList.remove('hidden'); box.setAttribute('data-build', '1');
    return false;
  }

  // ================================================================== theme
  function applyTheme() {
    const env = window.Host.hostEnv();
    if (!env || !env.appSkinInfo) return;
    const col = env.appSkinInfo.panelBackgroundColor.color;
    const r = Math.round(col.red), g = Math.round(col.green), b = Math.round(col.blue);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const root = document.documentElement;
    root.classList.toggle('light', lum > 0.55);
    const shade = d => 'rgb(' + [r, g, b].map(v => Math.max(0, Math.min(255, v + d))).join(',') + ')';
    root.style.setProperty('--bg', 'rgb(' + r + ',' + g + ',' + b + ')');
    root.style.setProperty('--bg-sunk', shade(lum > 0.55 ? -14 : -10));
    root.style.setProperty('--bg-raised', shade(lum > 0.55 ? 10 : 10));
    root.style.setProperty('--bg-hover', shade(lum > 0.55 ? -8 : 20));
    root.style.setProperty('--line', shade(lum > 0.55 ? -38 : 24));
    root.style.setProperty('--line-soft', shade(lum > 0.55 ? -22 : 12));
  }

  // ============================================================ project load
  let loading = null;
  /** โหลดซ้อนกันไม่ได้: ถ้ามีการโหลดค้างอยู่ ให้รอตัวเดิม แล้วโหลดใหม่อีกรอบเดียวหลังจบ */
  function loadProject() {
    if (loading) { loading.again = true; return loading.p; }
    const run = { again: false };
    run.p = (async () => {
      try { await loadProjectNow(); }
      finally {
        loading = null;
        if (run.again) await loadProject();
      }
    })();
    loading = run;
    return run.p;
  }

  async function loadProjectNow() {
    const Host = window.Host;
    let info;
    try { info = await Host.call('docInfo'); } catch (e) { setDocState(null, e.message); return; }
    state.doc = info;
    state.docKey = info.hasDoc ? (info.path || info.name) : '';
    setDocState(info);
    if (!info.hasDoc || !info.isProject) { state.ready = false; showOnboarding(info); refreshTab(); schedulePreview(); return; }
    showOnboarding(null);

    // settings: ไฟล์ .ai ก่อน แล้วค่อย backup ในเครื่อง
    let saved = null;
    try { const str = await Host.call('loadSettings'); if (str) saved = JSON.parse(str); } catch (e) { console.warn(e); }
    if (!saved) { try { const ls = store.get(storageKey()); if (ls) saved = JSON.parse(ls); } catch (e) { console.warn('[TFS] backup settings unreadable', e.message); } }
    state.settings = PS.hydrate(saved);
    state.lastSaved = saved ? JSON.stringify(state.settings) : '';
    bindSettingsUI();

    state.outlines = {}; state.sigs = {}; state.warn = {};
    clearNormCache();
    try {
      const scan = await Host.call('scanAll');
      const codes = Object.keys(scan).filter(k => scan[k]);
      for (let i = 0; i < codes.length; i += 16) {
        $('docName').textContent = info.name + ' — กำลังอ่านเส้น ' + Math.min(codes.length, i + 16) + '/' + codes.length;
        await fetchOutlines(codes.slice(i, i + 16), true);
      }
    } catch (e) { toast('อ่านสถานะ Layer ไม่สำเร็จ: ' + e.message, { error: true }); }
    setDocState(info);
    state.ready = true;
    if (info.activeLayer && info.activeLayer.indexOf('glyph_') === 0) {
      const d = GD.BY_CODE[info.activeLayer.slice(6)];
      if (d) { state.active = d; state.set = setOfDef(d); }
    }
    renderAll();
    schedulePreview.flush();
    if (!saved) saveSettings();
  }

  function setOfDef(def) {
    return Object.keys(GD.SETS).find(k => GD.SETS[k].glyphs.indexOf(def) >= 0) || 'thai';
  }

  function setDocState(info, err) {
    const dot = $('docDot'), name = $('docName');
    dot.className = 'doc-dot' + (window.Host.inCEP ? (info && info.hasDoc ? ' ok' : '') : ' mock');
    if (err) { name.textContent = 'เชื่อมต่อ Illustrator ไม่ได้'; name.title = err; return; }
    if (!window.Host.inCEP) { name.textContent = 'โหมดตัวอย่าง (เปิดนอก Illustrator)'; return; }
    name.textContent = info && info.hasDoc ? info.name : 'ยังไม่มีเอกสารเปิดอยู่';
    name.title = info && info.path ? info.path : '';
  }

  function showOnboarding(info) {
    const ob = $('onboard'), main = $('drawMain');
    if (!info) { ob.classList.add('hidden'); main.classList.remove('hidden'); return; }
    ob.classList.remove('hidden'); main.classList.add('hidden');
    $('btnUseDoc').classList.toggle('hidden', !info.hasDoc);
    $('onboardText').textContent = info.hasDoc
      ? 'เอกสารนี้ยังไม่ได้ตั้งเป็นโปรเจกต์ฟอนต์ จะใช้เอกสารนี้ (เพิ่มเส้นไกด์และ Layer ให้) หรือสร้างเอกสารใหม่ 800×800 pt ก็ได้'
      : 'สร้างเอกสาร 800×800 pt พร้อมเส้นไกด์ แล้ววาดทีละตัว ระบบจะสลับ Layer ให้อัตโนมัติเมื่อคุณเลือกตัวอักษรในแผงนี้';
  }

  async function startProject(useActive) {
    try {
      await window.Host.call('setup', S().canvas, !!useActive);
      await loadProject();
      await selectGlyph(state.active, true);
      toast('สร้างโปรเจกต์แล้ว เริ่มวาด ' + state.active.name + ' ได้เลย');
    } catch (e) { toast('สร้างโปรเจกต์ไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  async function fetchOutlines(codes, quiet, expand) {
    if (!codes.length) return {};
    const res = await window.Host.call('getOutlines', codes, !!expand);
    if (expand) return res;
    codes.forEach(code => {
      const r = res[code] || { paths: [], warn: {} };
      state.outlines[code] = r.paths || [];
      state.sigs[code] = r.sig;
      state.warn[code] = r.warn || {};
      delete normCache[code];
      if (!quiet) A.updateCell(code);
    });
    return res;
  }

  // ===================================================== watch active glyph
  // ซิงค์กับ Illustrator เฉพาะตอนเมาส์อยู่บนแผง: การอ่านเอกสารระหว่างที่ผู้ใช้กำลัง Transform/ลากอยู่บนแคนวาส
  // ทำให้ Illustrator ฟ้อง "Bounding Box or Free Transform ... Error:PARM" ปุ่มซิงค์ตลอดเวลาเปิดได้ที่แถบบน
  let pollN = 0, panelHover = true, syncAlways = store.get('tfsSyncAlways') === '1';
  async function poll() {
    if (state.busy || document.hidden) return;
    if (!panelHover && !syncAlways) return;
    pollN++;
    try {
      if (pollN % 5 === 0) {
        const info = await window.Host.call('docInfo');
        const key = info.hasDoc ? (info.path || info.name) : '';
        if (key !== state.docKey || (!!info.isProject) !== state.ready) { await loadProject(); return; }
      }
      if (!state.ready) return;
      const code = state.active.code;
      const r = await window.Host.call('signature', code);
      if (!r.hasDoc) { await loadProject(); return; }
      if (r.sig !== state.sigs[code]) {
        await fetchOutlines([code]);
        A.renderCurrent(); A.updateCounts(); refreshTab(true);
        schedulePreview();
      }
    } catch (e) {
      // Illustrator ไม่ว่าง (เช่น เปิดกล่องโต้ตอบ) — ลองใหม่รอบหน้า
      console.debug('[TFS] poll skipped:', e.message);
    }
  }

  // ================================================================ selection
  function hintFor(def) {
    if (def.kind === 'auto') return 'สระอำสร้างอัตโนมัติจาก ํ + า — ไม่ต้องวาด';
    if (def.isCutVariant) return 'ตัดส่วนใต้เส้นฐานออก หรือกด "ตัดเชิงอัตโนมัติ" ในแผง';
    if (def.kind === 'mark-bottom') return 'สระล่าง: วาดตำแหน่งใดก็ได้ ระบบจะวางใต้พยัญชนะให้เอง';
    if (GD.isMark(def)) return 'สระบน/วรรณยุกต์: วาดตำแหน่งใดก็ได้ ระบบจะวางบนพยัญชนะให้เอง';
    if (def.tallLeading) return 'หางด้านบนยื่นทับตัวถัดไปได้ ช่องไฟวัดจากลำตัวใต้เส้น Cap';
    if (def.thaiConsonant) return 'ตั้งบนเส้นฐาน หัวตัวแตะเส้น Cap · หางที่สูงเกินเส้นส้ม ระบบจะหลบสระให้';
    return 'ตั้งบนเส้นฐาน';
  }

  async function selectGlyph(def, notify) {
    state.active = def;
    if (setOfDef(def) !== state.set) { state.set = setOfDef(def); A.ctl.set.set(state.set); A.renderGrid(); }
    document.querySelectorAll('.cell.on').forEach(c => c.classList.remove('on'));
    const cell = document.querySelector('.cell[data-code="' + def.code + '"]');
    if (cell) { cell.classList.add('on'); if (cell.scrollIntoViewIfNeeded) cell.scrollIntoViewIfNeeded(false); }
    A.renderCurrent(); refreshTab(true);
    if (notify === false || !state.ready) return;
    try {
      const title = displayChar(def) + '   ' + def.name + '   ' + def.code;
      const r = await window.Host.call('switchGlyph', def.code, title, hintFor(def), { tall: !!def.thaiConsonant }, S().canvas);
      if (r.sig !== state.sigs[def.code]) { await fetchOutlines([def.code]); A.renderCurrent(); A.updateCounts(); refreshTab(true); schedulePreview(); }
    } catch (e) { toast('สลับ Layer ไม่สำเร็จ: ' + e.message, { error: true }); }
  }

  // ================================================================ tabs
  const TAB_IDS = ['draw', 'spacing', 'marks', 'auto', 'export'];
  // ลำดับการผูกค่าตั้งค่าเข้ากับตัวควบคุม (แท็บส่งออกสร้างตัวควบคุม Canvas/metrics, dock ใช้ค่า ui)
  const BIND_ORDER = ['export', 'spacing', 'dock', 'marks', 'auto'];
  const WIRE_ORDER = ['draw', 'spacing', 'marks', 'auto', 'export', 'dock'];

  /** วาดแท็บที่เปิดอยู่ใหม่ · light = เรียกจากการเลือกตัว (แท็บวาดไม่ต้องสร้างตารางใหม่) */
  function refreshTab(light) {
    if (state.tab === 'draw') { if (!light) A.tabs.draw.render(); return; }
    const t = A.tabs[state.tab];
    if (t && t.render) t.render();
  }
  function renderAll() { A.renderGrid(); A.renderCurrent(); refreshTab(true); A.ctl.set.set(state.set); }

  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === t));
    TAB_IDS.forEach(p => $('page-' + p).classList.toggle('hidden', p !== t));
    refreshTab();
  }

  /** ผูกค่าตั้งค่าปัจจุบันเข้ากับตัวควบคุมของทุกแท็บ (เรียกหลังโหลด/นำเข้า/เปลี่ยนเอกสาร) */
  function bindSettingsUI() {
    BIND_ORDER.forEach(k => { const t = A.tabs[k]; if (t && t.bind) t.bind(); });
  }

  // ================================================================= wiring
  function wire() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.getAttribute('data-tab'))));
    $('btnRescan').onclick = () => loadProject();
    $('btnReload').onclick = () => location.reload();
    $('btnNewProject').onclick = () => startProject(false);
    $('btnUseDoc').onclick = () => startProject(true);

    WIRE_ORDER.forEach(k => { const t = A.tabs[k]; if (t && t.wire) t.wire(); });

    document.addEventListener('mousemove', () => { if (!panelHover) { panelHover = true; poll(); } }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { panelHover = false; });
    const syncBtn = $('btnSync');
    const showSync = () => { syncBtn.classList.toggle('on', syncAlways); syncBtn.title = syncAlways ? 'ซิงค์กับ Illustrator ตลอดเวลา (อาจรบกวนตอน Transform) — คลิกเพื่อปิด' : 'ซิงค์เมื่อเมาส์อยู่บนแผง (ปลอดภัยตอน Transform) — คลิกเพื่อซิงค์ตลอดเวลา'; };
    syncBtn.onclick = () => { syncAlways = !syncAlways; store.set('tfsSyncAlways', syncAlways ? '1' : '0'); showSync(); toast(syncAlways ? 'ซิงค์ตลอดเวลา' : 'ซิงค์เมื่อเมาส์อยู่บนแผง'); };
    showSync();
    // Illustrator ส่ง event นี้บ่อย (กลับมาที่หน้าต่าง, หลังบันทึก ฯลฯ) — อ่านเส้นทุกตัวใหม่เฉพาะเมื่อเปลี่ยนเอกสารจริง
    window.Host.onEvent('documentAfterActivate', async () => {
      try {
        const info = await window.Host.call('docInfo');
        const key = info.hasDoc ? (info.path || info.name) : '';
        if (key === state.docKey && (!!info.isProject) === state.ready) return;
      } catch (e) { /* อ่านไม่ได้ → โหลดใหม่ตามเดิม */ }
      loadProject();
    });
    window.Host.onEvent(window.CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme);
    setInterval(poll, 1200);
  }

  async function init() {
    checkBuild();
    applyTheme();
    wire();
    bindSettingsUI();
    renderAll();
    await loadProject();
  }

  Object.assign(A, {
    state, S, normCache, clearNormCache, store,
    isDrawn, hostWarn, statusOf, outlinesOf, norm, measureOf, displayChar, setGlyphs, pt, cutPreview, glyphSvg,
    customOf, isCustomized, contoursForDef,
    saveSettings, changed, schedulePreview, buildPreview,
    loadProject, fetchOutlines, selectGlyph, setOfDef,
    refreshTab, renderAll, setTab, bindSettingsUI
  });
  document.addEventListener('DOMContentLoaded', init);
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/core': '2.0.0-1b04fcfe' });
