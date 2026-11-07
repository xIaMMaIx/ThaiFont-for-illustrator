// คัดลอก opentype.js จาก node_modules มาไว้ที่ libs/ (panel โหลดจาก libs เพราะ CEP ไม่มีขั้น build)
//   npm install && npm run vendor
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = require.resolve('opentype.js/dist/opentype.min.js', { paths: [ROOT] });
const dst = path.join(ROOT, 'libs', 'opentype.min.js');
const ver = require(path.join(path.dirname(src), '..', 'package.json')).version;
const same = fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src));
if (!same) fs.copyFileSync(src, dst);
console.log('opentype.js ' + ver + (same ? ' — libs/ is up to date' : ' — copied to libs/opentype.min.js'));
