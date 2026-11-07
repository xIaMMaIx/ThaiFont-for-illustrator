/**
 * UI controls — ตัวควบคุมขนาดเล็กแบบ Illustrator
 *  scrub(): ป้ายชื่อลากซ้าย-ขวาเพื่อเปลี่ยนค่า + ช่องตัวเลข (↑↓ ทีละ 1, Shift ทีละ 10)
 */
(function (root) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x != null && e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x));
      else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function scrub(o) {
    const step = o.step || 1;
    const min = o.min != null ? o.min : -9999, max = o.max != null ? o.max : 9999;
    const dec = o.decimals || (step < 1 ? 2 : 0);
    let value = Number(o.value) || 0;
    const input = el('input', { type: 'text', inputmode: 'decimal', 'aria-label': o.label });
    const lab = el('span', { class: 'sl', title: o.title || 'ลากซ้าย-ขวาเพื่อปรับค่า' }, o.label);
    const wrap = el('div', { class: 'scrub' + (o.cls ? ' ' + o.cls : '') }, lab, input, o.unit != null ? el('span', { class: 'unit' }, o.unit) : null);
    const fmt = v => (dec ? v.toFixed(dec) : String(Math.round(v)));
    function render() {
      input.value = fmt(value);
      wrap.classList.toggle('changed', o.base != null && Math.abs(value - o.base) > 1e-9);
    }
    function set(v, fire) {
      v = clamp(Math.round(v / step) * step, min, max);
      if (dec) v = Number(v.toFixed(dec));
      const changed = v !== value; value = v; render();
      if (fire && changed && o.onInput) o.onInput(value);
    }
    input.addEventListener('change', () => { const v = parseFloat(input.value); set(isNaN(v) ? value : v, true); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        set(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
      } else if (e.key === 'Enter') input.blur();
    });
    lab.addEventListener('mousedown', e => {
      e.preventDefault();
      const x0 = e.clientX, v0 = value;
      const move = ev => set(v0 + Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1), true);
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); if (o.onCommit) o.onCommit(value); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    lab.addEventListener('dblclick', () => { if (o.base != null) set(o.base, true); });
    render();
    return { el: wrap, set: v => set(v, false), get: () => value, input };
  }

  function seg(container, items, value, onChange) {
    container.innerHTML = '';
    const btns = items.map(it => {
      const b = el('button', { type: 'button', title: it.title || '' }, it.label);
      b.addEventListener('click', () => { api.set(it.v); onChange(it.v); });
      container.appendChild(b);
      return { b, v: it.v };
    });
    const api = { set: v => btns.forEach(x => x.b.classList.toggle('on', String(x.v) === String(v))) };
    api.set(value);
    return api;
  }

  /** ผูก segmented control ที่มีปุ่มอยู่แล้วใน HTML (data-v / data-set) */
  function bindSeg(container, attr, value, onChange) {
    const btns = Array.prototype.slice.call(container.querySelectorAll('button'));
    const set = v => btns.forEach(b => b.classList.toggle('on', b.getAttribute(attr) === String(v)));
    btns.forEach(b => b.addEventListener('click', () => { set(b.getAttribute(attr)); onChange(b.getAttribute(attr)); }));
    set(value);
    return { set };
  }

  let toastTimer = null;
  function toast(text, opts) {
    opts = opts || {};
    const t = $('toast'), btn = $('toastBtn');
    $('toastText').textContent = text;
    t.classList.toggle('err', !!opts.error);
    if (opts.action) {
      btn.textContent = opts.action.label; btn.classList.remove('hidden');
      btn.onclick = () => { opts.action.fn(); t.classList.add('off'); };
    } else btn.classList.add('hidden');
    t.classList.remove('off');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('off'), opts.ms || (opts.error ? 7000 : 3500));
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
    d.flush = () => { clearTimeout(t); fn(); };
    return d;
  }

  /** กล่องยืนยันในแผง (window.confirm ใช้ไม่ได้แน่นอนใน CEP) · คืน Promise<boolean> · Enter = ยืนยัน, Esc/คลิกนอกกล่อง = ยกเลิก
   *  opts: { title, text, ok, cancel (false = ไม่มีปุ่มยกเลิก), danger } */
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      const okBtn = el('button', { class: 'btn ' + (opts.danger ? 'danger' : 'primary') }, opts.ok || 'ตกลง');
      const noBtn = el('button', { class: 'btn' }, opts.cancel || 'ยกเลิก');
      const box = el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
        opts.title ? el('h3', null, opts.title) : null,
        opts.text ? el('p', null, opts.text) : null,
        el('div', { class: 'dialog-actions' }, opts.cancel === false ? null : noBtn, okBtn));
      const back = el('div', { class: 'dialog-back' }, box);
      const done = v => {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) { }
        resolve(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      okBtn.onclick = () => done(true);
      noBtn.onclick = () => done(false);
      back.addEventListener('mousedown', e => { if (e.target === back) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      okBtn.focus();
    });
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    return e;
  }

  root.UI = { $, el, scrub, seg, bindSeg, toast, debounce, svgEl, clamp, confirmDialog };
})(window);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'ui-controls': '2.0.0-cba108e5' });
