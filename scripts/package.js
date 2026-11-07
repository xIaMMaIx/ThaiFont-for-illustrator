// สร้างชุดติดตั้งสำหรับแจกจ่าย:  npm run package
//   dist/ThaiFontStudio-<version>/            โฟลเดอร์พร้อมใช้ (install-*.bat/.command + IllusFont/)
//   dist/ThaiFontStudio-<version>.zip         ไฟล์ zip ของโฟลเดอร์ด้านบน
//   dist/ThaiFontStudio-<version>.zxp         (ถ้าตั้งค่า ZXP_CERT + ZXP_PASS และมี ZXPSignCmd) — ติดตั้งได้โดยไม่ต้องเปิด PlayerDebugMode
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const LIST = require('./files');
const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;

// ไม่ปล่อยชุดติดตั้งที่ stamp ไม่ตรง (panel จะขึ้นเตือนไฟล์ไม่ตรงเวอร์ชัน)
cp.execFileSync(process.execPath, [path.join(__dirname, 'stamp.js'), '--check'], { stdio: 'inherit' });

const name = 'ThaiFontStudio-' + version;
const dist = path.join(ROOT, 'dist');
const out = path.join(dist, name);
const ext = path.join(out, 'IllusFont');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(ext, { recursive: true });

LIST.dirs.forEach(d => fs.cpSync(path.join(ROOT, d), path.join(ext, d), { recursive: true }));
LIST.files.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(ext, f)));
LIST.installers.concat(['README.md']).forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(out, f)));
LIST.installers.filter(f => /\.command$/.test(f)).forEach(f => fs.chmodSync(path.join(out, f), 0o755));

const zip = path.join(dist, name + '.zip');
fs.rmSync(zip, { force: true });
try {
  // bsdtar (มีใน Windows 10+ และ macOS) เขียน zip ได้ด้วย -a
  cp.execFileSync('tar', ['-a', '-cf', zip, name], { cwd: dist, stdio: 'inherit' });
  console.log('zip  ' + path.relative(ROOT, zip));
} catch (e) {
  console.warn('! สร้าง zip ไม่ได้ (' + e.message + ') — ใช้โฟลเดอร์ ' + path.relative(ROOT, out) + ' แทน');
}

const { ZXP_CERT, ZXP_PASS } = process.env;
const signCmd = process.env.ZXP_SIGN_CMD || 'ZXPSignCmd';
if (ZXP_CERT && ZXP_PASS) {
  const zxp = path.join(dist, name + '.zxp');
  fs.rmSync(zxp, { force: true });
  cp.execFileSync(signCmd, ['-sign', ext, zxp, ZXP_CERT, ZXP_PASS, '-tsa', process.env.ZXP_TSA || 'http://timestamp.digicert.com'], { stdio: 'inherit' });
  console.log('zxp  ' + path.relative(ROOT, zxp));
} else {
  console.log('(ข้าม .zxp — ตั้ง ZXP_CERT และ ZXP_PASS เพื่อเซ็นชื่อ ดู README หัวข้อ "แจกจ่าย")');
}
console.log('dir  ' + path.relative(ROOT, out));
