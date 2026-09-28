// Right-click menu on images: change the display size (stored as <img width="...">), view, open.
import { asImage, attrOf } from './inlineImages.ts';

/** Images in the editor: real <img> elements and inline-HTML images drawn by inlineImages.ts. */
export const IMAGE_SELECTOR = 'img:not(.emoji), code.md-inline-img';

export interface ImageMenuHost {
  getValue(): string;
  setValue(markdown: string): void;
  openImage(href: string): void;
  viewLarge(img: HTMLImageElement): void;
  /** The src as written in the Markdown, when the image is a local file. */
  markdownSrc(el: Element): string | undefined;
  askSize(current: string): Promise<string | undefined>;
}

export interface ImageRef {
  start: number;
  end: number;
  kind: 'md' | 'html' | 'ref';
  src: string;
  alt: string;
  title?: string;
}

/** Images in Markdown source order (fenced code blocks and code spans are skipped). */
export function findImages(md: string): ImageRef[] {
  // Blank out code so that image-like text inside it is not matched (offsets stay the same).
  const masked = md
    .replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$)/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, (m) => m.replace(/[^\n]/g, ' '));
  const out: ImageRef[] = [];
  const md1 = /!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const m of masked.matchAll(md1)) {
    const raw = md.slice(m.index!, m.index! + m[0].length);
    const r = new RegExp(md1.source).exec(raw)!;
    out.push({
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'md',
      alt: r[1].replace(/\\(.)/g, '$1'),
      src: r[2].replace(/^<|>$/g, ''),
      title: r[3]?.slice(1, -1),
    });
  }
  for (const m of masked.matchAll(/<img\b[^>]*>/gi)) {
    const raw = md.slice(m.index!, m.index! + m[0].length);
    out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'html', src: attrOf(raw, 'src') ?? '', alt: attrOf(raw, 'alt') ?? '' });
  }
  for (const m of masked.matchAll(/!\[(?:[^\]\\]|\\.)*\]\[[^\]]*\]/g)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'ref', src: '', alt: '' });
  }
  return out.sort((a, b) => a.start - b.start);
}


const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** New source text for `ref` with the given width ('' = original size). */
export function resizedImage(md: string, ref: ImageRef, width: string): string {
  const raw = md.slice(ref.start, ref.end);
  if (ref.kind === 'md') {
    if (!width) return raw;
    return `<img src="${esc(ref.src)}" alt="${esc(ref.alt)}"${ref.title ? ` title="${esc(ref.title)}"` : ''} width="${esc(width)}">`;
  }
  // HTML: replace / drop width, drop height so the aspect ratio is kept.
  let tag = raw.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (!width) {
    // Only src / alt / title left: back to plain Markdown.
    const rest = tag.replace(/\s(src|alt|title)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/^<img\b|\/?>$/gi, '').trim();
    if (!rest) {
      const title = attrOf(tag, 'title');
      const src = /[\s()]/.test(ref.src) ? `<${ref.src}>` : ref.src;
      return `![${ref.alt.replace(/([\\[\]])/g, '\\$1')}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    return tag;
  }
  return tag.replace(/\s*\/?>$/, (end) => ` width="${esc(width)}"${end.includes('/') ? ' />' : '>'}`);
}

function sameSrc(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      return decodeURI(s).replace(/^\.\//, '');
    } catch {
      return s.replace(/^\.\//, '');
    }
  };
  return norm(a) === norm(b);
}

let menu: HTMLDivElement | undefined;

function closeMenu(): void {
  menu?.remove();
  menu = undefined;
}

export function installImageMenu(host: ImageMenuHost): void {
  document.addEventListener('contextmenu', (e) => {
    const img = (e.target as HTMLElement).closest<HTMLElement>('.vditor-reset img:not(.emoji), .vditor-reset code.md-inline-img');
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    showMenu(host, img, e.clientX, e.clientY);
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (menu && e.key === 'Escape') closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
  document.addEventListener('scroll', closeMenu, true);
}

function showMenu(host: ImageMenuHost, img: HTMLElement, x: number, y: number): void {
  closeMenu();
  const current = (img instanceof HTMLImageElement ? img.getAttribute('width') : attrOf(img.dataset.mdImg ?? '', 'width')) ?? '';
  const src = host.markdownSrc(img);
  const items: Array<[string, string] | '-'> = [
    ['25%', 'Small (25%)'],
    ['50%', 'Medium (50%)'],
    ['75%', 'Large (75%)'],
    ['100%', 'Fit Width (100%)'],
    ['', 'Original Size'],
    ['custom', 'Custom Size…'],
    '-',
    ['view', 'View Large'],
    ...(src ? ([['open', 'Open Image File']] as Array<[string, string]>) : []),
  ];
  const m = document.createElement('div');
  m.className = 'md-context-menu';
  m.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') {
      m.appendChild(Object.assign(document.createElement('div'), { className: 'md-context-menu__sep' }));
      continue;
    }
    const [value, label] = it;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    const isSize = !['custom', 'view', 'open'].includes(value);
    if (isSize && value === current) b.classList.add('md-context-menu__checked');
    b.addEventListener('click', async () => {
      closeMenu();
      if (value === 'view') {
        const big = asImage(img);
        if (big) host.viewLarge(big);
      }
      else if (value === 'open') host.openImage(src!);
      else if (value === 'custom') {
        const w = await host.askSize(current);
        if (w !== undefined) applySize(host, img, w.trim());
      } else applySize(host, img, value);
    });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  menu = m;
  m.querySelector('button')?.focus();
}

function applySize(host: ImageMenuHost, img: HTMLElement, width: string): void {
  const root = img.closest('.vditor-reset');
  if (!root) return;
  const md = host.getValue();
  const refs = findImages(md);
  const imgs = [...root.querySelectorAll<HTMLElement>(IMAGE_SELECTOR)];
  const index = imgs.indexOf(img);
  const src = host.markdownSrc(img);
  let ref: ImageRef | undefined = refs[index];
  if (src && (!ref || !sameSrc(ref.src, src))) {
    // Fall back to matching by src (e.g. images inside raw HTML blocks counted differently).
    const same = refs.filter((r) => sameSrc(r.src, src));
    const nth = imgs.filter((i) => host.markdownSrc(i) && sameSrc(host.markdownSrc(i)!, src)).indexOf(img);
    ref = same[nth] ?? same[0];
  }
  if (!ref || ref.kind === 'ref') return;
  const next = md.slice(0, ref.start) + resizedImage(md, ref, width) + md.slice(ref.end);
  if (next !== md) host.setValue(next);
}
