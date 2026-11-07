/**
 * Glyph sets & classification — ชุดอักขระไทย / อังกฤษ / ตัวเลข-สัญลักษณ์
 *
 * kind:
 *   base         ตัวอักษรที่มีความกว้าง (พยัญชนะ สระหน้า ตัวเลข ฯลฯ)
 *   mark-top     สระบน (ั ิ ี ึ ื ็ ํ)
 *   mark-tone    วรรณยุกต์และเครื่องหมายบน (่ ้ ๊ ๋ ์ ๎)
 *   mark-bottom  สระล่าง (ุ ู ฺ)
 *   auto         สร้างอัตโนมัติ (ำ)
 * group: ใช้จัดหมวดใน Grid
 */
(function (root) {
  'use strict';

  function g(char, name, code, group, kind, extra) {
    return Object.assign({ char, name, code, group, kind, status: 'missing' }, extra || {});
  }
  const C = (char, name, code, extra) => g(char, name, code, 'consonant', 'base', Object.assign({ thaiConsonant: true }, extra || {}));

  const THAI_GLYPHS = [
    C('ก', 'ก.ไก่', 'U+0E01'), C('ข', 'ข.ไข่', 'U+0E02'), C('ฃ', 'ฃ.ขวด', 'U+0E03'),
    C('ค', 'ค.ควาย', 'U+0E04'), C('ฅ', 'ฅ.คน', 'U+0E05'), C('ฆ', 'ฆ.ระฆัง', 'U+0E06'),
    C('ง', 'ง.งู', 'U+0E07'), C('จ', 'จ.จาน', 'U+0E08'), C('ฉ', 'ฉ.ฉิ่ง', 'U+0E09'),
    C('ช', 'ช.ช้าง', 'U+0E0A'), C('ซ', 'ซ.โซ่', 'U+0E0B'), C('ฌ', 'ฌ.เฌอ', 'U+0E0C'),
    C('ญ', 'ญ.หญิง', 'U+0E0D', { cutTail: true }), C('ฎ', 'ฎ.ชฎา', 'U+0E0E', { longDescender: true }),
    C('ฏ', 'ฏ.ปฏัก', 'U+0E0F', { longDescender: true }), C('ฐ', 'ฐ.ฐาน', 'U+0E10', { cutTail: true }),
    C('ฑ', 'ฑ.มณโฑ', 'U+0E11'), C('ฒ', 'ฒ.ผู้เฒ่า', 'U+0E12'), C('ณ', 'ณ.เณร', 'U+0E13'),
    C('ด', 'ด.เด็ก', 'U+0E14'), C('ต', 'ต.เต่า', 'U+0E15'), C('ถ', 'ถ.ถุง', 'U+0E16'),
    C('ท', 'ท.ทหาร', 'U+0E17'), C('ธ', 'ธ.ธง', 'U+0E18'), C('น', 'น.หนู', 'U+0E19'),
    C('บ', 'บ.ใบไม้', 'U+0E1A'), C('ป', 'ป.ปลา', 'U+0E1B', { tallStem: true }), C('ผ', 'ผ.ผึ้ง', 'U+0E1C'),
    C('ฝ', 'ฝ.ฝา', 'U+0E1D', { tallStem: true }), C('พ', 'พ.พาน', 'U+0E1E'), C('ฟ', 'ฟ.ฟัน', 'U+0E1F', { tallStem: true }),
    C('ภ', 'ภ.สำเภา', 'U+0E20'), C('ม', 'ม.ม้า', 'U+0E21'), C('ย', 'ย.ยักษ์', 'U+0E22'),
    C('ร', 'ร.เรือ', 'U+0E23'), C('ฤ', 'ฤ', 'U+0E24', { longDescender: true }), C('ล', 'ล.ลิง', 'U+0E25'),
    C('ฦ', 'ฦ', 'U+0E26', { longDescender: true }), C('ว', 'ว.แหวน', 'U+0E27'), C('ศ', 'ศ.ศาลา', 'U+0E28'),
    C('ษ', 'ษ.ฤๅษี', 'U+0E29'), C('ส', 'ส.เสือ', 'U+0E2A'), C('ห', 'ห.หีบ', 'U+0E2B'),
    C('ฬ', 'ฬ.จุฬา', 'U+0E2C', { tallStem: true }), C('อ', 'อ.อ่าง', 'U+0E2D'), C('ฮ', 'ฮ.นกฮูก', 'U+0E2E'),

    // ตัวแปรตัดเชิง (ใช้กับสระล่าง) — เก็บใน Layer ตามรหัส PUA แบบเดิม
    g('ญ', 'ญ ตัดเชิง', 'U+F70F', 'consonant', 'base', { isCutVariant: true, baseCode: 'U+0E0D', glyphName: 'uni0E0D.short', thaiConsonant: true }),
    g('ฐ', 'ฐ ตัดฐาน', 'U+F700', 'consonant', 'base', { isCutVariant: true, baseCode: 'U+0E10', glyphName: 'uni0E10.short', thaiConsonant: true }),

    // สระ
    g('ะ', 'สระอะ', 'U+0E30', 'vowel', 'base'),
    g('ั', 'ไม้หันอากาศ', 'U+0E31', 'vowel', 'mark-top'),
    g('า', 'สระอา', 'U+0E32', 'vowel', 'base'),
    g('ำ', 'สระอำ', 'U+0E33', 'vowel', 'auto', { isAutoCompound: true, autoComponents: ['U+0E4D', 'U+0E32'] }),
    g('ิ', 'สระอิ', 'U+0E34', 'vowel', 'mark-top'),
    g('ี', 'สระอี', 'U+0E35', 'vowel', 'mark-top'),
    g('ึ', 'สระอึ', 'U+0E36', 'vowel', 'mark-top'),
    g('ื', 'สระอือ', 'U+0E37', 'vowel', 'mark-top'),
    g('ุ', 'สระอุ', 'U+0E38', 'vowel', 'mark-bottom'),
    g('ู', 'สระอู', 'U+0E39', 'vowel', 'mark-bottom'),
    g('ฺ', 'พินทุ', 'U+0E3A', 'vowel', 'mark-bottom'),
    g('เ', 'สระเอ', 'U+0E40', 'vowel', 'base', { leadingVowel: true }),
    g('แ', 'สระแอ', 'U+0E41', 'vowel', 'base', { leadingVowel: true }),
    g('โ', 'สระโอ', 'U+0E42', 'vowel', 'base', { leadingVowel: true, tallLeading: true }),
    g('ใ', 'ไม้ม้วน', 'U+0E43', 'vowel', 'base', { leadingVowel: true, tallLeading: true }),
    g('ไ', 'ไม้มลาย', 'U+0E44', 'vowel', 'base', { leadingVowel: true, tallLeading: true }),
    g('ๅ', 'ลากข้างยาว', 'U+0E45', 'vowel', 'base'),
    g('็', 'ไม้ไต่คู้', 'U+0E47', 'vowel', 'mark-top'),
    g('ํ', 'นิคหิต', 'U+0E4D', 'vowel', 'mark-top', { stackBase: true }),

    // วรรณยุกต์
    g('่', 'ไม้เอก', 'U+0E48', 'tone', 'mark-tone'),
    g('้', 'ไม้โท', 'U+0E49', 'tone', 'mark-tone'),
    g('๊', 'ไม้ตรี', 'U+0E4A', 'tone', 'mark-tone'),
    g('๋', 'ไม้จัตวา', 'U+0E4B', 'tone', 'mark-tone'),
    g('์', 'ทัณฑฆาต', 'U+0E4C', 'tone', 'mark-tone'),
    g('๎', 'ยามักการ', 'U+0E4E', 'tone', 'mark-tone'),

    // ตัวเลขและเครื่องหมายไทย
    g('๐', 'เลข ๐', 'U+0E50', 'digit', 'base'), g('๑', 'เลข ๑', 'U+0E51', 'digit', 'base'),
    g('๒', 'เลข ๒', 'U+0E52', 'digit', 'base'), g('๓', 'เลข ๓', 'U+0E53', 'digit', 'base'),
    g('๔', 'เลข ๔', 'U+0E54', 'digit', 'base'), g('๕', 'เลข ๕', 'U+0E55', 'digit', 'base'),
    g('๖', 'เลข ๖', 'U+0E56', 'digit', 'base'), g('๗', 'เลข ๗', 'U+0E57', 'digit', 'base'),
    g('๘', 'เลข ๘', 'U+0E58', 'digit', 'base'), g('๙', 'เลข ๙', 'U+0E59', 'digit', 'base'),
    g('ฯ', 'ไปยาลน้อย', 'U+0E2F', 'thai-symbol', 'base'),
    g('ๆ', 'ไม้ยมก', 'U+0E46', 'thai-symbol', 'base'),
    g('฿', 'สัญลักษณ์บาท', 'U+0E3F', 'thai-symbol', 'base'),
    g('๏', 'ฟองมัน', 'U+0E4F', 'thai-symbol', 'base'),
    g('๚', 'อังคั่นคู่', 'U+0E5A', 'thai-symbol', 'base'),
    g('๛', 'โคมูตร', 'U+0E5B', 'thai-symbol', 'base')
  ];

  const AGL = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '!': 'exclam', '?': 'question', '(': 'parenleft', ')': 'parenright',
    '-': 'hyphen', '"': 'quotedbl', "'": 'quotesingle', '/': 'slash', '@': 'at', '#': 'numbersign', '%': 'percent', '&': 'ampersand',
    '*': 'asterisk', '+': 'plus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright', '$': 'dollar', '<': 'less', '>': 'greater',
    '_': 'underscore', '~': 'asciitilde', '{': 'braceleft', '}': 'braceright', '|': 'bar', '\\': 'backslash', '^': 'asciicircum', '`': 'grave'
  };

  function latin(c, group) {
    const code = 'U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    return g(c, c, code, group, 'base', { glyphName: AGL[c] || c });
  }

  const ENGLISH_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => latin(c, 'latin-upper'));
  const ENGLISH_LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('').map(c => latin(c, 'latin-lower'));
  const NUMBERS_AND_PUNCT = '0123456789'.split('').map(c => latin(c, 'digit'))
    .concat('.,:;!?\'"()[]{}-_/\\@#$%&*+=<>|~^`'.split('').map(c => latin(c, 'punct')));

  // สัญลักษณ์คณิตศาสตร์ (ชุดหลัก) — กว้าง/สูงเท่า + = เพื่อให้เรียงในสมการแล้วเข้ากัน
  const MATH = [
    ['−', 'ลบ', 'U+2212', 'minus'], ['±', 'บวกหรือลบ', 'U+00B1', 'plusminus'], ['×', 'คูณ', 'U+00D7', 'multiply'],
    ['÷', 'หาร', 'U+00F7', 'divide'], ['≠', 'ไม่เท่ากับ', 'U+2260', 'notequal'], ['≤', 'น้อยกว่าหรือเท่ากับ', 'U+2264', 'lessequal'],
    ['≥', 'มากกว่าหรือเท่ากับ', 'U+2265', 'greaterequal'], ['≈', 'ประมาณเท่ากับ', 'U+2248', 'approxequal']
  ].map(m => g(m[0], m[1], m[2], 'math', 'base', { glyphName: m[3] }));
  NUMBERS_AND_PUNCT.push.apply(NUMBERS_AND_PUNCT, MATH);

  const GROUP_LABELS = {
    'consonant': 'พยัญชนะ', 'vowel': 'สระ', 'tone': 'วรรณยุกต์', 'digit': 'ตัวเลข', 'thai-symbol': 'เครื่องหมายไทย',
    'latin-upper': 'ตัวพิมพ์ใหญ่', 'latin-lower': 'ตัวพิมพ์เล็ก', 'punct': 'เครื่องหมาย', 'math': 'คณิตศาสตร์'
  };

  const SETS = {
    thai: { label: 'ไทย', glyphs: THAI_GLYPHS },
    latin: { label: 'อังกฤษ', glyphs: ENGLISH_UPPER.concat(ENGLISH_LOWER) },
    symbols: { label: 'ตัวเลข/สัญลักษณ์', glyphs: NUMBERS_AND_PUNCT }
  };

  const ALL_GLYPHS = THAI_GLYPHS.concat(ENGLISH_UPPER, ENGLISH_LOWER, NUMBERS_AND_PUNCT);
  const BY_CODE = {};
  ALL_GLYPHS.forEach(x => { BY_CODE[x.code] = x; });

  function codeToInt(code) { return parseInt(String(code).replace('U+', ''), 16); }
  function intToCode(u) { return 'U+' + u.toString(16).toUpperCase().padStart(4, '0'); }
  function glyphName(def) {
    if (def.glyphName) return def.glyphName;
    return 'uni' + def.code.replace('U+', '');
  }
  function isMark(def) { return def && (def.kind === 'mark-top' || def.kind === 'mark-tone' || def.kind === 'mark-bottom'); }
  function findByChar(ch) {
    for (let i = 0; i < ALL_GLYPHS.length; i++) {
      const d = ALL_GLYPHS[i];
      if (d.char === ch && !d.isCutVariant) return d;
    }
    return null;
  }

  const GlyphData = {
    THAI_GLYPHS, ENGLISH_UPPER, ENGLISH_LOWER, NUMBERS_AND_PUNCT, ALL_GLYPHS, BY_CODE, SETS, GROUP_LABELS,
    codeToInt, intToCode, glyphName, isMark, findByChar
  };
  root.GlyphData = GlyphData;
  if (typeof module !== 'undefined' && module.exports) module.exports = GlyphData;
})(typeof window !== 'undefined' ? window : globalThis);
;(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { 'glyph-data': '2.0.0-cba108e5' });
