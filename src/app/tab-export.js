/**
 * แท็บ ส่งออก — ข้อมูลฟอนต์, ชุดอักษร, ระยะบรรทัด, Canvas/เส้นไกด์, ส่งออก .otf, นำเข้าฟอนต์เดิม
 */
(function () {
  'use strict';
  const { $, el, scrub, bindSeg, toast } = window.UI;
  const GD = window.GlyphData;
  const PS = window.ProjectSettings;
  const A = window.TFSApp;
  const { state, S, isDrawn, statusOf, displayChar, clearNormCache, changed } = A;

  let metricCtl;

  function bind() {
    const s = S();
    const bindText = (id, obj, key) => {
      const i = $(id); i.value = obj[key] || '';
      i.oninput = () => { obj[key] = i.value; changed('quiet'); updateExportCount(); };
    };
    bindText('fFamily', s.info, 'family'); bindText('fVersion', s.info, 'version');
    bindText('fDesigner', s.info, 'designer'); bindText('fCopyright', s.info, 'copyright');
    const st = $('fStyle');
    if (!Array.prototype.some.call(st.options, o => o.value === s.info.style)) st.appendChild(el('option', null, s.info.style));
    st.value = s.info.style; st.onchange = () => { s.info.style = st.value; changed('quiet'); };
    $('fUpm').value = String(s.info.upm); $('fUpm').onchange = () => { s.info.upm = parseInt($('fUpm').value, 10); changed('quiet'); };
    [['exThai', 'thai'], ['exLatin', 'latin'], ['exSymbols', 'symbols'], ['exFallback', 'fallback']].forEach(([id, k]) => {
      $(id).checked = !!s.export[k]; $(id).onchange = () => { s.export[k] = $(id).checked; changed('quiet'); updateExportCount(); };
    });
    $('savePath').textContent = s.export.path || 'ยังไม่ได้เลือกที่บันทึก';
    metricCtl.set(s.metrics.mode); $('metricManual').classList.toggle('hidden', s.metrics.mode !== 'manual');
    buildMetricManual();
    const spaceScrub = scrub({ label: 'ความกว้างเว้นวรรค', value: s.metrics.spaceWidth, min: 20, max: 800, unit: 'pt', base: 220, onInput: v => { s.metrics.spaceWidth = v; changed('quiet'); } });
    $('scrubSpace').innerHTML = ''; $('scrubSpace').appendChild(spaceScrub.el);
    buildCanvasControls();
    updateExportCount();
  }

  function buildMetricManual() {
    const m = S().metrics, host = $('metricManual'); host.innerHTML = '';
    [['ascender', 'เหนือเส้นฐาน', 0, 3000], ['descender', 'ใต้เส้นฐาน', -3000, 0], ['lineGap', 'ระยะเพิ่ม', 0, 2000]].forEach(([k, label, min, max]) => {
      host.appendChild(scrub({ label, value: m[k], min, max, unit: 'u', onInput: v => { m[k] = v; changed('quiet'); } }).el);
    });
  }

  function buildCanvasControls() {
    const c = S().canvas, d = PS.defaults().canvas, host = $('canvasControls'); host.innerHTML = '';
    [['baseline', 'เส้นฐาน'], ['cap', 'หัวตัว (Cap)'], ['ascender', 'Ascender'], ['descender', 'Descender'], ['lsbGuide', 'ไกด์ซ้าย'], ['rsbGuide', 'ไกด์ขวา']].forEach(([k, label]) => {
      host.appendChild(scrub({ label, value: c[k], min: 0, max: c.em, unit: 'pt', base: d[k], onInput: v => { c[k] = v; clearNormCache(); changed('quiet'); } }).el);
    });
  }

  function renderMetricReadout() {
    const r = state.report && state.report.metrics;
    const out = $('metricReadout');
    if (!r) { out.textContent = 'วาดตัวอักษรก่อน แล้วระบบจะคำนวณให้'; return; }
    out.innerHTML = '';
    out.appendChild(el('span', null, 'สูงบรรทัด ', el('b', { class: 'num' }, r.lineHeight.toFixed(2)), ' em'));
    out.appendChild(el('span', null, 'บน ', el('b', { class: 'num' }, String(r.winAscent))));
    out.appendChild(el('span', null, 'ล่าง ', el('b', { class: 'num' }, String(r.winDescent))));
    out.title = 'หน่วยฟอนต์ (UPM ' + r.upm + ') · คิดรวมสระและวรรณยุกต์ที่ซ้อนสูงสุดแล้ว';
  }

  function exportDefs() {
    const e = S().export; let list = [];
    if (e.thai) list = list.concat(GD.SETS.thai.glyphs);
    if (e.latin) list = list.concat(GD.SETS.latin.glyphs);
    if (e.symbols) list = list.concat(GD.SETS.symbols.glyphs);
    return list;
  }
  function fontFileName() {
    const s = S();
    return (s.info.family || 'MyThaiFont').trim() + '-' + (s.info.style || 'Regular').replace(/\s+/g, '') + '.otf';
  }
  function updateExportCount() {
    const defs = exportDefs();
    const n = defs.filter(d => statusOf(d) !== 'missing').length;
    $('exportCount').textContent = n + ' จาก ' + defs.length + ' ตัวพร้อมใช้';
    $('btnExport').textContent = 'ส่งออก ' + fontFileName();
  }

  async function browsePath() {
    const s = S();
    const p = await window.Host.pickSavePath(fontFileName(), s.export.path);
    if (p) { s.export.path = p; $('savePath').textContent = p; changed('quiet'); }
    return p;
  }

  async function doExport() {
    if (state.busy) return;
    const btn = $('btnExport'), res = $('exportResult');
    const defs = exportDefs();
    const codes = [];
    defs.forEach(d => { if (isDrawn(d.code)) codes.push(d.code); });
    if (!codes.length) { toast('ยังไม่มีตัวที่วาดในชุดที่เลือก', { error: true }); return; }
    state.busy = true; btn.disabled = true;
    try {
      let outlines = {};
      if (state.ready && window.Host.inCEP) {
        for (let i = 0; i < codes.length; i += 10) {
          btn.textContent = 'กำลังเตรียมเส้น ' + Math.min(codes.length, i + 10) + '/' + codes.length + '…';
          const r = await window.Host.call('getOutlines', codes.slice(i, i + 10), true);
          Object.keys(r).forEach(k => { outlines[k] = r[k].paths; });
        }
      } else outlines = state.outlines;
      btn.textContent = 'กำลังสร้างฟอนต์…';
      await new Promise(r => setTimeout(r, 20));
      const out = window.FontCompiler.compile({ settings: S(), outlines, glyphs: defs, mode: 'export' });
      let path = S().export.path;
      if (path) path = path.replace(/[^\\/]*$/, out.report.fileName);
      if (!path && window.Host.inCEP) path = await browsePath();
      let saved = false;
      if (path) saved = await window.Host.writeFile(path, out.buffer);
      if (!saved) { window.Host.download(out.report.fileName, out.buffer); }
      if (path && saved) { S().export.path = path; $('savePath').textContent = path; changed('quiet'); }
      res.className = 'result'; res.innerHTML = '';
      res.appendChild(el('div', null, el('b', null, (saved ? 'บันทึกแล้ว ' : 'ดาวน์โหลดแล้ว ') + out.report.fileName)));
      res.appendChild(el('div', { class: 'dim' }, out.report.drawn + ' ตัวอักษร · ' + Math.round(out.buffer.byteLength / 1024) + ' KB · ' +
        (out.report.kernPairs ? out.report.kernPairs + ' คู่ kerning · ' : '') + 'OpenType: ' + out.report.features.gsub.concat(out.report.features.gpos).join(', ')));
      const missing = out.report.missing.filter(c => GD.BY_CODE[c] && GD.BY_CODE[c].kind !== 'auto');
      if (missing.length) res.appendChild(el('div', { class: 'faint' }, 'ยังไม่ได้วาด ' + missing.length + ' ตัว: ' + missing.slice(0, 18).map(c => displayChar(GD.BY_CODE[c])).join(' ') + (missing.length > 18 ? ' …' : '')));
      out.report.warnings.forEach(w => res.appendChild(el('div', { style: 'color:var(--warn)' }, w)));
      if (saved) res.appendChild(el('button', { class: 'btn', style: 'margin-top:6px', onclick: () => window.Host.reveal(path) }, 'เปิดโฟลเดอร์'));
      toast('ส่งออกฟอนต์แล้ว: ' + out.report.fileName);
    } catch (e) {
      console.error(e);
      res.className = 'result err'; res.textContent = 'ส่งออกไม่สำเร็จ: ' + e.message;
      toast('ส่งออกไม่สำเร็จ: ' + e.message, { error: true });
    } finally {
      state.busy = false; btn.disabled = false; updateExportCount();
    }
  }

  // ------------------------------------------------------------ import
  let parsedFont = null;
  async function onFontFile(file) {
    try {
      const buf = await new Promise((resolve, reject) => {   // FileReader: รองรับ Chromium รุ่นเก่าใน CEP
        const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(file);
      });
      parsedFont = window.FontImporter.parse(buf, file.name);
      const i = parsedFont.info;
      const sum = $('importSummary'); sum.innerHTML = '';
      sum.appendChild(el('div', null, el('b', null, i.family + ' ' + i.style)));
      sum.appendChild(el('div', { class: 'dim' }, i.glyphCount + ' glyph · UPM ' + i.upm + (parsedFont.scripts.length ? ' · สคริปต์ ' + parsedFont.scripts.join(', ') : '')));
      if (parsedFont.features.length) sum.appendChild(el('div', { class: 'faint' }, 'Features: ' + parsedFont.features.map(f => f.tag).join(' ')));
      $('importInfo').classList.remove('hidden');
      updateImportCount();
    } catch (e) { toast('อ่านไฟล์ฟอนต์ไม่ได้: ' + e.message, { error: true }); }
  }
  function importDefs() {
    let list = [];
    if ($('imThai').checked) list = list.concat(GD.SETS.thai.glyphs);
    if ($('imLatin').checked) list = list.concat(GD.SETS.latin.glyphs);
    if ($('imSymbols').checked) list = list.concat(GD.SETS.symbols.glyphs);
    return list;
  }
  function updateImportCount() {
    if (!parsedFont) return;
    const prepared = window.FontImporter.prepare(parsedFont, importDefs(), S(), $('imFit').checked ? 'cap' : 'em');
    $('btnImport').textContent = 'นำเข้า ' + prepared.length + ' ตัว';
    $('btnImport').disabled = !prepared.length;
  }
  async function doImport() {
    if (!parsedFont || state.busy) return;
    if (!state.ready) {
      await window.Host.call('setup', S().canvas, false);
      await A.loadProject();
    }
    const prepared = window.FontImporter.prepare(parsedFont, importDefs(), S(), $('imFit').checked ? 'cap' : 'em');
    const replace = $('imReplace').checked;
    const prog = $('importProgress'), bar = prog.querySelector('i');
    prog.classList.remove('hidden'); state.busy = true; $('btnImport').disabled = true;
    try {
      let done = 0;
      for (let i = 0; i < prepared.length; i += 12) {
        const batch = prepared.slice(i, i + 12).filter(p => replace || !isDrawn(p.code));
        if (batch.length) await window.Host.call('importGlyphs', batch.map(p => ({ code: p.code, paths: p.paths })), replace);
        done = Math.min(prepared.length, i + 12);
        bar.style.width = Math.round(done / prepared.length * 100) + '%';
        $('importProgressText').textContent = 'สร้าง Layer ' + done + '/' + prepared.length;
      }
      const codes = prepared.map(p => p.code);
      for (let i = 0; i < codes.length; i += 16) await A.fetchOutlines(codes.slice(i, i + 16), true);
      if ($('imSpacing').checked) Object.assign(S().glyphSpacing, window.FontImporter.spacingOverrides(prepared, S()));
      if ($('imKerning').checked) Object.assign(S().kerning.pairs, window.FontImporter.kerningPairs(parsedFont, prepared, S()));
      if (!S().info.family || S().info.family === 'MyThaiFont') S().info.family = parsedFont.info.family;
      A.bindSettingsUI(); A.renderAll(); changed();
      await A.selectGlyph(state.active, true);
      toast('นำเข้า ' + prepared.length + ' ตัวแล้ว');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + e.message, { error: true }); }
    finally { state.busy = false; $('btnImport').disabled = false; prog.classList.add('hidden'); }
  }

  function wire() {
    metricCtl = bindSeg($('metricSeg'), 'data-v', 'auto', v => { S().metrics.mode = v; $('metricManual').classList.toggle('hidden', v !== 'manual'); changed('quiet'); });
    $('btnBrowse').onclick = browsePath; $('savePath').onclick = browsePath;
    $('btnExport').onclick = doExport;
    $('btnGuides').onclick = async () => {
      try { await window.Host.call('ensureGuides', S().canvas, true); toast('วาดเส้นไกด์ใหม่แล้ว'); }
      catch (e) { toast('วาดเส้นไกด์ไม่ได้: ' + e.message, { error: true }); }
    };
    const dz = $('dropzone'), fi = $('fileInput');
    dz.onclick = () => { fi.value = ''; fi.click(); };
    fi.onchange = () => { if (fi.files[0]) onFontFile(fi.files[0]); };
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) onFontFile(e.dataTransfer.files[0]); });
    ['imThai', 'imLatin', 'imSymbols', 'imFit'].forEach(id => { $(id).onchange = updateImportCount; });
    $('btnImport').onclick = doImport;
  }

  A.renderMetricReadout = renderMetricReadout;
  A.tabs.export = { render() { updateExportCount(); renderMetricReadout(); }, bind, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-export': '2.0.0-cba108e5' });
