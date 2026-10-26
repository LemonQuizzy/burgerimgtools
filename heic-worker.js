/* heic-worker.js — декодирование HEIC/HEIF в RGBA в отдельном потоке.
   Декодер: libheif-js 1.23.2 (libheif + libde265, wasm внутри libheif-bundle.js), см. NOTICE-libheif.txt.
   Вход:  { buf: ArrayBuffer }
   Выход: { ok: true, width, height, hasAlpha, buffer: ArrayBuffer(RGBA) }  или  { ok: false, error } */
importScripts('libheif-bundle.js');

const MAX_PIXELS = 120e6;                       // предохранитель от «бомб»: ~11000×11000

// libheif-bundle.js экспортирует фабрику: libheif() возвращает готовый модуль (так же делает сам libheif-js)
const libReady = Promise.resolve(typeof libheif === 'function' ? libheif() : libheif);

self.onmessage = async ev => {
  try {
    const lib = await libReady;
    const decoder = new lib.HeifDecoder();
    const images = decoder.decode(new Uint8Array(ev.data.buf));
    if (!images || !images.length) throw new Error('в файле не найдено изображений (повреждён или неподдерживаемый вариант HEIF)');
    // основное изображение: помеченное как primary, иначе самое большое
    const img = images.find(i => i.is_primary()) ||
                images.reduce((a, b) => (a.get_width() * a.get_height() >= b.get_width() * b.get_height() ? a : b));
    const w = img.get_width(), h = img.get_height();
    if (!w || !h) throw new Error('не удалось определить размер изображения');
    if (w * h > MAX_PIXELS) throw new Error('изображение слишком большое (' + w + '×' + h + ')');
    const data = new Uint8ClampedArray(w * h * 4);
    const res = await new Promise(r => img.display({ data, width: w, height: h }, r));
    if (!res) throw new Error('не удалось декодировать изображение');
    self.postMessage({ ok: true, width: w, height: h, hasAlpha: img.has_alpha_channel(), buffer: data.buffer }, [data.buffer]);
  } catch (e) {
    self.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
};
