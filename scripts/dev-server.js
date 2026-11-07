// เปิด panel ในเบราว์เซอร์ (โหมดจำลอง ไม่ต้องมี Illustrator):  npm run dev  → http://localhost:5178
//   http://localhost:5178/?fixture   โหลดตัวอักษรตัวอย่างจากฟอนต์ไทยในเครื่อง (สร้าง tests/out/fixture.js ครั้งแรก)
const http = require('http'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5178;
const FIXTURE = path.join(ROOT, 'tests', 'out', 'fixture.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.otf': 'font/otf', '.ttf': 'font/ttf' };

function ensureFixture() {
  if (fs.existsSync(FIXTURE)) return true;
  const T = require('../tests/_lib');
  const font = T.findFont();
  if (!font) { console.warn('ไม่พบฟอนต์ไทยสำหรับสร้าง fixture (ตั้ง TFS_TEST_FONT)'); return false; }
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  cp.execFileSync(process.execPath, [path.join(ROOT, 'tests', 'make-fixture.js'), font, FIXTURE], { stdio: 'inherit' });
  return true;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  let body = fs.readFileSync(file);
  if (rel === 'index.html' && url.searchParams.has('fixture') && ensureFixture()) {
    body = Buffer.from(body.toString('utf8').replace('<script src="libs/CSInterface.js">', '<script src="tests/out/fixture.js"></script>\n<script src="libs/CSInterface.js">'));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log('Thai Font Studio (mock) → http://localhost:' + PORT + '/?fixture'));
