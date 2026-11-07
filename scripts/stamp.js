// เขียนเลขเวอร์ชัน/ค่า build ให้ทุกไฟล์ตรงกัน (แหล่งเดียวคือ package.json "version")
//   node scripts/stamp.js           อัปเดตไฟล์
//   node scripts/stamp.js --check   ตรวจอย่างเดียว (ใช้ใน npm test) — ออกด้วย code 1 ถ้ายังไม่ได้ stamp
//
// ค่า build = <version>-<hash 8 ตัวของเนื้อหา src/**/*.js + hostScript.jsx>
// panel ใช้ค่านี้ตรวจว่าไฟล์ที่ติดตั้งเป็นชุดเดียวกัน และโหลด hostScript.jsx ใหม่เมื่อไม่ตรงกับที่ Illustrator จำไว้
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');

const STAMP_RE = /\n?;\(typeof window !== 'undefined' \? window : globalThis\)\.TFS_BUILD = [^\n]*\n?$/;
const HOST_BUILD_RE = /var BUILD = '[^']*';/;
const HOST_VERSION_RE = /var VERSION = '[^']*';/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.js$/.test(d.name) ? [p] : [];
  }).sort();
}
const read = p => fs.readFileSync(p, 'utf8');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

const version = JSON.parse(read(path.join(ROOT, 'package.json'))).version;
const srcFiles = walk(path.join(ROOT, 'src'));
const hostPath = path.join(ROOT, 'hostScript.jsx');
const manifestPath = path.join(ROOT, 'CSXS', 'manifest.xml');

const strip = s => s.replace(STAMP_RE, '\n');
const h = crypto.createHash('sha1');
// เนื้อหาที่ hash ไม่รวมบรรทัด stamp/BUILD/VERSION เอง และไม่สนช่องว่างท้ายไฟล์ — รันซ้ำจึงได้ค่าเดิม
srcFiles.forEach(f => { h.update(rel(f)); h.update(strip(read(f)).replace(/\s*$/, '')); });
h.update(read(hostPath).replace(/\n[ \t]*var BUILD = '[^']*';/, '').replace(HOST_VERSION_RE, ''));
const build = version + '-' + h.digest('hex').slice(0, 8);

const want = new Map();
srcFiles.forEach(f => {
  const key = rel(f).replace(/^src\//, '').replace(/\.js$/, '');
  const line = ";(typeof window !== 'undefined' ? window : globalThis).TFS_BUILD = Object.assign((typeof window !== 'undefined' ? window : globalThis).TFS_BUILD || {}, { '" + key + "': '" + build + "' });\n";
  want.set(f, strip(read(f)).replace(/\s*$/, '\n') + line);
});
let host = read(hostPath).replace(HOST_VERSION_RE, "var VERSION = '" + version + "';");
host = HOST_BUILD_RE.test(host) ? host.replace(HOST_BUILD_RE, "var BUILD = '" + build + "';")
  : host.replace(HOST_VERSION_RE, m => m + "\n    var BUILD = '" + build + "';");
want.set(hostPath, host);
want.set(manifestPath, read(manifestPath)
  .replace(/ExtensionBundleVersion="[^"]*"/, 'ExtensionBundleVersion="' + version + '"')
  .replace(/(<Extension Id="[^"]+" Version=")[^"]*"/, '$1' + version + '"'));

const stale = [];
want.forEach((content, f) => {
  if (read(f) === content) return;
  stale.push(rel(f));
  if (!check) fs.writeFileSync(f, content);
});
if (check) {
  if (stale.length) { console.log('✗ build stamp ไม่ตรง — รัน `npm run stamp`:\n  ' + stale.join('\n  ')); process.exit(1); }
  console.log('stamp OK (' + build + ')');
} else console.log('build ' + build + (stale.length ? ' · updated ' + stale.length + ' file(s)' : ' · nothing to update'));
