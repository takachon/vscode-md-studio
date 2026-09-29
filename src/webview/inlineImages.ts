// Vditor's WYSIWYG mode shows inline HTML such as `<img src=".." width="50%">` (an image inside a
// paragraph or a table cell) as code. Draw those as images instead. Only the look of the element
// changes; its text (what Vditor turns back into Markdown) is left alone.

export function attrOf(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

const cssLength = (v: string | undefined) => (!v ? undefined : /^\d+(\.\d+)?$/.test(v) ? `${v}px` : /^\d+(\.\d+)?(%|px|em|rem)$/.test(v) ? v : undefined);

export function installInlineImages(linkBase: string): void {
  const decorate = (code: HTMLElement) => {
    const text = (code.textContent ?? '').replace(/​/g, '').trim();
    if (!/^<img\b[^>]*>$/i.test(text)) {
      if (code.classList.contains('md-inline-img')) {
        code.classList.remove('md-inline-img');
        code.removeAttribute('style');
        code.removeAttribute('contenteditable');
        delete code.dataset.mdImg;
      }
      return;
    }
    if (code.dataset.mdImg === text) return;
    const src = attrOf(text, 'src') ?? '';
    const url = /^(https?:|data:|blob:)/i.test(src) ? src : linkBase + src.replace(/^\.\//, '');
    code.dataset.mdImg = text;
    code.dataset.mdSrc = src;
    code.dataset.mdUrl = url;
    code.classList.add('md-inline-img');
    code.contentEditable = 'false';
    code.title = attrOf(text, 'alt') || src;
    const probe = new Image();
    probe.onload = () => {
      if (code.dataset.mdImg !== text) return;
      const w = cssLength(attrOf(text, 'width'));
      const h = cssLength(attrOf(text, 'height'));
      code.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      code.style.width = w ?? (h ? 'auto' : `${probe.naturalWidth}px`);
      if (h && !w) code.style.height = h;
      code.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`;
    };
    probe.onerror = () => code.classList.add('md-inline-img--broken');
    probe.src = url;
  };
  const run = () => {
    for (const code of document.querySelectorAll<HTMLElement>('.vditor-reset code[data-type="html-inline"]')) decorate(code);
  };
  new MutationObserver(run).observe(document.body, { subtree: true, childList: true, characterData: true });
  run();
}

/** A real <img> for an image drawn by installInlineImages (for the viewer). */
export function asImage(el: Element): HTMLImageElement | undefined {
  if (el instanceof HTMLImageElement) return el;
  const url = (el as HTMLElement).dataset?.mdUrl;
  if (!url) return undefined;
  const img = new Image();
  img.src = url;
  img.alt = (el as HTMLElement).title;
  return img;
}
