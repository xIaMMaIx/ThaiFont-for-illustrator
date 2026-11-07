/**
 * Illustrator bridge — เรียกฟังก์ชันใน hostScript.jsx อย่างปลอดภัย
 *  • argument ทุกตัวถูกแปลงเป็น JSON literal (ชื่อที่มี " หรือ \ ไม่ทำให้สคริปต์พัง)
 *  • คิวคำสั่งทีละตัว (ExtendScript ทำงานทีละคำสั่งอยู่แล้ว) ป้องกันการเรียกซ้อน
 *  • ถ้าเปิดนอก Illustrator จะใช้โหมดจำลอง (mock) เพื่อดูหน้าตา/ทดสอบได้
 */
(function (root) {
  'use strict';

  const cs = root.CSInterface ? new root.CSInterface() : null;
  const inCEP = !!(cs && cs.isAvailable && cs.isAvailable());
  const nodeRequire = (typeof root.require === 'function') ? root.require
    : (root.cep_node && typeof root.cep_node.require === 'function') ? root.cep_node.require : null;

  function lit(v) {
    return JSON.stringify(v === undefined ? null : v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  let chain = Promise.resolve();
  function evalRaw(script) {
    return new Promise(resolve => cs.evalScript(script, resolve));
  }
  function queued(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  /** โหลด hostScript.jsx ถ้ายังไม่มี หรือเป็นรุ่นเก่าที่ค้างอยู่ใน Illustrator (เช่น หลังติดตั้งเวอร์ชันใหม่) */
  let loaded = false;
  async function ensureLoaded() {
    if (loaded) return;
    const want = (root.TFS_BUILD || {})['illustrator-api'];
    const have = await evalRaw('typeof TFS === "object" && TFS ? String(TFS.BUILD) : "none"');
    if (have !== want) {
      if (have !== 'none') console.info('[TFS] reloading hostScript.jsx', have, '->', want);
      const ext = cs.getSystemPath(root.SystemPath.EXTENSION);
      await evalRaw('$.evalFile(' + lit(ext + '/hostScript.jsx') + ')');
    }
    loaded = true;
  }

  function call(fn) {
    const args = Array.prototype.slice.call(arguments, 1).map(lit).join(',');
    return queued(async () => {
      await ensureLoaded();
      const res = await evalRaw('TFS.' + fn + '(' + args + ')');
      let parsed;
      try { parsed = JSON.parse(res); } catch (e) {
        if (res === 'EvalScript error.') loaded = false;
        throw new Error('Illustrator ตอบกลับผิดรูปแบบ (' + fn + '): ' + String(res).slice(0, 120));
      }
      if (!parsed.ok) throw new Error(parsed.error || ('คำสั่ง ' + fn + ' ล้มเหลว'));
      return parsed.data;
    });
  }

  // ------------------------------------------------------------------ mock
  const Mock = (function () {
    const fx = root.TFS_MOCK_FIXTURE || {};
    const doc = { hasDoc: !!fx.hasDoc || !!fx.outlines, name: fx.name || 'ตัวอย่าง.ai', layers: {}, settings: fx.settings || null, active: '' };
    Object.keys(fx.outlines || {}).forEach(k => { doc.layers[k] = fx.outlines[k]; });
    const sig = code => JSON.stringify(doc.layers[code] || []).length + ':' + (doc.layers[code] || []).length;
    const has = code => !!(doc.layers[code] && doc.layers[code].length);
    const api = {
      ping: () => ({ version: 'mock', hasDoc: doc.hasDoc }),
      docInfo: () => doc.hasDoc ? { hasDoc: true, name: doc.name, path: '', isProject: true, glyphLayers: Object.keys(doc.layers).length } : { hasDoc: false },
      setup: () => { doc.hasDoc = true; return { name: doc.name }; },
      ensureGuides: () => 'CREATED',
      switchGlyph: code => { doc.active = code; return { hasArt: has(code), sig: sig(code) }; },
      signature: code => ({ hasDoc: doc.hasDoc, hasArt: has(code), sig: sig(code), active: 'glyph_' + doc.active }),
      scanAll: () => { const r = {}; Object.keys(doc.layers).forEach(k => { r[k] = has(k); }); return r; },
      getOutlines: codes => {
        const r = {};
        codes.forEach(c => {
          const paths = doc.layers[c] || [];
          const warn = { strokes: paths.filter(p => p.s).length, text: 0, image: 0, other: 0, clip: 0, white: paths.filter(p => p.w).length };
          r[c] = { paths, warn, sig: sig(c) };
        });
        return r;
      },
      outlineStrokesInPlace: code => ({ sig: sig(code) }),
      clearGlyphs: codes => { const sigs = {}; let n = 0; codes.forEach(c => { if (has(c)) n++; delete doc.layers[c]; sigs[c] = sig(c); }); return { sigs, cleared: n, restored: 0 }; },
      // จำลอง Layer อ้างอิง: doc.refItems / doc.refOnBoard ตั้งเองใน Console เพื่อทดสอบ
      referenceInfo: () => ({ hasDoc: doc.hasDoc, layers: ['Reference (ไม่ถูกส่งออก)'], items: doc.refItems || 0, onBoard: doc.refOnBoard || 0, locked: false, hidden: false, active: doc.active === '_ref' }),
      activateReference: () => { doc.active = '_ref'; return { name: 'Reference (ไม่ถูกส่งออก)', created: false }; },
      // จำลอง: doc.selection = รายการเส้นแบบเดียวกับ getOutlines (ตั้งค่าเองใน Console เพื่อทดสอบ)
      placeSelection: (code, o) => {
        const sel = doc.selection;
        if (!sel || !sel.length) throw new Error('NO_SELECTION');
        if (has(code) && !o.replace) throw new Error('HAS_ART');
        const pts = []; sel.forEach(p => p.p.forEach(q => pts.push(q)));
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const b = [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)], h = b[1] - b[3];
        let scale = o.keepSize ? 1 : (o.scale > 0 ? o.scale : 0), newScale = false;
        if (!scale) { if (o.refH > 0 && h > 0.5) { scale = o.refH / h; newScale = true; } else scale = 1; }
        const cx0 = (b[0] + b[2]) / 2, cy0 = (b[1] + b[3]) / 2;
        const nb = [cx0 + (b[0] - cx0) * scale, cy0 + (b[1] - cy0) * scale, cx0 + (b[2] - cx0) * scale, cy0 + (b[3] - cy0) * scale];
        const dx = o.cx - (nb[0] + nb[2]) / 2, dy = o.anchor === 'top' ? o.y - nb[1] : o.y - nb[3];
        const tx = (x, y) => [cx0 + (x - cx0) * scale + dx, cy0 + (y - cy0) * scale + dy];
        doc.layers[code] = sel.map(p => Object.assign({}, p, { p: p.p.map(q => tx(q[0], q[1]).concat(tx(q[2], q[3]), tx(q[4], q[5]))) }));
        doc.selection = null; doc.active = code;
        return { sig: sig(code), scale, newScale, skipped: 0, items: sel.length };
      },
      importGlyphs: (batch, replace) => {
        let n = 0;
        batch.forEach(g => { if (!has(g.code) || replace) { doc.layers[g.code] = g.paths; n++; } });
        return { imported: n };
      },
      autoCut: (src, dst, cfg) => {
        if (!has(src)) throw new Error('SOURCE_EMPTY');
        doc.layers[dst] = doc.layers[src].filter(p => p.p.some(q => q[1] > cfg.baseline + 4));
        return { method: 'contour', sig: sig(dst) };
      },
      saveSettings: str => { doc.settings = str; try { root.localStorage.setItem('TFS_mock_settings', str); } catch (e) { } return true; },
      loadSettings: () => { if (doc.settings) return doc.settings; try { return root.localStorage.getItem('TFS_mock_settings'); } catch (e) { return null; } },
      saveDialog: name => name,
      revealFile: () => true,
      fitView: () => true
    };
    return {
      call: function (fn) {
        const args = Array.prototype.slice.call(arguments, 1);
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            try { resolve(api[fn].apply(null, JSON.parse(JSON.stringify(args)))); } catch (e) { reject(e); }
          }, 8);
        });
      },
      doc
    };
  })();

  const invoke = inCEP ? call : Mock.call;

  // ------------------------------------------------------------- file I/O
  async function pickSavePath(defaultName, lastPath) {
    if (root.cep && root.cep.fs && root.cep.fs.showSaveDialogEx) {
      try {
        const dir = lastPath ? lastPath.replace(/[\\/][^\\/]*$/, '') : '';
        const r = root.cep.fs.showSaveDialogEx('บันทึกไฟล์ฟอนต์ (.otf)', dir, ['otf'], defaultName, 'OpenType Font (*.otf)');
        if (r && r.err === 0) {
          let p = Array.isArray(r.data) ? r.data[0] : r.data;
          if (!p) return null;
          if (!/\.otf$/i.test(p)) p += '.otf';
          return p;
        }
      } catch (e) { /* fallback to host */ }
    }
    if (inCEP) {
      const p = await call('saveDialog', defaultName);
      if (p && !/\.otf$/i.test(p)) return p + '.otf';
      return p;
    }
    return null; // browser: ใช้การดาวน์โหลด
  }

  async function writeFile(path, buffer) {
    if (nodeRequire) {
      try {
        const fs = nodeRequire('fs');
        fs.writeFileSync(path, Buffer.from(new Uint8Array(buffer)));
        return true;
      } catch (e) { console.warn('[TFS] node write failed', e); }
    }
    if (root.cep && root.cep.fs) {
      const bytes = new Uint8Array(buffer); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const r = root.cep.fs.writeFile(path, root.btoa(bin), root.cep.encoding.Base64);
      if (r && r.err === 0) return true;
    }
    return false;
  }

  function download(name, buffer) {
    const blob = new Blob([buffer], { type: 'font/otf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function reveal(path) {
    if (nodeRequire) {
      try {
        const cp = nodeRequire('child_process');
        if (navigator.platform.indexOf('Win') === 0) cp.execFile('explorer.exe', ['/select,', path]);
        else cp.execFile('open', ['-R', path]);
        return true;
      } catch (e) { /* fallback */ }
    }
    if (inCEP) return call('revealFile', path);
    return false;
  }

  function onEvent(type, fn) { if (inCEP) cs.addEventListener(type, fn); }

  function hostEnv() { return inCEP ? cs.getHostEnvironment() : null; }

  const Host = { inCEP, call: invoke, pickSavePath, writeFile, download, reveal, onEvent, hostEnv, mock: inCEP ? null : Mock, lit };
  root.Host = Host;
})(window);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'illustrator-api': '2.0.0-2e84cd1e' });
