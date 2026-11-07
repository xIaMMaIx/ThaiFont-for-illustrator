/**
 * แถบทดสอบด้านล่าง — ข้อความทดสอบ/ชุดข้อความสำเร็จรูป, ขนาด, ย่อ/ขยาย และลากปรับความสูง
 * (ฟอนต์ทดลองสร้างใน core.js → buildPreview)
 */
(function () {
  'use strict';
  const { $, el } = window.UI;
  const A = window.TFSApp;
  const { S, store, saveSettings } = A;

  // ข้อความสำเร็จรูปสำหรับทดสอบในแถบพรีวิว
  const PREVIEW_PRESETS = [
    { id: 'stack', label: 'สระ/วรรณยุกต์ซ้อน', words: ['กิ่ง กี่ กึ๋น กื้อ', 'ปิ่น ผี่ ผู้ ปู่ นั้น', 'เกี่ยว เสี่ยง เรื่อง เสื้อ เลี้ยง', 'น้ำ ก๋ำ ค่ำ ซ้ำ ทำ', 'ซึ่ง สิ้น ขึ้น ผึ้ง กิ๊ก', 'กรุ๊ป ปั๊ม ตั๋ว บั๊ก', 'ก่ ก้ ก๊ ก๋ ก์ กั่ กิ๋'] },
    { id: 'tail', label: 'หลบหาง', words: ['ปั่น ปี่ ปู่ ป่า ป้า ป๊อป', 'ฝั่ง ฝึก ฝ้าย ฝี่ ฝ่า', 'ฟัง ฟื้น ฟ้า ฟี่ ฟิ้ว ฟ๊อก', 'ฬ ฬา กีฬา จุฬา ฬิ ฬี่', 'ปั ฝั ฟั ผั ฝั่ง ปัญญา', 'ผู้ ผึ้ง ฝึ่ง ฟ่อน ป้อน'] },
    { id: 'foot', label: 'เชิง/พินทุ', words: ['เชิง เชิญ เชี่ยว เชื้อ', 'ฐ ญ ฎ ฏ ฐาน ญาติ', 'ญุ ฐู ฎุ ฏู ปัญญา', 'พุทธ ธรรม บัณฑิต ปฏิบัติ', 'ธมฺม พุทฺธ กิญฺจิ สมฺมา', 'ฐิติ ฎีกา ฏิ ชฎา ปฏิญญา'] },
    { id: 'sentence', label: 'ประโยค', words: ['ที่นี่ปู่ผู้ใหญ่ ก่อสร้างปิ่นโต ฝ้ายฟ้อนรำ น้ำใจ', 'นายสังฆภัณฑ์ เฮงพิทักษ์ฝั่งชล ผู้เฒ่าซึ่งมีอาชีพเป็นฅนขายฃวด', 'ถูกตำรวจปฏิบัติการจับฟ้องศาล ฐานลักนาฬิกาคุณหญิงฉัตรชฎา'] },
    { id: 'kern', label: 'Kerning ทดสอบ', words: ['To Ta Te Tr Tu Ty Tw', 'Th Tl Tb Tk Tt Td Ti Tf', 'AV VA AW WA AY YA', 'Yo Ya We Wa Vo Va', 'Fa Fe Fo Pa Pe Po Ke', 'rn rm vv ww yo ye', 'LT LV LY TA VA AT', 'Te. Ta, Yo, P. F.'] },
    { id: 'lower', label: 'ตัวเล็ก a-z', words: ['abcdefghijklm', 'nopqrstuvwxyz', 'hamburgefonstiv', 'the quick brown fox jumps over the lazy dog', 'minimum illinois rhythm', 'nn oo nono rn m vv ww ij fi fl'] },
    { id: 'upper', label: 'ตัวใหญ่ A-Z', words: ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'HAMBURGEFONSTIV', 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', 'AVATAR WAVY TOYOTA LTV', 'HOHOH NONO OOO HEHE'] },
    { id: 'mixed', label: 'อังกฤษผสม/เลข', words: ['Hamburgefonstiv', 'The Quick Brown Fox Jumps Over the Lazy Dog', 'To Ty Wa Ye Va Av Te Yo', '0123456789', 'Hello, World! (2026) #1 @ 50% & more?', '1 + 2 − 3 ± 4 × 5 ÷ 6 = 7', '1 ≠ 2 ≤ 3 ≥ 4 ≈ 5', 'ที่นี่ Thai + English ผสม 123'] }
  ];

  function renderPresets() {
    const sel = $('presetCat'), box = $('presetChips'), u = S().ui;  // u อ่านใหม่ทุกครั้ง (ตั้งค่าอาจถูกโหลดใหม่)
    if (!sel.options.length) {
      PREVIEW_PRESETS.forEach(c => sel.appendChild(el('option', { value: c.id }, c.label)));
      sel.onchange = () => { S().ui.presetCat = sel.value; saveSettings(); renderPresets(); };
    }
    const cat = PREVIEW_PRESETS.find(c => c.id === u.presetCat) || PREVIEW_PRESETS[0];
    sel.value = cat.id;
    box.innerHTML = '';
    const cur = $('previewText').value;
    const pick = text => ev => {
      const inp = $('previewText');
      inp.value = ev.shiftKey && inp.value ? inp.value + ' ' + text : text;
      u.previewText = inp.value; applyPreviewText(); saveSettings(); renderPresets();
    };
    const all = cat.words.join(' ');
    const mk = (text, cls, label) => el('button', { type: 'button', class: 'chip ' + cls + (cur === text ? ' on' : ''), title: text + '\n(คลิกเพื่อทดสอบ · Shift+คลิกเพื่อต่อท้าย)', onclick: pick(text) }, label || text);
    box.appendChild(mk(all, 'all', 'ทั้งชุด'));
    cat.words.forEach(w => box.appendChild(mk(w, '')));
  }

  function applyPreviewText() {
    const out = $('previewOut');
    out.textContent = $('previewText').value || ' ';
    out.style.fontSize = $('previewSize').value + 'px';
  }

  function bind() {
    const s = S();
    $('previewText').value = s.ui.previewText; $('previewSize').value = s.ui.previewSize;
    if ($('presetCat')) renderPresets();
    applyPreviewText();
  }

  function wire() {
    $('previewText').oninput = () => { S().ui.previewText = $('previewText').value; applyPreviewText(); saveSettings(); renderPresets(); };
    $('previewSize').oninput = () => { S().ui.previewSize = Number($('previewSize').value); applyPreviewText(); saveSettings(); };
    renderPresets();
    $('btnDock').onclick = () => $('dock').classList.toggle('collapsed');
    // ลากแถบคั่นเพื่อปรับความสูงพื้นที่ทดสอบ (จำค่าไว้)
    const dock = $('dock'), split = $('dockSplit');
    const apply = h => { if (h) dock.style.setProperty('--dock-h', Math.round(h) + 'px'); else dock.style.removeProperty('--dock-h'); };
    const saved = Number(store.get('tfsDockH')); if (saved > 0) apply(saved);
    split.addEventListener('mousedown', e => {
      e.preventDefault();
      const y0 = e.clientY, h0 = dock.getBoundingClientRect().height, maxH = window.innerHeight * 0.82;
      split.classList.add('drag');
      let h = h0;
      const move = ev => { h = Math.max(110, Math.min(maxH, h0 - (ev.clientY - y0))); apply(h); };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); split.classList.remove('drag');
        store.set('tfsDockH', String(Math.round(h)));
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    split.addEventListener('dblclick', () => { apply(0); store.remove('tfsDockH'); });
  }

  A.tabs.dock = { bind, wire };
})();
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'app/dock': '2.0.0-1b04fcfe' });
