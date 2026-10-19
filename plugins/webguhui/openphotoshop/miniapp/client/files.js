import { readTIFF } from './tiff-reader.js';
import { writeTIFF } from './tiff.js';
import {
  canvas,
  layer,
  documentModel,
  composite,
  serialize,
  deserialize,
  imageFrom,
  download,
} from './model.js';
import { readPSD, writePSD, exportPDF } from './codecs.js';
export function createFileActions(state, ui) {
  const { requireDoc, addDoc, setDoc, refresh, status, button, modal, note } = ui;
  const dialog = document.querySelector('#dialog');
  async function importFiles(files) {
    for (const file of files) {
      if (file.size > 128 * 1024 * 1024) throw Error('单个文件不能超过 128 MB');
      if (file.name.endsWith('.json')) {
        addDoc(await deserialize(JSON.parse(await file.text())));
        continue;
      }
      if (/\.psd$/i.test(file.name)) {
        addDoc(readPSD(await file.arrayBuffer(), file.name.replace(/\.psd$/i, '')));
        status('PSD 已打开；当前导入仅保留普通像素图层');
        continue;
      }
      if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
        const image = readTIFF(await file.arrayBuffer());
        const d = documentModel(image.width, image.height, file.name.replace(/\.[^.]+$/, ''));
        d.layers[0].canvas
          .getContext('2d')
          .putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        addDoc(d);
        continue;
      }
      const url = URL.createObjectURL(file);
      try {
        const img = await imageFrom(url);
        const d = documentModel(img.width, img.height, file.name.replace(/\.[^.]+$/, ''));
        const ctx = d.layers[0].canvas.getContext('2d');
        ctx.clearRect(0, 0, d.width, d.height);
        ctx.drawImage(img, 0, 0);
        addDoc(d);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    status('已打开 ' + files.length + ' 个文件');
  }
  async function save() {
    requireDoc();
    const d = state.doc;
    state.busy = true;
    status('正在保存工程…');
    try {
      const p = await serialize(d);
      const res = await fetch('/api/projects/' + d.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        }),
        r = await res.json();
      if (!res.ok) throw Error(r.error);
      d.revision = r.revision;
      d.dirty = false;
      refresh();
      status('已保存到本机 · 保留全部图层');
    } finally {
      state.busy = false;
    }
  }
  async function exportProject() {
    requireDoc();
    const p = await serialize(state.doc);
    download(
      new Blob([JSON.stringify(p)], { type: 'application/json' }),
      state.doc.name + '.retouch.json',
    );
    status('工程文件已导出');
  }
  async function projects() {
    const res = await fetch('/api/projects');
    if (!res.ok) throw Error('无法读取本地工程');
    const { projects } = await res.json();
    const rows = projects.map((p) => {
      const row = document.createElement('div');
      row.className = 'project-row';
      const text = document.createElement('span');
      text.textContent = `${p.name} · ${p.width} × ${p.height}`;
      row.append(
        text,
        button('打开', async () => {
          const res = await fetch('/api/projects/' + p.id);
          if (!res.ok) throw Error('无法打开工程');
          const d = await deserialize(await res.json());
          const existing = state.docs.find((x) => x.id === d.id);
          if (existing) {
            if (existing.dirty) throw Error('该工程已打开且有未保存修改，请先保存或导出');
            setDoc(existing);
          } else addDoc(d);
          dialog.close();
          status('已恢复工程和图层');
        }),
      );
      return row;
    });
    modal(
      '本地工程',
      rows.length ? rows : [note('还没有保存的工程。打开图片后点击“保存工程”。')],
      () => {},
      '关闭',
    );
  }
  async function exportImage(type = 'png') {
    requireDoc();
    const d = state.doc;
    if (type === 'psd') {
      const hasAdjustments = d.layers.some((l) => l.adjustment);
      let exported = d;
      if (hasAdjustments) {
        const flattened = layer(d.width, d.height, '合并图像');
        flattened.canvas = composite(d);
        exported = { ...d, layers: [flattened] };
      }
      download(writePSD(exported), d.name + '.psd');
      status(
        hasAdjustments
          ? 'PSD 已导出为合并图像；请另存工程以保留调整参数和混合模式'
          : 'PSD 已导出：文字、蒙版和样式会转换为像素图层',
      );
      return;
    }
    const c = composite(d);
    if (type === 'tiff') {
      download(
        writeTIFF(c.getContext('2d').getImageData(0, 0, c.width, c.height)),
        d.name + '.tiff',
      );
      status('已导出 TIFF：合并图像，保留透明度；图层请另存工程');
      return;
    }
    if (type === 'pdf') {
      const white = canvas(c.width, c.height),
        ctx = white.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(c, 0, 0);
      download(await exportPDF(white), d.name + '.pdf');
      return;
    }
    if (type === 'svg') {
      const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><image width="100%" height="100%" href="${c.toDataURL('image/png')}"/></svg>`;
      download(new Blob([body], { type: 'image/svg+xml' }), d.name + '.svg');
      status('已导出 SVG（内嵌合并位图）');
      return;
    }
    let target = c;
    if (type === 'jpeg') {
      target = canvas(c.width, c.height);
      const ctx = target.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(c, 0, 0);
    }
    const blob = await new Promise((ok) => target.toBlob(ok, 'image/' + type, 0.94));
    if (!blob) throw Error('图片导出失败');
    download(blob, d.name + '.' + (type === 'jpeg' ? 'jpg' : type));
    status('已导出 ' + type.toUpperCase());
  }

  return { importFiles, save, exportProject, projects, exportImage };
}
