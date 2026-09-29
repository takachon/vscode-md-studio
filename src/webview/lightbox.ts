// Full-window viewer for images and diagrams: wheel to zoom, drag to pan, Esc / click outside to close.

let overlay: HTMLDivElement | undefined;
let keyHandler: ((e: KeyboardEvent) => void) | undefined;

interface Options {
  /** Called with the image's Markdown src when the user asks to open the file. */
  onOpen?: () => void;
  title?: string;
}

export function showLightbox(content: HTMLImageElement | SVGSVGElement, opts: Options = {}): void {
  if (content instanceof HTMLImageElement && !(content.complete && content.naturalWidth > 0)) {
    content.addEventListener('load', () => showLightbox(content, opts), { once: true });
    return;
  }
  closeLightbox();
  const el = content.cloneNode(true) as HTMLElement;
  el.removeAttribute('width');
  el.removeAttribute('height');
  el.removeAttribute('style');
  el.classList.add('md-lightbox__content');

  const o = document.createElement('div');
  o.className = 'md-lightbox';
  o.tabIndex = -1;
  o.innerHTML = `
    <div class="md-lightbox__bar">
      <span class="md-lightbox__title"></span>
      <span class="md-lightbox__zoom"></span>
      <button data-act="out" title="Zoom out">&minus;</button>
      <button data-act="in" title="Zoom in">+</button>
      <button data-act="fit" title="Fit to window">Fit</button>
      <button data-act="one" title="Actual size">100%</button>
      ${opts.onOpen ? '<button data-act="open" title="Open the image file">Open</button>' : ''}
      <button data-act="close" title="Close (Esc)">&times;</button>
    </div>
    <div class="md-lightbox__stage"></div>`;
  o.querySelector('.md-lightbox__title')!.textContent = opts.title ?? '';
  const stage = o.querySelector<HTMLDivElement>('.md-lightbox__stage')!;
  const zoomLabel = o.querySelector<HTMLSpanElement>('.md-lightbox__zoom')!;
  stage.appendChild(el);
  document.body.appendChild(o);
  overlay = o;

  // Natural size of the content.
  let natW = 0, natH = 0;
  if (content instanceof HTMLImageElement) {
    natW = content.naturalWidth || content.width;
    natH = content.naturalHeight || content.height;
  } else {
    const vb = content.viewBox?.baseVal;
    const r = content.getBoundingClientRect();
    natW = vb?.width || r.width;
    natH = vb?.height || r.height;
  }
  let scale = 1, x = 0, y = 0;
  const apply = () => {
    el.style.width = `${natW * scale}px`;
    el.style.height = `${natH * scale}px`;
    el.style.transform = `translate(${x}px, ${y}px)`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  const center = () => {
    const s = stage.getBoundingClientRect();
    x = (s.width - natW * scale) / 2;
    y = (s.height - natH * scale) / 2;
  };
  const fit = () => {
    const s = stage.getBoundingClientRect();
    scale = Math.min((s.width - 32) / natW, (s.height - 32) / natH, content instanceof HTMLImageElement ? 1 : 4);
    if (!(scale > 0)) scale = 1;
    center();
    apply();
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(Math.max(scale * factor, 0.05), 20);
    const f = next / scale;
    x = cx - (cx - x) * f;
    y = cy - (cy - y) * f;
    scale = next;
    apply();
  };
  const zoomCenter = (factor: number) => {
    const s = stage.getBoundingClientRect();
    zoomAt(factor, s.width / 2, s.height / 2);
  };

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = stage.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - s.left, e.clientY - s.top);
  }, { passive: false });

  let drag: { sx: number; sy: number; x: number; y: number; moved: boolean } | undefined;
  stage.addEventListener('pointerdown', (e) => {
    drag = { sx: e.clientX, sy: e.clientY, x, y, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    x = drag.x + dx;
    y = drag.y + dy;
    apply();
  });
  stage.addEventListener('pointerup', (e) => {
    const clickedOutside = drag && !drag.moved && e.target === stage;
    drag = undefined;
    if (clickedOutside) closeLightbox();
  });
  stage.addEventListener('dblclick', (e) => {
    const s = stage.getBoundingClientRect();
    if (Math.abs(scale - 1) < 0.01) fit();
    else zoomAt(1 / scale, e.clientX - s.left, e.clientY - s.top);
  });

  o.querySelector('.md-lightbox__bar')!.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'in') zoomCenter(1.25);
    else if (act === 'out') zoomCenter(1 / 1.25);
    else if (act === 'fit') fit();
    else if (act === 'one') {
      scale = 1;
      center();
      apply();
    } else if (act === 'open') opts.onOpen?.();
    else if (act === 'close') closeLightbox();
  });
  // The editor may take focus back after the click, so listen on the window while open.
  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(1 / 1.25);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', keyHandler, true);
  fit();
  setTimeout(() => o.focus(), 0);
}

export function closeLightbox(): void {
  if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
  keyHandler = undefined;
  overlay?.remove();
  overlay = undefined;
}

export function lightboxOpen(): boolean {
  return !!overlay;
}
