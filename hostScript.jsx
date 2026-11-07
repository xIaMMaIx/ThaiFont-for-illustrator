/**
 * Thai Font Studio — Illustrator host script (ExtendScript / ES3)
 *
 * ทุกฟังก์ชันอยู่ใต้ namespace TFS และคืนค่าเป็น JSON string
 * Panel ส่ง argument เป็น JSON literal (ปลอดภัยจากอักขระพิเศษ)
 *
 * โครงสร้างเอกสาร:
 *   Layer "Guides & Info (Locked)"  เส้นไกด์ (ล็อก)
 *   Layer "glyph_U+0E01" ...         1 ตัวอักษร = 1 Layer
 *   Layer "_TFS Data"               เก็บค่าตั้งค่าโปรเจกต์ (ซ่อน, ไม่พิมพ์)
 */
var TFS = (function () {
    var VERSION = '2.0.0';
    var BUILD = '2.0.0-1b04fcfe';
    var GUIDE_LAYER = 'Guides & Info (Locked)';
    var DATA_LAYER = '_TFS Data';
    var TEMP_LAYER = '_TFS temp';
    var SETTINGS_ITEM = 'TFS_Settings';
    var DEFAULT_CFG = { em: 800, baseline: 200, cap: 560, ascender: 650, descender: 100, lsbGuide: 120, rsbGuide: 680 };

    // ------------------------------------------------------------------ JSON
    function q(s) {
        s = String(s);
        var out = '"';
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), code = s.charCodeAt(i);
            if (c === '"') out += '\\"';
            else if (c === '\\') out += '\\\\';
            else if (code < 32 || code === 0x2028 || code === 0x2029) {
                var h = code.toString(16);
                while (h.length < 4) h = '0' + h;
                out += '\\u' + h;
            } else out += c;
        }
        return out + '"';
    }
    function json(v) {
        if (v === null || v === undefined) return 'null';
        var t = typeof v;
        if (t === 'number') return isFinite(v) ? String(Math.round(v * 100) / 100) : 'null';
        if (t === 'boolean') return v ? 'true' : 'false';
        if (t === 'string') return q(v);
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(json(v[i]));
            return '[' + a.join(',') + ']';
        }
        var parts = [];
        for (var k in v) if (v.hasOwnProperty(k)) parts.push(q(k) + ':' + json(v[k]));
        return '{' + parts.join(',') + '}';
    }
    function ok(data) { return json({ ok: true, data: data }); }
    function fail(msg) { return json({ ok: false, error: String(msg) }); }

    // --------------------------------------------------------------- helpers
    function hasDoc() { return app.documents.length > 0; }
    function cfgOf(c) {
        var out = {};
        for (var k in DEFAULT_CFG) if (DEFAULT_CFG.hasOwnProperty(k)) out[k] = (c && c[k] !== undefined) ? c[k] : DEFAULT_CFG[k];
        return out;
    }
    /** getByName ค้นในตัว Illustrator เอง เร็วกว่าวนอ่าน .name ทีละ Layer มาก (เอกสารฟอนต์มีได้หลายร้อย Layer) */
    function findLayer(doc, name) {
        try { return doc.layers.getByName(name); } catch (e) { return null; }
    }
    function getOrCreateLayer(doc, name) {
        var l = findLayer(doc, name);
        if (l) return l;
        l = doc.layers.add();
        l.name = name;
        return l;
    }
    function rgb(r, g, b) { var c = new RGBColor(); c.red = r; c.green = g; c.blue = b; return c; }
    function isGlyphLayer(l) { return l.name.indexOf('glyph_') === 0; }

    var thaiFont = null;
    function pickThaiFont() {
        if (thaiFont !== null) return thaiFont;
        var names = ['LeelawadeeUI', 'Leelawadee', 'Tahoma', 'Thonburi', 'SukhumvitSet-Text', 'ArialUnicodeMS'];
        thaiFont = false;
        for (var i = 0; i < names.length; i++) {
            try { thaiFont = app.textFonts.getByName(names[i]); break; } catch (e) { }
        }
        return thaiFont;
    }

    function isWhite(color) {
        try {
            if (!color) return false;
            var t = color.typename;
            if (t === 'RGBColor') return color.red > 245 && color.green > 245 && color.blue > 245;
            if (t === 'GrayColor') return color.gray < 3;
            if (t === 'CMYKColor') return color.cyan < 3 && color.magenta < 3 && color.yellow < 3 && color.black < 3;
            if (t === 'SpotColor') return color.tint < 3;
        } catch (e) { }
        return false;
    }

    // ---------------------------------------------------------------- guides
    function drawLine(layer, x1, y1, x2, y2, w, col, dash) {
        var p = layer.pathItems.add();
        p.setEntirePath([[x1, y1], [x2, y2]]);
        p.filled = false; p.stroked = true; p.strokeWidth = w; p.strokeColor = col;
        if (dash) p.strokeDashes = dash;
        return p;
    }
    function label(layer, text, x, y, size, col, name) {
        var t = layer.textFrames.add();
        t.contents = text;
        t.position = [x, y];
        t.textRange.characterAttributes.size = size;
        t.textRange.characterAttributes.fillColor = col;
        var f = pickThaiFont();
        if (f) { try { t.textRange.characterAttributes.textFont = f; } catch (e) { } }
        if (name) t.name = name;
        return t;
    }

    function buildGuides(doc, c, force) {
        var gl = findLayer(doc, GUIDE_LAYER);
        var created = false;
        var prevActive = doc.activeLayer;
        if (!gl) { gl = doc.layers.add(); gl.name = GUIDE_LAYER; created = true; }
        if (!created && !force && gl.pathItems.length >= 9) { gl.visible = true; gl.locked = true; return 'EXISTS'; }
        gl.locked = false; gl.visible = true;
        gl.pageItems.removeAll();
        var em = c.em;
        var green = rgb(34, 160, 90), blue = rgb(59, 120, 230), red = rgb(220, 70, 70), purple = rgb(150, 85, 230),
            amber = rgb(215, 150, 20), sky = rgb(40, 150, 210), grey = rgb(150, 150, 155), orange = rgb(240, 120, 30);
        drawLine(gl, 0, c.baseline, em, c.baseline, 1.5, green);
        drawLine(gl, 0, c.cap, em, c.cap, 1, blue);
        drawLine(gl, 0, c.ascender, em, c.ascender, 0.75, red);
        drawLine(gl, 0, c.descender, em, c.descender, 0.75, purple);
        drawLine(gl, 0, (c.baseline + c.cap) / 2, em, (c.baseline + c.cap) / 2, 0.5, sky, [4, 4]);
        drawLine(gl, c.lsbGuide, 0, c.lsbGuide, em, 0.6, amber, [2, 3]);
        drawLine(gl, c.rsbGuide, 0, c.rsbGuide, em, 0.6, amber, [2, 3]);
        drawLine(gl, c.lsbGuide + (c.rsbGuide - c.lsbGuide) / 3, 0, c.lsbGuide + (c.rsbGuide - c.lsbGuide) / 3, em, 0.4, grey, [2, 4]);
        drawLine(gl, c.lsbGuide + 2 * (c.rsbGuide - c.lsbGuide) / 3, 0, c.lsbGuide + 2 * (c.rsbGuide - c.lsbGuide) / 3, em, 0.4, grey, [2, 4]);
        var tallY = c.cap + Math.max(20, 0.25 * (c.ascender - c.cap));
        var tall = drawLine(gl, 0, tallY, em, tallY, 0.6, orange, [6, 3]);
        tall.name = 'TallStemGuide'; tall.hidden = true;

        var H = c.cap - c.baseline;
        label(gl, 'Ascender +' + (c.ascender - c.baseline), 8, c.ascender + 11, 8, red);
        label(gl, 'Cap / หัวตัวอักษร +' + H, 8, c.cap + 11, 8, blue);
        label(gl, 'Baseline 0', 8, c.baseline + 11, 8, green);
        label(gl, 'Descender ' + (c.descender - c.baseline), 8, c.descender - 3, 8, purple);
        var tl = label(gl, 'หางสูงเกินเส้นนี้ = ระบบหลบสระให้อัตโนมัติ', em - 210, tallY + 11, 7, orange, 'TallStemLabel');
        tl.hidden = true;
        label(gl, ' ', 8, em - 12, 14, rgb(60, 60, 65), 'ActiveGlyphTitle');
        label(gl, ' ', 8, em - 30, 8, grey, 'ActiveGlyphHint');
        gl.zOrder(ZOrderMethod.BRINGTOFRONT);
        gl.locked = true;
        if (prevActive && prevActive !== gl) { try { doc.activeLayer = prevActive; } catch (e) { } }
        return 'CREATED';
    }

    function setHeader(doc, title, hint, showTall) {
        var gl = findLayer(doc, GUIDE_LAYER);
        if (!gl) return;
        gl.locked = false;
        try {
            for (var i = 0; i < gl.pageItems.length; i++) {
                var it = gl.pageItems[i];
                if (it.name === 'ActiveGlyphTitle' && it.contents !== (title || ' ')) it.contents = title || ' ';
                else if (it.name === 'ActiveGlyphHint' && it.contents !== (hint || ' ')) it.contents = hint || ' ';
                else if ((it.name === 'TallStemGuide' || it.name === 'TallStemLabel') && it.hidden !== !showTall) it.hidden = !showTall;
            }
        } catch (e) { }
        gl.locked = true;
    }

    // ----------------------------------------------------------- art walking
    function emptyWarn() { return { strokes: 0, text: 0, image: 0, other: 0, clip: 0, white: 0 }; }

    function pushPath(p, list, gid, warn, styleSrc) {
        if (p.guides) return;
        var src = styleSrc || p;
        var pts = p.pathPoints;
        if (!pts || pts.length < 1) return;   // จุดเดียวก็นับ (เช่น จุดที่จิ้มด้วย Brush)
        var arr = [];
        for (var i = 0; i < pts.length; i++) {
            var pp = pts[i];
            arr.push([pp.anchor[0], pp.anchor[1], pp.leftDirection[0], pp.leftDirection[1], pp.rightDirection[0], pp.rightDirection[1]]);
        }
        var filled = false, stroked = false, sw = 0, eo = false, white = false;
        try { filled = !!src.filled; } catch (e1) { }
        try { stroked = !!src.stroked && src.strokeWidth > 0; sw = stroked ? src.strokeWidth : 0; } catch (e2) { }
        try { eo = !!src.evenodd; } catch (e3) { }
        try { white = filled && isWhite(src.fillColor); } catch (e4) { }
        // Brush (เช่น Calligraphic 3pt × น้ำหนัก 21) จะหนากว่า strokeWidth — ใช้ขนาดที่มองเห็นจริงแทน
        if (stroked) {
            try {
                var gb = p.geometricBounds, vb = p.visibleBounds;
                var ew = Math.max((vb[2] - vb[0]) - (gb[2] - gb[0]), (vb[1] - vb[3]) - (gb[1] - gb[3]));
                if (ew > sw * 1.2) sw = ew;
            } catch (e5) { }
            warn.strokes++;
        }
        if (white) warn.white++;
        list.push({ p: arr, c: !!p.closed, f: filled, s: stroked, sw: sw, g: gid, eo: eo, w: white });
    }

    function walk(container, list, warn, counter) {
        var items = container.pageItems;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            try { if (it.hidden) continue; } catch (e) { }
            var t = it.typename;
            if (t === 'PathItem') {
                if (it.clipping) { warn.clip++; continue; }
                pushPath(it, list, -1, warn, null);
            } else if (t === 'CompoundPathItem') {
                var gid = counter.n++;
                var subs = it.pathItems;
                var style = subs.length ? subs[0] : null;
                for (var j = 0; j < subs.length; j++) pushPath(subs[j], list, gid, warn, style);
            } else if (t === 'GroupItem') {
                walk(it, list, warn, counter);
            } else if (t === 'TextFrame') warn.text++;
            else if (t === 'PlacedItem' || t === 'RasterItem') warn.image++;
            else warn.other++;
        }
        if (container.layers) {
            for (var k = 0; k < container.layers.length; k++) {
                if (container.layers[k].visible) walk(container.layers[k], list, warn, counter);
            }
        }
    }

    function layerHasArt(l) {
        if (!l) return false;
        try {
            for (var i = 0; i < l.pageItems.length; i++) {
                var it = l.pageItems[i];
                if (!it.guides && !it.hidden) return true;
            }
            for (var k = 0; k < l.layers.length; k++) if (layerHasArt(l.layers[k])) return true;
        } catch (e) { }
        return false;
    }

    /** ลายเซ็นสั้น ๆ ของ Layer — เปลี่ยนเมื่อมีการแก้เส้น (ใช้แทนการดึงเส้นทั้งหมดทุกวินาที) */
    function signatureOf(l) {
        if (!l) return '';
        var s = [];
        function rec(c) {
            for (var i = 0; i < c.pageItems.length; i++) {
                var it = c.pageItems[i];
                var t = it.typename;
                if (t === 'GroupItem') { s.push('g'); rec(it); continue; }
                var b = it.geometricBounds;
                var n = 0;
                try {
                    if (t === 'PathItem') n = it.pathPoints.length;
                    else if (t === 'CompoundPathItem') for (var j = 0; j < it.pathItems.length; j++) n += it.pathItems[j].pathPoints.length;
                } catch (e) { }
                s.push(t.charAt(0) + n + ':' + Math.round(b[0] * 10) + ',' + Math.round(b[1] * 10) + ',' + Math.round(b[2] * 10) + ',' + Math.round(b[3] * 10) + (it.hidden ? 'h' : ''));
            }
        }
        try { rec(l); } catch (e) { return 'err'; }
        return s.join('|');
    }

    function glyphLayer(doc, code) { return findLayer(doc, 'glyph_' + code); }

    // Layer ตัวอักษรที่ switchGlyph เปิดไว้ล่าสุด — ครั้งถัดไปซ่อนแค่ตัวนี้แทนการวนทุก Layer
    // ล้างเมื่อเปลี่ยนเอกสารหรือ scanAll (ปุ่มอ่านใหม่) เพื่อกลับไปซ่อนแบบครบทุก Layer อีกรอบ
    var shown = { doc: null, names: null };
    function docKey(doc) {
        try { return doc.fullName.fsName; } catch (e) { }
        try { return doc.name; } catch (e2) { }
        return '';
    }

    // ---------------------------------------------------- expand (export)
    function needsExpand(warn) { return warn.strokes > 0 || warn.text > 0 || warn.other > 0; }

    function rawOutline(l) {
        var list = [], warn = emptyWarn();
        walk(l, list, warn, { n: 0 });
        return { paths: list, warn: warn };
    }

    /** ลบสำเนาที่ไม่มีขนาด/กลุ่มว่าง/ไกด์ ก่อนสั่ง Expand/Offset — ของพวกนี้ทำให้ Illustrator ฟ้อง "Bounding Box ... Error:PARM" */
    function pruneDegenerate(layer) {
        for (var i = layer.pageItems.length - 1; i >= 0; i--) {
            var it = layer.pageItems[i], bad = false;
            try {
                if (it.guides) bad = true;
                else if (it.typename === 'GroupItem' && it.pageItems.length === 0) bad = true;
                else {
                    var b = it.geometricBounds;
                    if (!(isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3]))) bad = true;
                    else if (Math.abs(b[2] - b[0]) < 0.001 && Math.abs(b[1] - b[3]) < 0.001) bad = true;
                }
            } catch (e) { bad = true; }
            if (bad) { try { it.remove(); } catch (e2) { } }
        }
    }

    /** ทำสำเนาชั่วคราว → Expand Appearance → Outline Stroke → อ่านเส้น → ลบสำเนา */
    function expandedOutline(doc, l) {
        var savedSel = [];
        try { for (var s = 0; s < doc.selection.length; s++) savedSel.push(doc.selection[s]); } catch (e) { }
        var activeLayer = doc.activeLayer;
        var wasLocked = l.locked, wasVisible = l.visible;
        l.locked = false; l.visible = true;
        var tmp = doc.layers.add(); tmp.name = TEMP_LAYER; tmp.visible = true; tmp.locked = false;
        var result;
        try {
            for (var i = l.pageItems.length - 1; i >= 0; i--) {
                var it = l.pageItems[i];
                if (!it.hidden) it.duplicate(tmp, ElementPlacement.PLACEATBEGINNING);
            }
            for (var t = tmp.textFrames.length - 1; t >= 0; t--) { try { tmp.textFrames[t].createOutline(); } catch (e1) { } }
            pruneDegenerate(tmp);
            for (var y = tmp.symbolItems.length - 1; y >= 0; y--) { try { tmp.symbolItems[y].breakLink(); } catch (e2) { } }
            doc.selection = null;
            for (var a = 0; a < tmp.pageItems.length; a++) tmp.pageItems[a].selected = true;
            try { app.executeMenuCommand('expandStyle'); } catch (e3) { }
            doc.selection = null;
            for (var b = 0; b < tmp.pageItems.length; b++) tmp.pageItems[b].selected = true;
            try { app.executeMenuCommand('OffsetPath v22'); } catch (e4) { }
            doc.selection = null;
            result = rawOutline(tmp);
        } finally {
            try { tmp.remove(); } catch (e5) { }
            l.locked = wasLocked; l.visible = wasVisible;
            try { doc.activeLayer = activeLayer; } catch (e6) { }
            try { doc.selection = savedSel.length ? savedSel : null; } catch (e7) { }
        }
        return result;
    }

    // ================================================================= API
    var api = {};

    api.ping = function () {
        return ok({ version: VERSION, build: BUILD, hasDoc: hasDoc(), app: app.version });
    };

    api.docInfo = function () {
        if (!hasDoc()) return ok({ hasDoc: false });
        var doc = app.activeDocument, n = 0;
        for (var i = 0; i < doc.layers.length; i++) if (isGlyphLayer(doc.layers[i])) n++;
        var path = '';
        try { path = doc.fullName.fsName; } catch (e) { }
        return ok({
            hasDoc: true, name: doc.name, path: path, saved: doc.saved,
            isProject: !!findLayer(doc, GUIDE_LAYER) || n > 0, glyphLayers: n,
            activeLayer: doc.activeLayer ? doc.activeLayer.name : ''
        });
    };

    /** สร้างเอกสารใหม่ (หรือใช้เอกสารปัจจุบันถ้าเป็นโปรเจกต์อยู่แล้ว) */
    api.setup = function (cfg, useActive) {
        try {
            var c = cfgOf(cfg), doc;
            if (useActive && hasDoc()) {
                doc = app.activeDocument;
            } else {
                doc = app.documents.add(DocumentColorSpace.RGB, c.em, c.em);
                try { doc.layers[0].name = 'Reference (ไม่ถูกส่งออก)'; } catch (eName) { }
            }
            doc.artboards[0].artboardRect = [0, c.em, c.em, 0];
            buildGuides(doc, c, false);
            try { app.executeMenuCommand('fitin'); } catch (e) { }
            return ok({ name: doc.name });
        } catch (err) { return fail(err); }
    };

    api.ensureGuides = function (cfg, force) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            return ok(buildGuides(app.activeDocument, cfgOf(cfg), !!force));
        } catch (err) { return fail(err); }
    };

    /** สลับไปวาดตัวอักษร: ซ่อน Layer อื่น เปิด Layer นี้ */
    api.switchGlyph = function (code, title, hint, flags, cfg) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var doc = app.activeDocument;
            if (!findLayer(doc, GUIDE_LAYER)) buildGuides(doc, cfgOf(cfg), false);
            var target = glyphLayer(doc, code);
            var key = docKey(doc);
            if (shown.doc === key && shown.names) {
                // ทางลัด: ซ่อนเฉพาะ Layer ที่ panel เปิดไว้ครั้งก่อน + Layer ที่ active อยู่ (ไม่ต้องวนทุก Layer)
                var act = doc.activeLayer;
                if (act && isGlyphLayer(act) && act !== target) shown.names[act.name] = true;
                for (var n in shown.names) {
                    if (!shown.names.hasOwnProperty(n)) continue;
                    var sl = findLayer(doc, n);
                    if (sl && sl !== target && sl.visible) sl.visible = false;
                }
            } else {
                for (var i = 0; i < doc.layers.length; i++) {
                    var l = doc.layers[i];
                    if (isGlyphLayer(l) && l !== target && l.visible) l.visible = false;
                }
            }
            if (!target) {
                target = doc.layers.add();
                target.name = 'glyph_' + code;
            }
            target.visible = true;
            target.locked = false;
            doc.activeLayer = target;
            shown.doc = key; shown.names = {}; shown.names[target.name] = true;
            setHeader(doc, title || code, hint || '', !!(flags && flags.tall));
            return ok({ hasArt: layerHasArt(target), sig: signatureOf(target) });
        } catch (err) { return fail(err); }
    };

    api.signature = function (code) {
        if (!hasDoc()) return ok({ hasDoc: false });
        var l = glyphLayer(app.activeDocument, code);
        return ok({ hasDoc: true, hasArt: layerHasArt(l), sig: signatureOf(l), active: app.activeDocument.activeLayer.name });
    };

    api.scanAll = function () {
        try {
            if (!hasDoc()) return ok({});
            var doc = app.activeDocument, res = {};
            shown.doc = null; shown.names = null;
            for (var i = 0; i < doc.layers.length; i++) {
                var l = doc.layers[i];
                if (isGlyphLayer(l)) res[l.name.substring(6)] = layerHasArt(l);
            }
            return ok(res);
        } catch (err) { return fail(err); }
    };

    /** ดึงเส้นของหลายตัวอักษร  expand=true: แปลง stroke/ข้อความ/symbol เป็นรูปทรงจริงก่อน (ใช้ตอน export) */
    api.getOutlines = function (codes, expand) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var doc = app.activeDocument, res = {};
            for (var i = 0; i < codes.length; i++) {
                var l = glyphLayer(doc, codes[i]);
                if (!l) { res[codes[i]] = { paths: [], warn: emptyWarn(), sig: '' }; continue; }
                var r = rawOutline(l);
                if (expand && needsExpand(r.warn)) {
                    var e = expandedOutline(doc, l);
                    e.warn.expandedFrom = r.warn;
                    r = e;
                }
                r.sig = signatureOf(l);
                res[codes[i]] = r;
            }
            return ok(res);
        } catch (err) { return fail(err); }
    };

    /** แปลง stroke ใน Layer จริงเป็นรูปทรง (ปุ่มในหน้า panel) */
    api.outlineStrokesInPlace = function (code) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var doc = app.activeDocument, l = glyphLayer(doc, code);
            if (!l) return fail('NO_LAYER');
            l.locked = false; l.visible = true;
            for (var t = l.textFrames.length - 1; t >= 0; t--) { try { l.textFrames[t].createOutline(); } catch (e1) { } }
            doc.selection = null;
            for (var a = 0; a < l.pageItems.length; a++) if (!l.pageItems[a].hidden) l.pageItems[a].selected = true;
            try { app.executeMenuCommand('expandStyle'); } catch (e2) { }
            doc.selection = null;
            for (var b = 0; b < l.pageItems.length; b++) if (!l.pageItems[b].hidden) l.pageItems[b].selected = true;
            try { app.executeMenuCommand('OffsetPath v22'); } catch (e3) { }
            return ok({ sig: signatureOf(l) });
        } catch (err) { return fail(err); }
    };

    function setPathPoints(pi, pts) {
        var anchors = [];
        for (var i = 0; i < pts.length; i++) anchors.push([pts[i][0], pts[i][1]]);
        pi.setEntirePath(anchors);
        var pp = pi.pathPoints;
        for (var k = 0; k < pts.length && k < pp.length; k++) {
            var p = pts[k];
            if (p[2] !== p[0] || p[3] !== p[1]) pp[k].leftDirection = [p[2], p[3]];
            if (p[4] !== p[0] || p[5] !== p[1]) pp[k].rightDirection = [p[4], p[5]];
        }
        pi.closed = true;
    }

    /** นำเข้าเส้นเป็นชุด: batch = [{code, paths:[{p:[...]}]}] */
    api.importGlyphs = function (batch, replace) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var doc = app.activeDocument, black = rgb(20, 20, 22), done = 0;
            for (var i = 0; i < batch.length; i++) {
                var g = batch[i];
                var l = getOrCreateLayer(doc, 'glyph_' + g.code);
                l.locked = false; l.visible = true;
                if (layerHasArt(l) && !replace) { l.visible = false; continue; }
                l.pageItems.removeAll();
                if (!g.paths || !g.paths.length) { l.visible = false; continue; }
                var comp = l.compoundPathItems.add();
                for (var c = 0; c < g.paths.length; c++) {
                    var pi = comp.pathItems.add();
                    setPathPoints(pi, g.paths[c].p);
                }
                try {
                    comp.pathItems[0].filled = true; comp.pathItems[0].fillColor = black; comp.pathItems[0].stroked = false;
                } catch (e) { }
                l.visible = false;
                done++;
            }
            return ok({ imported: done });
        } catch (err) { return fail(err); }
    };

    /** ตัดเชิง ญ / ฐ อัตโนมัติด้วย Pathfinder Crop (ตัดส่วนใต้ Baseline ออก) */
    api.autoCut = function (srcCode, dstCode, cfg) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var c = cfgOf(cfg), doc = app.activeDocument;
            var src = glyphLayer(doc, srcCode);
            if (!src || !layerHasArt(src)) return fail('SOURCE_EMPTY');
            var dst = getOrCreateLayer(doc, 'glyph_' + dstCode);
            dst.locked = false; dst.visible = true;
            dst.pageItems.removeAll();
            var srcLocked = src.locked, srcVisible = src.visible; src.locked = false; src.visible = true;
            for (var i = src.pageItems.length - 1; i >= 0; i--) {
                if (!src.pageItems[i].hidden) src.pageItems[i].duplicate(dst, ElementPlacement.PLACEATBEGINNING);
            }
            src.locked = srcLocked; src.visible = srcVisible;
            var cutY = c.baseline + 1;
            var method = 'crop';
            try {
                var grp = dst.groupItems.add();
                for (var k = dst.pageItems.length - 1; k >= 0; k--) {
                    var it = dst.pageItems[k];
                    if (it !== grp) it.move(grp, ElementPlacement.PLACEATEND);
                }
                var top = c.em * 2;
                var rect = grp.pathItems.rectangle(top, -c.em, c.em * 3, top - cutY);
                rect.move(grp, ElementPlacement.PLACEATBEGINNING);
                rect.filled = true; rect.stroked = false;
                doc.selection = null; grp.selected = true;
                app.executeMenuCommand('Live Pathfinder Crop');
                app.executeMenuCommand('expandStyle');
                doc.selection = null;
                var gb = null;
                for (var m = 0; m < dst.pageItems.length; m++) {
                    var b = dst.pageItems[m].geometricBounds;
                    gb = gb ? [Math.min(gb[0], b[0]), Math.max(gb[1], b[1]), Math.max(gb[2], b[2]), Math.min(gb[3], b[3])] : b;
                }
                if (!gb || gb[3] < cutY - 2 || gb[0] < -c.em / 2) throw new Error('crop-check');
            } catch (eCrop) {
                // วิธีสำรอง: ลบชิ้นที่อยู่ใต้ Baseline ทั้งชิ้น
                method = 'contour';
                dst.pageItems.removeAll();
                src.visible = true;
                for (var j = src.pageItems.length - 1; j >= 0; j--) {
                    if (!src.pageItems[j].hidden) src.pageItems[j].duplicate(dst, ElementPlacement.PLACEATBEGINNING);
                }
                src.visible = srcVisible;
                var paths = [];
                for (var p = 0; p < dst.pathItems.length; p++) paths.push(dst.pathItems[p]);
                for (var cp = 0; cp < dst.compoundPathItems.length; cp++) {
                    var subs = dst.compoundPathItems[cp].pathItems;
                    for (var s2 = 0; s2 < subs.length; s2++) paths.push(subs[s2]);
                }
                for (var r = paths.length - 1; r >= 0; r--) {
                    try { if (paths[r].geometricBounds[1] < cutY + 3) paths[r].remove(); } catch (e2) { }
                }
            }
            doc.activeLayer = dst;
            return ok({ method: method, sig: signatureOf(dst) });
        } catch (err) { return fail(err); }
    };

    // ------------------------------------------------------ place selection
    /** Layer ระดับบนสุดที่ item อยู่ (item.layer อาจเป็น sublayer) */
    function topLayerOf(it) {
        var l = null;
        try { l = it.layer; } catch (e) { }
        try { while (l && l.parent && l.parent.typename === 'Layer') l = l.parent; } catch (e2) { }
        return l;
    }

    /**
     * คัดลอกเส้นที่เลือกบน Canvas ไปใส่ Layer ของตัวอักษร แล้วย่อขยาย/จัดตำแหน่งให้
     * opts: { scale: อัตราที่ใช้ร่วมกันทุกตัว (0 = ยังไม่ตั้ง), refH: ความสูงที่ตัวนี้ควรเป็น (0 = ใช้ตั้งอัตราไม่ได้),
     *         keepSize: ไม่ย่อขยาย, cx: กึ่งกลางแนวนอน, y + anchor ('bottom'|'top'): จุดยึดแนวตั้ง,
     *         replace: แทนที่เส้นเดิม, dim: ทำต้นฉบับให้จางลง (ถ้าไม่ได้อยู่ใน Layer ตัวอักษร) }
     */
    api.placeSelection = function (code, opts) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            opts = opts || {};
            var doc = app.activeDocument, sel = doc.selection;
            if (sel && sel.typename === 'TextRange') return fail('TEXT_EDITING');
            var items = [], skipped = 0;
            for (var i = 0; sel && i < sel.length; i++) {
                var t = sel[i].typename;
                if (t === 'TextRange') return fail('TEXT_EDITING');
                if (t === 'RasterItem' || t === 'PlacedItem') { skipped++; continue; }   // ภาพสแกนต้นฉบับ ไม่ใช่เส้น
                items.push(sel[i]);
            }
            if (!items.length) return fail(skipped ? 'ONLY_IMAGES' : 'NO_SELECTION');

            var target = glyphLayer(doc, code);
            for (var s = 0; s < items.length; s++) {
                if (target && topLayerOf(items[s]) === target) return fail('SELECTION_IN_TARGET');
            }
            if (target && layerHasArt(target) && !opts.replace) return fail('HAS_ART');
            if (!target) { target = doc.layers.add(); target.name = 'glyph_' + code; }
            target.locked = false; target.visible = true;
            if (opts.replace) target.pageItems.removeAll();

            var grp = target.groupItems.add();
            grp.name = 'placed';
            for (var d = 0; d < items.length; d++) items[d].duplicate(grp, ElementPlacement.PLACEATEND);
            var b = grp.geometricBounds, w = b[2] - b[0], h = b[1] - b[3];
            if (!(w > 0.01 || h > 0.01)) { grp.remove(); return fail('EMPTY'); }

            var scale = opts.scale > 0 ? opts.scale : 0, newScale = false;
            if (opts.keepSize) scale = 1;
            else if (!scale) {
                if (opts.refH > 0 && h > 0.5) { scale = opts.refH / h; newScale = true; }
                else scale = 1;
            }
            if (Math.abs(scale - 1) > 0.0001) {
                var pct = scale * 100;
                grp.resize(pct, pct, true, true, true, true, pct, Transformation.CENTER);
                b = grp.geometricBounds;
            }
            var dx = (opts.cx !== undefined ? opts.cx : 0) - (b[0] + b[2]) / 2;
            var dy = opts.y === undefined ? 0 : (opts.anchor === 'top' ? opts.y - b[1] : opts.y - b[3]);
            grp.translate(dx, dy);

            if (opts.dim) {
                for (var m = 0; m < items.length; m++) {
                    try { var tl = topLayerOf(items[m]); if (!tl || !isGlyphLayer(tl)) items[m].opacity = 35; } catch (eDim) { }
                }
            }
            try { doc.selection = null; } catch (eSel) { }
            doc.activeLayer = target;
            return ok({ sig: signatureOf(target), scale: scale, newScale: newScale, skipped: skipped, items: items.length });
        } catch (err) { return fail(err); }
    };

    // ------------------------------------------------------------- settings
    function settingsItem(doc, create) {
        var l = findLayer(doc, DATA_LAYER);
        if (!l) {
            if (!create) return null;
            var prevActive = doc.activeLayer;
            l = doc.layers.add(); l.name = DATA_LAYER;
            try { l.zOrder(ZOrderMethod.SENDTOBACK); } catch (e) { }
            try { doc.activeLayer = prevActive; } catch (e0) { }
        }
        var wasLocked = l.locked;
        l.locked = false;
        var item = null;
        for (var i = 0; i < l.pathItems.length; i++) if (l.pathItems[i].name === SETTINGS_ITEM) { item = l.pathItems[i]; break; }
        if (!item && create) {
            item = l.pathItems.rectangle(-10, -10, 1, 1);
            item.name = SETTINGS_ITEM; item.filled = false; item.stroked = false;
        }
        return { layer: l, item: item, wasLocked: wasLocked };
    }

    api.saveSettings = function (str) {
        try {
            if (!hasDoc()) return fail('NO_DOC');
            var doc = app.activeDocument;
            var s = settingsItem(doc, true);
            var tag = null;
            try { tag = s.item.tags.getByName(SETTINGS_ITEM); } catch (e) { tag = s.item.tags.add(); tag.name = SETTINGS_ITEM; }
            if (tag.value !== str) tag.value = str;
            s.layer.visible = false; s.layer.printable = false; s.layer.locked = true;
            return ok(true);
        } catch (err) { return fail(err); }
    };

    api.loadSettings = function () {
        try {
            if (!hasDoc()) return ok(null);
            var s = settingsItem(app.activeDocument, false);
            if (!s || !s.item) return ok(null);
            var v = null;
            try { v = s.item.tags.getByName(SETTINGS_ITEM).value; } catch (e) { }
            s.layer.locked = true;
            return ok(v);
        } catch (err) { return fail(err); }
    };

    // ---------------------------------------------------------------- files
    api.saveDialog = function (defaultName) {
        try {
            var filter = ($.os.indexOf('Windows') >= 0) ? 'OpenType Font:*.otf' : function (f) { return f instanceof Folder || /\.otf$/i.test(f.name); };
            var f = new File(Folder.desktop + '/' + defaultName).saveDlg('บันทึกไฟล์ฟอนต์ (.otf)', filter);
            return ok(f ? f.fsName : null);
        } catch (err) { return fail(err); }
    };

    api.revealFile = function (path) {
        try {
            var f = new File(path);
            if (!f.exists) return fail('NOT_FOUND');
            f.parent.execute();
            return ok(true);
        } catch (err) { return fail(err); }
    };

    api.fitView = function () { try { app.executeMenuCommand('fitin'); } catch (e) { } return ok(true); };

    // คำสั่งหนัก (ที่สั่งเมนู/แก้เอกสาร) รันแบบไม่เด้งกล่องเตือนของ Illustrator — ข้อผิดพลาดถูกจับใน try/catch แล้วใช้วิธีสำรองแทน
    // คำสั่งเบาที่ panel เรียกซ้ำ ๆ (signature/docInfo) ไม่แตะ userInteractionLevel
    (function () {
        var heavy = ['getOutlines', 'outlineStrokesInPlace', 'importGlyphs', 'autoCut', 'placeSelection'];
        for (var h = 0; h < heavy.length; h++) {
            if (typeof api[heavy[h]] !== 'function') continue;
            (function (name, fn) {
                api[name] = function () {
                    var prev = null;
                    try { prev = app.userInteractionLevel; app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (e0) { prev = null; }
                    try { return fn.apply(this, arguments); }
                    finally { try { if (prev !== null) app.userInteractionLevel = prev; } catch (e1) { } }
                };
            })(heavy[h], api[heavy[h]]);
        }
    })();

    api.BUILD = BUILD;   // panel เทียบกับค่า build ของตัวเอง แล้วโหลดไฟล์นี้ใหม่ถ้าไม่ตรง (อัปเดตแล้วไม่ต้องปิด Illustrator)
    return api;
})();
