/* ffmpeg-worker.js — запуск ffmpeg.wasm (@ffmpeg/core 0.12.10, GPL-2.0-or-later) в отдельном потоке.
   Нужен для форматов, которых нет у браузера (MOD/MPG/VOB: MPEG-2 + AC-3/MP2).
   Входной файл монтируется через WORKERFS — читается прямо из Blob, без копирования в память.

   Ядро хранится в сжатом виде (ffmpeg-core.wasm.gz, ≈10 МБ вместо 32 МБ — укладывается в лимит 25 МБ на файл у GitHub)
   и распаковывается здесь же через DecompressionStream. Если хостинг сам отдаёт файл с Content-Encoding: gzip, браузер
   распакует его раньше нас — это тоже поддерживается; если .gz нет, берётся обычный ffmpeg-core.wasm.

   Сообщения от страницы:
     { type: 'load', coreURL, wasmURL }      (wasmURL — адрес ffmpeg-core.wasm.gz)
     { type: 'run',  file: Blob, inName, args: [...], outName }
   Ответы:
     { type: 'loaded' } · { type: 'log', line } · { type: 'progress', progress, time }
     { type: 'done', data: Uint8Array } · { type: 'error', message } */
'use strict';
let core = null;

async function fetchWasm(url) {
  let r = await fetch(url);
  if (!r.ok && url.endsWith('.gz')) r = await fetch(url.slice(0, -3));          // запасной вариант: несжатый файл
  if (!r.ok) throw new Error('не удалось загрузить ffmpeg-core.wasm (HTTP ' + r.status + ')');
  let buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {                                       // gzip: распаковываем сами
    if (typeof DecompressionStream === 'undefined') throw new Error('браузер не умеет распаковывать gzip — обновите его');
    try {
      buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    } catch (e) { throw new Error('ffmpeg-core.wasm.gz повреждён или загружен не полностью — не удалось распаковать'); }
  }
  if (!(buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d)) throw new Error('ffmpeg-core.wasm повреждён или не распознан');
  return buf;
}

self.onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      importScripts(m.coreURL);
      const wasmBinary = await fetchWasm(m.wasmURL);
      core = await createFFmpegCore({ wasmBinary, locateFile: p => (p.endsWith('.wasm') ? m.wasmURL : p) });
      core.setLogger(d => self.postMessage({ type: 'log', line: d.message }));
      core.setProgress(d => self.postMessage({ type: 'progress', progress: d.progress, time: d.time }));
      self.postMessage({ type: 'loaded' });
    } else if (m.type === 'run') {
      const FS = core.FS;
      FS.mkdir('/in');
      FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: m.inName, data: m.file }] }, '/in');
      core.setTimeout(-1);
      core.exec(...m.args);
      const ret = core.ret;
      core.reset();
      if (ret !== 0) throw new Error('ffmpeg завершился с кодом ' + ret);
      const data = FS.readFile(m.outName);
      self.postMessage({ type: 'done', data }, [data.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
