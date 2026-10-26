/* heic.js — HEIC/HEIF (фото с iPhone) для браузеров, которые его не читают сами.

   Порядок: сначала пробуем родное декодирование браузера (Safari, Chrome с HEVC-кодеком ОС) — оно быстрее и учитывает
   цветовой профиль; если не вышло — декодируем libheif (wasm) в воркере heic-worker.js. Декодер подгружается только
   при первом HEIC-файле.

   API (window.HeicDecode):
     hinted(file)      → boolean: похоже на HEIC по имени/MIME (синхронно)
     sniff(file)       → Promise<boolean>: в начале файла действительно HEIF-контейнер с HEVC/HEIC-брендом
     decode(file)      → Promise<{ width, height, hasAlpha, buffer }> (RGBA) — только wasm
     load(file)        → Promise<{ source, width, height, method }>: source — Image или canvas, пригодный для drawImage
     prepare(file)     → Promise<{ file, converted, width, height }>: либо исходный файл (браузер читает сам),
                          либо JPEG/PNG-копия (для частей сайта, работающих с Image по URL) */
(function () {
  'use strict';

  var NAME_RE = /\.(heic|heif|hif)$/i, TYPE_RE = /^image\/hei[cf]/i;
  var HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
  var AVIF_BRANDS = ['avif', 'avis'];                     // AVIF браузеры читают сами, в наш декодер не отправляем

  function hinted(file) { return !!file && (NAME_RE.test(file.name || '') || TYPE_RE.test(file.type || '')); }

  async function sniff(file) {
    var u8 = new Uint8Array(await file.slice(0, 96).arrayBuffer());
    if (u8.length < 16 || String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) !== 'ftyp') return false;
    var size = Math.min(u8.length, ((u8[0] << 24) | (u8[1] << 16) | (u8[2] << 8) | u8[3]) >>> 0 || u8.length);
    var brands = [];
    for (var o = 8; o + 4 <= size; o += (o === 8 ? 8 : 4)) {            // major (8), minor version (12) пропускаем, дальше совместимые
      brands.push(String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]));
    }
    if (AVIF_BRANDS.indexOf(brands[0]) >= 0) return false;
    return brands.some(function (b) { return HEIC_BRANDS.indexOf(b) >= 0; });
  }

  // Обрезанный файл (оборвавшаяся загрузка/копирование): заявленный размер верхнеуровневого блока выходит за конец файла.
  // Без этой проверки libheif молча отдаёт «наполовину пустую» картинку — это хуже честной ошибки.
  async function truncated(file) {
    var pos = 0, total = file.size;
    while (pos + 8 <= total) {
      var dv = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      var len = dv.getUint32(0);
      if (len === 1) {                                           // 64-битный размер: ещё 8 байт
        if (dv.byteLength < 16) return true;
        len = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
      } else if (len === 0) return false;                        // блок «до конца файла»
      if (len < 8) return false;                                 // нестандартная разметка — пусть решает декодер
      if (pos + len > total) return true;
      pos += len;
    }
    return false;
  }

  async function decode(file) {
    if (await truncated(file)) throw new Error('файл обрезан или повреждён (загружен не полностью)');
    return file.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        var w;
        try { w = new Worker('heic-worker.js'); } catch (e) { return reject(new Error('не удалось запустить декодер HEIC')); }
        var done = function () { try { w.terminate(); } catch (e) { /* не критично */ } };
        w.onmessage = function (ev) {
          done();
          if (ev.data.ok) resolve(ev.data); else reject(new Error(ev.data.error));
        };
        w.onerror = function (ev) { done(); reject(new Error('ошибка декодера HEIC' + (ev && ev.message ? ': ' + ev.message : ''))); };
        w.postMessage({ buf: buf }, [buf]);
      });
    });
  }

  function nativeImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img.naturalWidth > 0 ? img : null); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function toCanvas(d) {
    var c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.buffer), d.width, d.height), 0, 0);
    return c;
  }

  async function load(file) {
    var img = await nativeImage(file);
    if (img) return { source: img, width: img.naturalWidth, height: img.naturalHeight, method: 'браузер' };
    var d = await decode(file);
    return { source: toCanvas(d), width: d.width, height: d.height, method: 'libheif', hasAlpha: d.hasAlpha };
  }

  async function prepare(file) {
    var img = await nativeImage(file);
    if (img) return { file: file, converted: false, width: img.naturalWidth, height: img.naturalHeight };
    var d = await decode(file), c = toCanvas(d);
    var type = d.hasAlpha ? 'image/png' : 'image/jpeg';                 // без прозрачности — JPEG высокого качества (быстрее и легче PNG)
    var blob = await new Promise(function (res) { c.toBlob(res, type, 0.97); });
    if (!blob) throw new Error('не удалось сохранить результат декодирования');
    var base = (file.name || 'image').replace(/\.[^.]+$/, '');
    var out = new File([blob], base + (d.hasAlpha ? '.png' : '.jpg'), { type: type });
    return { file: out, converted: true, width: d.width, height: d.height };
  }

  window.HeicDecode = { hinted: hinted, sniff: sniff, truncated: truncated, decode: decode, load: load, prepare: prepare };
})();
