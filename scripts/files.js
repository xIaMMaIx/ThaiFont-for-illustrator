// รายการไฟล์ที่ต้องมีในส่วนขยายที่ติดตั้งแล้ว (ใช้ร่วมกันโดย package.js และการทดสอบ)
// ถ้าแก้ตรงนี้ ให้แก้รายการใน install-windows.bat / install-mac.command ให้ตรงกันด้วย (tests/install-check.js ตรวจให้)
module.exports = {
  dirs: ['CSXS', 'src', 'libs', 'icons'],
  files: ['index.html', 'styles.css', 'hostScript.jsx'],
  installers: ['install-windows.bat', 'uninstall-windows.bat', 'install-mac.command', 'uninstall-mac.command']
};
