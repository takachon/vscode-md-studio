import type { EditorSettings, EditorTheme, EditorToHost, HostToEditor } from '../protocol';
import { applyTheme, isDarkTheme } from './themes';
import { cleanupFailedRender, escapeHtml, loadMermaid, mermaidVersion, type MermaidApi } from './mermaidLoader';
import { closeLightbox, lightboxOpen, showLightbox } from './lightbox';
import { toolbarItems } from './toolbar';
import { installImageMenu } from './imageMenu';
import { installOutlineSpy } from './outlineSpy';
import { asImage, installInlineImages } from './inlineImages';

interface VditorInstance {
  getValue(): string;
  setValue(markdown: string, clearStack?: boolean): void;
  insertValue(value: string, render?: boolean): void;
  setTheme(theme: 'dark' | 'classic', contentTheme?: string, codeTheme?: string, contentThemePath?: string): void;
  focus(): void;
}
declare const Vditor: new (id: string | HTMLElement, options: Record<string, unknown>) => VditorInstance;
declare function acquireVsCodeApi(): { postMessage(msg: EditorToHost): void };

const vscode = acquireVsCodeApi();
const post = (msg: EditorToHost) => vscode.postMessage(msg);
const settings: EditorSettings = JSON.parse(document.getElementById('md-studio-settings')!.textContent!);

