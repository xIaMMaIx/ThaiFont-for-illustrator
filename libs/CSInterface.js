/**
 * CSInterface (subset) — Adobe CEP bridge
 * ส่วนที่ปลั๊กอินนี้ใช้: evalScript, event listener, host environment (ธีม), system path, เปิดลิงก์
 * อิงตาม API ของ CSInterface.js ทางการ (CEP 9+) เพื่อให้แทนกันได้ทันที
 */
(function (root) {
  'use strict';

  function CSEvent(type, scope, appId, extensionId) {
    this.type = type; this.scope = scope; this.appId = appId; this.extensionId = extensionId; this.data = '';
  }

  var SystemPath = {
    USER_DATA: 'userData', COMMON_FILES: 'commonFiles', MY_DOCUMENTS: 'myDocuments',
    APPLICATION: 'application', EXTENSION: 'extension', HOST_APPLICATION: 'hostApplication'
  };

  function CSInterface() {}
  CSInterface.THEME_COLOR_CHANGED_EVENT = 'com.adobe.csxs.events.ThemeColorChanged';

  function cep() { return root.__adobe_cep__; }

  CSInterface.prototype.isAvailable = function () { return !!cep(); };

  CSInterface.prototype.getHostEnvironment = function () {
    if (!cep()) return null;
    try { return JSON.parse(cep().getHostEnvironment()); } catch (e) { return null; }
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    if (!cep()) { if (callback) callback('EvalScript error.'); return; }
    cep().evalScript(script, callback || function () {});
  };

  CSInterface.prototype.addEventListener = function (type, listener, obj) {
    if (cep() && cep().addEventListener) cep().addEventListener(type, listener, obj);
  };

  CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    if (cep() && cep().removeEventListener) cep().removeEventListener(type, listener, obj);
  };

  CSInterface.prototype.dispatchEvent = function (event) {
    if (!cep()) return;
    if (typeof event.data === 'object') event.data = JSON.stringify(event.data);
    cep().dispatchEvent(event);
  };

  CSInterface.prototype.getOSInformation = function () {
    var ua = navigator.userAgent;
    if (ua.indexOf('Windows') >= 0) return 'Windows';
    if (ua.indexOf('Mac') >= 0) return 'Mac OS X';
    return 'Unknown';
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    if (!cep()) return '';
    var path = decodeURI(cep().getSystemPath(pathType));
    var os = this.getOSInformation();
    if (os.indexOf('Windows') >= 0) path = path.replace('file:///', '');
    else if (os.indexOf('Mac') >= 0) path = path.replace('file://', '');
    return path;
  };

  CSInterface.prototype.getExtensionID = function () {
    return cep() && cep().getExtensionId ? cep().getExtensionId() : '';
  };

  CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    if (root.cep && root.cep.util) return root.cep.util.openURLInDefaultBrowser(url);
    root.open(url, '_blank');
  };

  root.CSInterface = CSInterface;
  root.CSEvent = CSEvent;
  root.SystemPath = SystemPath;
})(window);
