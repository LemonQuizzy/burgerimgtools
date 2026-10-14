/* raw.js — извлечение встроенного JPEG-превью из RAW (ARW · CR3 · NEF).

   Браузер не умеет «проявлять» RAW, но каждый такой файл содержит один или несколько
   готовых JPEG (миниатюра, превью, у части камер — полноразмерный). Мы находим их все,
   берём самый большой и отдаём как обычный Blob — дальше он идёт через общий пайплайн сжатия.
   Разрешение результата = разрешение превью, которое записала камера (не матрицы!).

   API (window.RawPreview):
     isRaw(file)        → boolean (по расширению)
     extract(file)      → Promise<{ blob, width, height, orientation, found }>
                          бросает Error с понятным текстом, если превью нет или оно не декодируется */
(function () {
  'use strict';

  var RAW_EXT = /\.(arw|cr3|nef)$/i;

  function isRaw(file) { return !!file && RAW_EXT.test(file.name || ''); }

  /* ── JPEG: разбор потока от SOI до EOI ───────────────────────────────────────────
     Возвращает { end, w, h, sof } либо null, если это не целый корректный JPEG.
     sof: 0 baseline, 1 extended, 2 progressive — их декодирует любой браузер.
     Lossless/arithmetic (SOF3, 5–7, 9–15) — это «сырые» данные, не превью → пропускаем. */
  function parseJpeg(u8, start) {
    var n = u8.length, pos = start + 2, w = 0, h = 0, sof = -1;
    while (pos + 4 <= n) {
      if (u8[pos] !== 0xFF) return null;
      var m = u8[pos + 1];
      if (m === 0xFF) { pos++; continue; }                         // заполнитель
      if (m === 0xD9) return sof >= 0 ? { end: pos + 2, w: w, h: h, sof: sof } : null;  // EOI
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { pos += 2; continue; }
      var len = (u8[pos + 2] << 8) | u8[pos + 3];
      if (len < 2) return null;
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {   // SOFn
        if (sof < 0) {
          h = (u8[pos + 5] << 8) | u8[pos + 6];
          w = (u8[pos + 7] << 8) | u8[pos + 8];
          sof = m - 0xC0;
        }
      }
      pos += 2 + len;
      if (m === 0xDA) {                                            // SOS: дальше энтропийные данные
        for (;;) {
          pos = u8.indexOf(0xFF, pos);
          if (pos < 0 || pos + 1 >= n) return null;
          var nx = u8[pos + 1];
          if (nx === 0x00 || (nx >= 0xD0 && nx <= 0xD7)) { pos += 2; continue; }   // stuffing / RSTn
          if (nx === 0xFF) { pos++; continue; }
          break;                                                   // настоящий маркер
        }
      }
    }
    return null;
  }

  /* Все JPEG-потоки в файле (вложенные внутрь уже найденного не учитываем:
     это EXIF-миниатюры, они заведомо меньше родителя). */
  function scanJpegs(u8) {
    var out = [], i = 0, n = u8.length;
    while (i < n - 4) {
      i = u8.indexOf(0xFF, i);
      if (i < 0 || i >= n - 4) break;
      if (u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) {
        var r = parseJpeg(u8, i);
        if (r && r.w > 0 && r.h > 0) { out.push({ start: i, end: r.end, w: r.w, h: r.h, sof: r.sof }); i = r.end; continue; }
      }
      i++;
    }
    return out;
  }

  /* ── EXIF-ориентация ───────────────────────────────────────────────────────────── */
  // Orientation (тег 0x0112) из TIFF-структуры, начинающейся с u8[base]. 0 — тега нет.
  function tiffOrientation(u8, base) {
    if (base + 8 > u8.length) return 0;
    var le;
    if (u8[base] === 0x49 && u8[base + 1] === 0x49) le = true;
    else if (u8[base] === 0x4D && u8[base + 1] === 0x4D) le = false;
    else return 0;
    function u16(o) { return le ? (u8[o] | (u8[o + 1] << 8)) : ((u8[o] << 8) | u8[o + 1]); }
    function u32(o) { return le ? ((u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16)) + u8[o + 3] * 16777216)
                                : (u8[o] * 16777216 + ((u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3])); }
    if (u16(base + 2) !== 42) return 0;
    var ifd = base + u32(base + 4);
    if (ifd + 2 > u8.length) return 0;
    var cnt = u16(ifd);
    for (var k = 0; k < cnt; k++) {
      var e = ifd + 2 + k * 12;
      if (e + 12 > u8.length) return 0;
      if (u16(e) === 0x0112) { var v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  }

  // Ориентация самого RAW-файла: ARW/NEF — TIFF в начале; CR3 — бокс CMT1 (IFD0 камеры) в moov.
  function rawOrientation(u8) {
    if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2A) || (u8[0] === 0x4D && u8[1] === 0x4D && u8[3] === 0x2A)) {
      return tiffOrientation(u8, 0);
    }
    var lim = Math.min(u8.length - 8, 4 * 1024 * 1024);                 // moov лежит в начале файла
    for (var i = 4; i < lim; i++) {
      if (u8[i] === 0x43 && u8[i + 1] === 0x4D && u8[i + 2] === 0x54 && u8[i + 3] === 0x31) {   // 'CMT1'
        var o = tiffOrientation(u8, i + 4);
        if (o) return o;
      }
    }
    return 0;
  }

  // Есть ли у самого JPEG блок Exif (APP1) и что в нём за ориентация.
  function jpegExif(u8, start, end) {
    var pos = start + 2;
    while (pos + 4 <= end && u8[pos] === 0xFF) {
      var m = u8[pos + 1];
      if (m === 0xDA || m === 0xD9) break;
      var len = (u8[pos + 2] << 8) | u8[pos + 3];
      if (m === 0xE1 && u8[pos + 4] === 0x45 && u8[pos + 5] === 0x78 && u8[pos + 6] === 0x69 && u8[pos + 7] === 0x66) {
        return { has: true, orientation: tiffOrientation(u8, pos + 10) };
      }
      pos += 2 + len;
    }
    return { has: false, orientation: 0 };
  }

  // Вшиваем в JPEG минимальный Exif с ориентацией (36 байт, без перекодирования) —
  // браузер сам повернёт картинку при показе и при drawImage на canvas.
  function withOrientation(jpeg, ori) {
    var seg = new Uint8Array([
      0xFF, 0xE1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,                       // "Exif\0\0"
      0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,           // TIFF, big-endian, IFD0 @ 8
      0x00, 0x01,                                               // 1 запись
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, ori, 0x00, 0x00,   // Orientation = ori
      0x00, 0x00, 0x00, 0x00                                    // нет следующего IFD
    ]);
    var out = new Uint8Array(jpeg.length + seg.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(seg, 2);
    out.set(jpeg.subarray(2), 2 + seg.length);
    return out;
  }

  function canDecode(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(true); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });
  }

  async function extract(file) {
    var u8 = new Uint8Array(await file.arrayBuffer());
    var cands = scanJpegs(u8)
      .filter(function (c) { return c.sof <= 2; })
      .sort(function (a, b) { return (b.w * b.h - a.w * a.h) || ((b.end - b.start) - (a.end - a.start)); });
    if (!cands.length) throw new Error('во встроенных данных не найдено JPEG-превью');

    var rawOri = rawOrientation(u8);
    for (var k = 0; k < Math.min(cands.length, 6); k++) {
      var c = cands[k], bytes = u8.subarray(c.start, c.end);
      var ex = jpegExif(u8, c.start, c.end), ori = ex.has ? ex.orientation : rawOri;
      if (!ex.has && rawOri > 1) bytes = withOrientation(bytes, rawOri);
      var blob = new Blob([bytes], { type: 'image/jpeg' });
      if (await canDecode(blob)) {
        var swap = ori >= 5;
        return { blob: blob, width: swap ? c.h : c.w, height: swap ? c.w : c.h, orientation: ori || 1, found: cands.length };
      }
    }
    throw new Error('встроенное превью не удалось декодировать');
  }

  window.RawPreview = {
    isRaw: isRaw, extract: extract,
    _scanJpegs: scanJpegs, _rawOrientation: rawOrientation, _jpegExif: jpegExif, _withOrientation: withOrientation   // для тестов
  };
})();
