/**
 * แท็บ สระ/วรรณยุกต์ — ระยะรวม A–F, วรรณยุกต์รายตัว, ข้อความตัวอย่าง, ปรับจุดวางเฉพาะตัว
 */
(function () {
  'use strict';
  const { $, el, scrub } = window.UI;
  const GD = window.GlyphData;
  const PS = window.ProjectSettings;
  const A = window.TFSApp;
  const { state, S, norm, displayChar, customOf, changed } = A;

  const SPECIMENS = {
    stack: { label: 'ซ้อนกัน', text: 'กิ่ ปี้ ฟื้ ฝั่ ปั้ สิ้ ที่ ซึ้ง ชื่อ น้ำ ป่ำ' },
    upper: { label: 'สระบน', text: 'กิ ปี ฟึ ฝื บั ปั ฟั ส็ ศิ' },
    tone: { label: 'วรรณยุกต์', text: 'ก่ ป้ ฟ๊ ส๋ ห่ ฬ้ ด๋ ต่' },
    lower: { label: 'สระล่าง', text: 'กุ ญุ ฐู ฎุ ฏู รุ ปู ตฺ' },
    mine: { label: 'ตัวที่เลือก', text: '' }
  };
  function specimenText() {
    if (state.specimen !== 'mine') return SPECIMENS[state.specimen].text;
    const d = state.active;
    if (d.kind === 'mark-tone') return ['ก', 'ป', 'น', 'ฟ', 'ส'].map(c => c + d.char).concat(['กิ', 'ปี', 'ซึ', 'ชื', 'ปั'].map(c => c + d.char)).join(' ');
    if (d.kind === 'mark-top') return ['ก', 'ป', 'น', 'ฟ', 'ส'].map(c => c + d.char).concat(['ก', 'ป', 'ซ'].map(c => c + d.char + '่'), ['ก', 'ป', 'ซ'].map(c => c + d.char + '้')).join(' ');
    if (GD.isMark(d)) return ['ก', 'ป', 'น', 'ฟ', 'ส'].map(c => c + d.char).join(' ');
    if (d.thaiConsonant) return [d.char + 'ิ', d.char + 'ี่', d.char + '้', d.char + 'ั้', d.char + 'ุ', d.char + 'ู่', d.char + 'ำ'].join(' ');
    return d.char + d.char + ' ' + 'น' + d.char + 'น';
  }

  function renderMarks() {
    $('markSpecimen').textContent = specimenText();
    const chips = $('specChips'); chips.innerHTML = '';
    Object.keys(SPECIMENS).forEach(k => chips.appendChild(el('button', {
      class: 'chip' + (state.specimen === k ? ' on' : ''), onclick: () => { state.specimen = k; renderMarks(); }
    }, SPECIMENS[k].label)));
    renderAnchorPanel();
  }

  function buildMarksControls() {
    const mk = S().marks, d = PS.defaults().marks;
    const rows = [
      ['A', 'upperGap', 'สระบน ห่างจากหัวพยัญชนะ', 0, 120],
      ['B', 'level2Gap', 'วรรณยุกต์ ห่างจากสระบน', -20, 120],
      ['C', 'lowerGap', 'สระล่าง ห่างจากเส้นฐาน', 0, 120],
      ['D', 'tallGap', 'หลบหางสูง (ป ฝ ฟ ฬ)', -40, 120],
      ['E', 'upperX', 'เลื่อนสระบนซ้าย/ขวา', -150, 150],
      ['F', 'lowerX', 'เลื่อนสระล่างซ้าย/ขวา', -150, 150]
    ];
    const host = $('gapControls'); host.innerHTML = '';
    rows.forEach(([key, prop, label, min, max]) => {
      const sc = scrub({ label, value: mk[prop], min, max, unit: 'pt', base: d[prop], onInput: v => { mk[prop] = v; changed('quiet'); renderMarks(); } });
      host.appendChild(el('div', { class: 'gap-row' }, el('span', { class: 'gap-key', style: key > 'D' ? 'background:var(--text-faint)' : '' }, key), sc.el));
    });
    const tg = $('toneGrid'); tg.innerHTML = '';
    PS.TONE_CODES.forEach(code => {
      const def = GD.BY_CODE[code];
      const sc = scrub({ label: '◌' + def.char, title: def.name + ' — ลากเพื่อเลื่อนซ้าย/ขวา', value: mk.tones[code] || 0, min: -150, max: 150, base: 0,
        onInput: v => { mk.tones[code] = v; changed('quiet'); } });
      tg.appendChild(sc.el);
    });

    // วรรณยุกต์ซ้อนบนสระบน: G = ทุกตัว + รายวรรณยุกต์ (บวกเพิ่มจากค่าด้านบน)
    mk.tonesStack = mk.tonesStack || {};
    const gx = $('stackXRow'); gx.innerHTML = '';
    gx.appendChild(el('span', { class: 'gap-key', style: 'background:var(--text-faint)' }, 'G'));
    gx.appendChild(scrub({ label: 'เลื่อนวรรณยุกต์ซ้อนทุกตัว ซ้าย/ขวา', value: mk.stackX || 0, min: -150, max: 150, unit: 'pt', base: 0,
      onInput: v => { mk.stackX = v; changed('quiet'); } }).el);
    const sg = $('toneStackGrid'); sg.innerHTML = '';
    PS.TONE_CODES.forEach(code => {
      const def = GD.BY_CODE[code];
      const sc = scrub({ label: '◌ิ' + def.char, title: def.name + ' เมื่อซ้อนบนสระบน — ลากเพื่อเลื่อนซ้าย/ขวา (เพิ่มจากค่าปกติ)', value: mk.tonesStack[code] || 0, min: -150, max: 150, base: 0,
        onInput: v => { mk.tonesStack[code] = v; changed('quiet'); } });
      sg.appendChild(sc.el);
    });
    drawMarkDiagram();
  }

  /** แผนภาพ A–D (SVG คงที่ ไม่มีข้อมูลจากผู้ใช้) */
  function drawMarkDiagram() {
    const s = $('markDiagram');
    const ink = 'var(--glyph)', key = 'var(--mark)';
    s.innerHTML = '' +
      // เส้นฐานและ Cap
      '<line x1="0" x2="320" y1="88" y2="88" stroke="var(--done)" stroke-width="1" opacity=".7"/>' +
      '<line x1="0" x2="320" y1="50" y2="50" stroke="var(--mark)" stroke-width="1" opacity=".7"/>' +
      // พยัญชนะธรรมดา (ซ้าย)
      '<path d="M40 88V56q0-6 6-6h30q6 0 6 6v32" fill="none" stroke="' + ink + '" stroke-width="7"/>' +
      '<rect x="56" y="34" width="27" height="6" rx="3" fill="' + ink + '"/>' +       // สระบน
      '<rect x="74" y="12" width="7" height="12" rx="2" fill="' + ink + '"/>' +       // วรรณยุกต์
      '<rect x="62" y="98" width="20" height="6" rx="3" fill="' + ink + '"/>' +       // สระล่าง
      dim(96, 40, 50, 'A') + dim(96, 24, 34, 'B') + dim(96, 88, 98, 'C') +
      // พยัญชนะหางสูง (ขวา)
      '<path d="M190 88V56q0-6 6-6h28q6 0 6 6v32M230 88V14" fill="none" stroke="' + ink + '" stroke-width="7"/>' +
      '<rect x="190" y="34" width="27" height="6" rx="3" fill="' + ink + '"/>' +
      '<line x1="217" x2="226" y1="37" y2="37" stroke="' + key + '" stroke-width="1.5"/>' +
      '<line x1="221.5" x2="221.5" y1="37" y2="60" stroke="' + key + '" stroke-width="1" opacity=".6"/>' +
      '<circle cx="210" cy="68" r="7" fill="' + key + '"/><text x="210" y="71.5" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">D</text>' +
      '<text x="238" y="22" font-size="9" fill="var(--text-faint)">หางสูง</text>';
    function dim(x, y1, y2, k) {
      return '<line x1="' + x + '" x2="' + x + '" y1="' + y1 + '" y2="' + y2 + '" stroke="' + key + '" stroke-width="1.5"/>' +
        '<circle cx="' + (x + 12) + '" cy="' + ((y1 + y2) / 2) + '" r="7" fill="' + key + '"/>' +
        '<text x="' + (x + 12) + '" y="' + ((y1 + y2) / 2 + 3.5) + '" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">' + k + '</text>';
    }
  }

  function renderAnchorPanel() {
    const def = state.active, host = $('anchorControls'); host.innerHTML = '';
    const info = $('anchorInfo');
    $('anchorTitle').textContent = def.char !== def.name ? def.name : def.code;
    $('anchorBadge').textContent = displayChar(def);
    const an = S().anchors; const ov = an[def.code] || {};
    const showState = () => {
      const n = Object.keys(an[def.code] || {}).filter(k => (an[def.code] || {})[k]).length;
      const manual = n > 0 && customOf(def).manualAn;
      $('btnAnchorReset').classList.toggle('hidden', !n);
      $('anchorState').textContent = manual ? 'ปรับแล้ว ' + n + ' ค่า' : n ? 'จูนแล้ว' : 'มาตรฐาน';
      $('anchorState').classList.toggle('on', manual);
      $('anchorState').classList.toggle('auto', n > 0 && !manual);
    };
    showState();
    const set = (prop, v) => {
      const cur = an[def.code] || {}; cur[prop] = v;
      if (!Object.keys(cur).some(k => cur[k])) delete an[def.code]; else an[def.code] = cur;
      showState();
      changed('quiet');
    };
    const add = (prop, label) => host.appendChild(scrub({ label, value: ov[prop] || 0, min: -200, max: 200, unit: 'pt', base: 0, onInput: v => set(prop, v) }).el);
    if (def.thaiConsonant) {
      const n = norm(def.code) || (def.isCutVariant ? norm(def.baseCode) : null);
      let tall = false;
      if (n && n.contours.length) {
        const m = window.Spacing.measure(def, n.contours, S());
        tall = window.Anchors.baseAnchors(def, n.contours, m, S()).tall;
      }
      info.textContent = !n ? 'ยังไม่ได้วาด — วาดแล้วระบบจะหาจุดวางสระให้อัตโนมัติ'
        : tall ? 'ตรวจพบหางสูง: สระบนและวรรณยุกต์จะหลบไปทางซ้ายของหาง (ยกเว้นตัวที่ตั้ง "ทะลุหางสูงได้" เช่น ั)' : 'สระบนและวรรณยุกต์ชิดขอบขวาของหลักขวา';
      add('tx', 'สระบน ←→'); add('ty', 'สระบน ↑↓'); add('bx', 'สระล่าง ←→'); add('by', 'สระล่าง ↑↓');
    } else if (GD.isMark(def)) {
      info.textContent = 'เลื่อนตัวนี้ทุกครั้งที่ใช้ (+ = ขวา / ขึ้น)';
      add('x', 'เลื่อน ←→'); add('y', 'เลื่อน ↑↓');
      if (def.kind === 'mark-top') {
        info.textContent = 'เลื่อนตัวนี้ทุกครั้งที่ใช้ (+ = ขวา / ขึ้น) · "วรรณยุกต์ซ้อน" = จุดที่วรรณยุกต์มาวางบนสระตัวนี้';
        add('sx', 'วรรณยุกต์ซ้อน ←→'); add('sy', 'วรรณยุกต์ซ้อน ↑↓');
        const mk = S().marks; mk.passThrough = mk.passThrough || {};
        const cb = el('input', { type: 'checkbox' }); cb.checked = !!mk.passThrough[def.code];
        cb.onchange = () => { if (cb.checked) mk.passThrough[def.code] = true; else delete mk.passThrough[def.code]; changed('quiet'); };
        host.appendChild(el('label', { class: 'check', style: 'grid-column: 1 / -1; margin-top: 2px',
          title: 'เปิด = วางตำแหน่งปกติบน ป ฝ ฟ ฬ ให้ส่วนหางทับ/ทะลุหางสูงได้ (วรรณยุกต์ที่ซ้อนบนตัวนี้ยังหลบซ้ายให้)' },
          cb, 'ทะลุหางสูงได้ (ไม่หลบซ้ายบน ป ฝ ฟ ฬ)'));
      }
    } else {
      info.textContent = 'ตัวนี้ไม่มีสระหรือวรรณยุกต์มาวางด้วย — เลือกพยัญชนะไทยหรือสระ/วรรณยุกต์ในแท็บ วาด';
    }
  }

  function wire() {
    $('btnAnchorReset').onclick = () => { delete S().anchors[state.active.code]; changed(); };
  }

  A.buildMarksControls = buildMarksControls;
  A.tabs.marks = { render: renderMarks, bind: buildMarksControls, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/tab-marks': '2.0.0-2e84cd1e' });
