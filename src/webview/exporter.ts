// Renders Markdown to self-contained HTML inside a webview: marked -> heading ids -> Mermaid SVG ->
// highlight.js -> images as data URIs (read by the host) -> scripts removed. The host wraps the result.
import { Marked } from 'marked';
import type { ExportSettings, ExporterToHost, HostToExporter } from '../protocol';
import { cleanupFailedRender, escapeHtml, loadMermaid, mermaidVersion } from './mermaidLoader';

declare function acquireVsCodeApi(): { postMessage(msg: ExporterToHost): void };
interface Hljs {
  getLanguage(name: string): unknown;
  highlightElement(el: HTMLElement): void;
}
declare global {
  interface Window {
    hljs?: Hljs;
  }
}

const vscode = acquireVsCodeApi();
const post = (msg: ExporterToHost) => vscode.postMessage(msg);
const settings: ExportSettings = JSON.parse(document.getElementById('md-studio-settings')!.textContent!);

let imagesResolve: ((images: Record<string, string>) => void) | undefined;

window.addEventListener('message', (event: MessageEvent<HostToExporter>) => {
  const msg = event.data;
  if (msg.type === 'render') {
    render(msg.markdown).catch((e) => post({ type: 'failed', message: String(e?.stack ?? e) }));
  } else if (msg.type === 'images') {
    imagesResolve?.(msg.images);
  }
});

/** GitHub / GitLab style anchor ids ("3.7 Foo Bar" -> "37-foo-bar", duplicates get -1, -2 ...). */
export function addHeadingIds(root: ParentNode): void {
  const used = new Map<string, number>();
  for (const h of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const base = (h.textContent ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n === 0 ? base : `${base}-${n}`;
  }
}

function stripFrontMatter(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '');
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function render(markdown: string): Promise<void> {
  const problems: string[] = [];
  const main = document.getElementById('out')!;
  const marked = new Marked({ gfm: true, breaks: false });
  main.innerHTML = await marked.parse(stripFrontMatter(markdown));

  addHeadingIds(main);

  // Mermaid -> SVG.
  const blocks = [...main.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  let version = '';
  if (blocks.length > 0) {
    const mermaid = await loadMermaid(settings.mermaid);
    version = await mermaidVersion(mermaid);
    let i = 0;
    for (const code of blocks) {
      const id = `mermaid-${i++}`;
      const div = document.createElement('div');
      div.className = 'mermaid';
      try {
        const { svg } = await mermaid.render(id, code.textContent ?? '');
        div.innerHTML = svg;
      } catch (e) {
        cleanupFailedRender(id);
        const message = String((e as Error)?.message ?? e);
        problems.push(`Diagram ${i}: ${message.split('\n')[0]}`);
        div.className = 'mermaid mermaid-error';
        div.innerHTML = `<p><strong>Mermaid error</strong></p><pre>${escapeHtml(message)}</pre><pre>${escapeHtml(code.textContent ?? '')}</pre>`;
      }
      code.parentElement!.replaceWith(div);
    }
  }

  // Syntax highlighting (static markup only; the CSS is inlined by the host).
  const codes = [...main.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')];
  if (codes.length > 0) {
    try {
      await loadScript(settings.hljsUrl);
      for (const code of codes) {
        const lang = /language-(\S+)/.exec(code.className)?.[1];
        if (lang && window.hljs?.getLanguage(lang)) window.hljs.highlightElement(code);
      }
    } catch (e) {
      problems.push(String((e as Error).message ?? e));
    }
  }

  // Images -> data URIs.
  const imgs = [...main.querySelectorAll<HTMLImageElement>('img[src]')];
  const srcs = [...new Set(imgs.map((img) => img.getAttribute('src')!).filter((s) => !/^data:/i.test(s)))];
  if (srcs.length > 0) {
    const images = await new Promise<Record<string, string>>((resolve) => {
      imagesResolve = resolve;
      post({ type: 'needImages', srcs });
    });
    for (const img of imgs) {
      const src = img.getAttribute('src')!;
      if (/^data:/i.test(src)) continue;
      if (images[src]) img.setAttribute('src', images[src]);
      else problems.push(`Image not embedded: ${src}`);
    }
  }

  // No active content in the output.
  for (const el of main.querySelectorAll('script, iframe, object, embed, noscript')) el.remove();
  for (const el of main.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  // Every in-page link must have a target.
  const ids = new Set([...main.querySelectorAll('[id]')].map((el) => el.id));
  for (const el of main.querySelectorAll('[name]')) ids.add(el.getAttribute('name')!);
  for (const a of main.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const raw = a.getAttribute('href')!.slice(1);
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    if (raw !== '' && !ids.has(target) && !ids.has(raw)) problems.push(`Link target not found: #${target}`);
  }

  post({ type: 'done', html: main.innerHTML, mermaidVersion: version, diagrams: blocks.length, problems });
}

post({ type: 'ready' });