const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });
window.addEventListener('error', (e) => log('error', `webview: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log('error', `webview: ${String(e.reason?.message ?? e.reason)}`));

// --- Mermaid -----------------------------------------------------------------------------------
// Vditor loads `${cdn}/dist/js/mermaid/mermaid.min.js` unless an element with this id exists, and then
// calls the global `mermaid.initialize(its own config)` + `mermaid.render()`. We claim the id and put a
// facade in `window.mermaid` so that the configured build and the user's settings are used instead.
function installMermaidFacade(): void {
  const marker = document.createElement('meta');
  marker.id = 'vditorMermaidScript';
  document.head.appendChild(marker);
  const facade: MermaidApi = {
    initialize() {
      /* Vditor's config is ignored; ours was applied in loadMermaid(). */
    },
    async render(id: string, text: string) {
      let api: MermaidApi;
      try {
        api = await mermaidReady();
      } catch (e) {
        return { svg: errorBox(String((e as Error).message ?? e)) };
      }
      try {
        return await api.render(id, text);
      } catch (e) {
        cleanupFailedRender(id);
        return { svg: errorBox(String((e as Error).message ?? e)) };
      }
    },
  };
  window.mermaid = facade;
}

function errorBox(message: string): string {
  return `<div class="md-studio-mermaid-error"><strong>Mermaid error</strong><pre>${escapeHtml(message)}</pre></div>`;
}

let mermaidPromise: Promise<MermaidApi> | undefined;
function mermaidReady(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = loadMermaid(settings.mermaid);
    // loadMermaid restores the previous window.mermaid (our facade) after loading.
    mermaidPromise.then(
      async (api) => post({ type: 'mermaidLoaded', version: await mermaidVersion(api) }),
      (e) => log('error', String(e.message ?? e)),
    );
  }
  return mermaidPromise;
}

// --- Fonts (from VS Code's settings) ----------------------------------------------------------
{
  const f = settings.font;
  const root = document.documentElement.style;
  root.setProperty('--md-font-family', f.family);
  root.setProperty('--md-font-size', `${f.size}px`);
  root.setProperty('--md-line-height', String(f.lineHeight));
  root.setProperty('--md-code-font-family', f.codeFamily);
  root.setProperty('--md-code-font-size', `${f.codeSize}px`);
}

// --- Theme -------------------------------------------------------------------------------------
const themeArgs = (): ['dark' | 'classic', string, string] =>
  isDarkTheme() ? ['dark', 'dark', 'github-dark'] : ['classic', 'light', 'github'];
let themeDark: boolean | undefined;

/** Applies `theme` (or re-evaluates the current one after VS Code's theme changed). */
function setEditorTheme(theme: EditorTheme): void {
  applyTheme(theme);
  if (!vditor || themeDark === isDarkTheme()) return;
  themeDark = isDarkTheme();
  const [t, contentTheme, codeTheme] = themeArgs();
  vditor.setTheme(t, contentTheme, codeTheme, `${settings.vditorCdn}/dist/css/content-theme`);
}
let editorTheme: EditorTheme = settings.theme ?? 'auto';
applyTheme(editorTheme);

// --- Editor ------------------------------------------------------------------------------------
let vditor: VditorInstance | undefined;
let syncId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent: string | undefined;
let nextRequest = 1;
const pendingImages = new Map<number, (r: { path?: string; error?: string }) => void>();
const pendingInputs = new Map<number, (value: string | undefined) => void>();

function sendEdit(): void {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!vditor) return;
  const text = vditor.getValue();
  if (text === lastSent) return;
  lastSent = text;
  post({ type: 'edit', text, syncId });
}

function scheduleEdit(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(sendEdit, 250);
}

function sendBaseline(): void {
  const norm = vditor!.getValue();
  lastSent = norm;
  post({ type: 'baseline', norm, syncId });
}

function create(text: string): void {
  const [theme, contentTheme, codeTheme] = themeArgs();
  themeDark = isDarkTheme();
  const cdn = settings.vditorCdn;
  vditor = new Vditor('vditor', {
    value: text,
    cdn,
    mode: settings.mode,
    lang: 'en_US',
    icon: 'ant',
    theme,
    height: '100%',
    width: '100%',
    cache: { enable: false },
    counter: { enable: false },
    typewriterMode: false,
    toolbarConfig: { hide: !settings.toolbar, pin: true },
    toolbar: toolbarItems((command) => {
      sendEdit();
      post({ type: 'command', command });
    }),
    outline: { enable: settings.outline, position: 'left' },
    hint: { emojiPath: `${cdn}/dist/images/emoji` },
    preview: {
      theme: { current: contentTheme, path: `${cdn}/dist/css/content-theme` },
      hljs: { style: codeTheme, lineNumber: false },
      math: { engine: 'KaTeX' },
      markdown: {
        linkBase: settings.linkBase,
        autoSpace: false,
        fixTermTypo: false,
        toc: true,
        mark: true,
        sanitize: true,
      },
      actions: [],
    },
    upload: {
      accept: 'image/*',
      multiple: true,
      handler: uploadImages,
    },
    input: scheduleEdit,
    blur: sendEdit,
    after: () => {
      sendBaseline();
      installOutlineSpy();
      // Load Mermaid in the background so its version is known even without diagrams.
      setTimeout(() => void mermaidReady().catch(() => undefined), 500);
    },
  });
}

async function uploadImages(files: File[]): Promise<null> {
  for (const file of files) {
    const data = await fileToBase64(file);
    const requestId = nextRequest++;
    const result = await new Promise<{ path?: string; error?: string }>((resolve) => {
      pendingImages.set(requestId, resolve);
      post({ type: 'saveImage', requestId, name: file.name || 'image.png', mime: file.type, data });
    });
    if (result.path) {
      const alt = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
      vditor?.insertValue(`![${alt}](${encodeURI(result.path)})`);
    } else {
      log('error', `Could not save pasted image: ${result.error ?? 'unknown error'}`);
    }
  }
  scheduleEdit();
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

window.addEventListener('message', (event: MessageEvent<HostToEditor>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      syncId = msg.syncId;
      if (!vditor) create(msg.text);
      else {
        vditor.setValue(msg.text, true);
        sendBaseline();
      }
      break;
    case 'update':
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      syncId = msg.syncId;
      vditor?.setValue(msg.text, true);
      if (vditor) sendBaseline();
      break;
    case 'flush': {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      const text = vditor?.getValue();
      if (text !== undefined) lastSent = text;
      post({ type: 'flushed', requestId: msg.requestId, text, syncId });
      break;
    }
    case 'inputResult':
      pendingInputs.get(msg.requestId)?.(msg.value);
      pendingInputs.delete(msg.requestId);
      break;
    case 'imageSaved':
      pendingImages.get(msg.requestId)?.({ path: msg.path, error: msg.error });
      pendingImages.delete(msg.requestId);
      break;
  }
});

// Save shortcut: push pending changes right away (the host also asks for a flush before saving).
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') sendEdit();
}, true);

// Word-like shortcuts: when Vditor handled a Ctrl/Cmd key (it calls preventDefault), stop the event
// before it reaches the window, where VS Code's webview host forwards keys to the workbench
// (otherwise Ctrl+B would also toggle the side bar).
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.defaultPrevented && !/^[sp]$/i.test(e.key)) e.stopPropagation();
});

// Ctrl/Cmd+click opens links (the webview cannot navigate by itself).
document.addEventListener('click', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const target = e.target as HTMLElement;
  const a = target.closest('a[href]') as HTMLAnchorElement | null;
  let href = a?.getAttribute('href') ?? undefined;
  if (!href) {
    const link = target.closest('.vditor-ir__node[data-type="a"]');
    href = link?.querySelector('.vditor-ir__marker--link')?.textContent ?? undefined;
  }
  if (href) {
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'openLink', href });
  }
}, true);

// --- Zoom (Ctrl/Cmd + wheel) ---------------------------------------------------------------------
let zoom = settings.zoom > 0 ? settings.zoom : 1;
let zoomBadge: HTMLDivElement | undefined;
let zoomBadgeTimer: ReturnType<typeof setTimeout> | undefined;
let zoomSaveTimer: ReturnType<typeof setTimeout> | undefined;

function applyZoom(show: boolean): void {
  document.documentElement.style.setProperty('--md-zoom', String(zoom));
  if (!show) return;
  if (!zoomBadge) {
    zoomBadge = document.createElement('div');
    zoomBadge.className = 'md-zoom-badge';
    zoomBadge.innerHTML = '<span></span><button type="button" title="Reset zoom (Ctrl+0)">Reset</button>';
    zoomBadge.querySelector('button')!.addEventListener('click', () => setZoom(1));
    document.body.appendChild(zoomBadge);
  }
  zoomBadge.querySelector('span')!.textContent = `${Math.round(zoom * 100)}%`;
  zoomBadge.classList.add('md-zoom-badge--visible');
  if (zoomBadgeTimer) clearTimeout(zoomBadgeTimer);
  zoomBadgeTimer = setTimeout(() => zoomBadge?.classList.remove('md-zoom-badge--visible'), 1500);
}

function setZoom(value: number): void {
  zoom = Math.round(Math.min(Math.max(value, 0.5), 3) * 100) / 100;
  applyZoom(true);
  if (zoomSaveTimer) clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => post({ type: 'zoom', value: zoom }), 400);
}

window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || lightboxOpen()) return;
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === '0' && !lightboxOpen()) {
    e.preventDefault();
    setZoom(1);
  }
}, true);
applyZoom(false);

// --- Click to enlarge: images, and diagrams through a hover button -----------------------------
function markdownSrc(img: HTMLImageElement): string | undefined {
  const src = img.getAttribute('src') ?? '';
  if (src.startsWith(settings.linkBase)) return src.slice(settings.linkBase.length);
  return undefined;
}

document.addEventListener('click', (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const target = e.target as HTMLElement;
  const hit = target.closest<HTMLElement>('.vditor-reset img, .vditor-reset code.md-inline-img');
  const img = hit && asImage(hit);
  if (hit && img && (img.naturalWidth > 0 || !(hit instanceof HTMLImageElement))) {
    const src = hit instanceof HTMLImageElement ? markdownSrc(img) : hit.dataset.mdSrc;
    showLightbox(img, {
      title: img.getAttribute('alt') || src || '',
      onOpen: src ? () => post({ type: 'openLink', href: src }) : undefined,
    });
    return;
  }
  const expand = target.closest('.md-diagram-expand');
  if (expand) {
    e.preventDefault();
    e.stopPropagation();
    const svg = expand.parentElement?.querySelector<SVGSVGElement>('svg');
    if (svg) showLightbox(svg, { title: 'Diagram' });
  }
}, true);

// Add an "enlarge" button to every rendered diagram.
new MutationObserver(() => {
  for (const d of document.querySelectorAll<HTMLElement>('.language-mermaid[data-processed="true"]')) {
    if (d.querySelector(':scope > svg') && !d.querySelector(':scope > .md-diagram-expand')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'md-diagram-expand';
      b.title = 'Enlarge diagram';
      b.contentEditable = 'false';
      b.textContent = '\u2922';
      d.appendChild(b);
    }
  }
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-processed'] });

window.addEventListener('message', (e: MessageEvent<HostToEditor>) => {
  if (e.data?.type === 'update') closeLightbox();
  if (e.data?.type === 'theme') setEditorTheme((editorTheme = e.data.theme));
});

// VS Code's theme changed (body class): matters for `auto`.
new MutationObserver(() => setEditorTheme(editorTheme)).observe(document.body, { attributes: true, attributeFilter: ['class'] });

installMermaidFacade();
installInlineImages(settings.linkBase);
installImageMenu({
  getValue: () => vditor?.getValue() ?? '',
  setValue: (md) => {
    vditor?.setValue(md);
    sendEdit();
  },
  openImage: (href) => post({ type: 'openLink', href }),
  viewLarge: (img) => showLightbox(img, { title: img.getAttribute('alt') ?? '' }),
  markdownSrc: (el) => {
    if (!(el instanceof HTMLImageElement)) {
      const src = (el as HTMLElement).dataset.mdSrc;
      return src && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : undefined;
    }
    const src = el.getAttribute('src') ?? '';
    return src.startsWith(settings.linkBase) ? src.slice(settings.linkBase.length) : undefined;
  },
  askSize: (current) =>
    new Promise((resolve) => {
      const requestId = nextRequest++;
      pendingInputs.set(requestId, resolve);
      post({ type: 'askImageSize', requestId, current });
    }),
});
post({ type: 'ready' });
