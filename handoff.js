/* handoff.js — передача файлов между инструментами imgtools (через IndexedDB).
   API:
     sendTo(page, items)  — items: массив Blob/File или {blob, name}; сохраняет и переходит на страницу
     takeHandoff()        — Promise<File[] | null>; забирает переданные файлы (одноразово)         */
(function () {
  'use strict';
  var DB = 'imgtools-handoff', STORE = 'kv', KEY = 'pending';

  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function tx(db, mode, fn) {
    return new Promise(function (res, rej) {
      var t = db.transaction(STORE, mode);
      var out = fn(t.objectStore(STORE));
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
      t.onerror = function () { rej(t.error); };
    });
  }

  window.sendTo = async function (page, items) {
    var payload = items.map(function (it) {
      var blob = (it instanceof Blob) ? it : it.blob;
      var name = (it instanceof Blob)
        ? (it.name || ('file.' + ((blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'))))
        : it.name;
      return { name: name, type: blob.type || 'application/octet-stream', blob: blob };
    });
    var db = await openDB();
    await tx(db, 'readwrite', function (s) { return s.put(payload, KEY); });
    location.href = page;
  };

  window.takeHandoff = async function () {
    var db = await openDB();
    var val = await new Promise(function (res, rej) {
      var t = db.transaction(STORE, 'readwrite');
      var g = t.objectStore(STORE).get(KEY);
      g.onsuccess = function () { res(g.result); };
      g.onerror = function () { rej(g.error); };
    });
    if (!val) return null;
    await tx(db, 'readwrite', function (s) { return s.delete(KEY); });
    return val.map(function (f) { return new File([f.blob], f.name, { type: f.type }); });
  };
})();
