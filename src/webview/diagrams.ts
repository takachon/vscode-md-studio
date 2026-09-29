// Diagram code blocks other than Mermaid, drawn as static SVG with the libraries bundled in Vditor's
// dist/js (served from the extension, nothing from the network). Used by the editor and the export,
// so both show the same picture. Nothing in a document is executed: ECharts options are parsed as
// data (relaxed JSON), not evaluated.
import { escapeHtml } from './mermaidLoader';

export const DIAGRAM_KINDS = ['graphviz', 'flowchart', 'echarts', 'mindmap', 'markmap', 'abc', 'smiles', 'plantuml'] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export const isDiagramKind = (s: string): s is DiagramKind => (DIAGRAM_KINDS as readonly string[]).includes(s);

export interface DiagramEnv {
  /** URL of Vditor's dist/js folder (no trailing slash). */
  libBase: string;
  /** PlantUML server, e.g. https://plantuml.example/plantuml (empty = not configured). */
  plantumlServer: string;
  dark: boolean;
  /** Width to lay charts out for, in CSS pixels. */
  width: number;
}

export interface Rendered {
  /** Markup to put in the diagram's container (SVG, or an <img> for PlantUML). */
  html: string;
  /** Remote image the host has to fetch (PlantUML in exports). */
  remote?: string;
}

// --- Loading the libraries ---------------------------------------------------------------------
// The libraries define globals that Vditor also uses. Vditor's own renderers are neutralised with
// facades (see installVditorFacades), so the real objects are captured and the facades put back.
const loaded = new Map<string, Promise<Record<string, unknown>>>();
type Win = Window & Record<string, unknown>;
const win = window as unknown as Win;

function loadGlobals(urls: string[], names: string[], seed: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const key = urls.join('|');
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      // Own properties only: an element with id="markmap" (a heading) also shows up as window.markmap,
      // and UMD bundles would extend it ("e.markmap || {}"). Own properties shadow those.
      const own = (n: string) => Object.getOwnPropertyDescriptor(win, n);
      const saved = new Map(names.map((n) => [n, own(n)]));
      const got: Record<string, unknown> = { ...seed };
      try {
        for (const url of urls) {
          // Seeds (e.g. the real Viz for full.render.js) are visible while loading; other names keep
          // their current value (Vditor may call its facades meanwhile).
          for (const n of names) win[n] = n in got ? got[n] : own(n)?.value;
          const before = Object.fromEntries(names.map((n) => [n, win[n]]));
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(`Could not load ${url}`));
            document.head.appendChild(s);
          });
          for (const n of names) if (win[n] !== before[n]) got[n] = win[n];
        }
      } finally {
        for (const [n, d] of saved) {
          if (d) Object.defineProperty(win, n, d);
          else delete win[n];
        }
      }
      return got;
    })();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return p;
}

/** Vditor draws these blocks itself unless its script ids are taken; its calls then do nothing. */
export function installVditorFacades(): void {
  const claim = (id: string) => {
    if (document.getElementById(id)) return;
    const m = document.createElement('meta');
    m.id = id;
    document.head.appendChild(m);
  };
  for (const id of ['vditorEchartsScript', 'vditorGraphVizScript', 'vditorMarkerScript', 'vditorFlowchartScript', 'vditorAbcjsScript', 'vditorPlantumlScript']) claim(id);
  const inert = { setOption() {}, dispose() {} };
  win.echarts = { init: () => inert };
  win.Viz = class {
    renderSVGElement() {
      return new Promise(() => {});
    }
  };
  win.flowchart = { parse: () => ({ drawSVG() {} }) };
  win.ABCJS = { renderAbc() {} };
  win.SmiDrawer = class {
    draw() {}
  };
  win.plantumlEncoder = {
    encode() {
      throw new Error('drawn by MD Studio');
    },
  };
}

// --- Relaxed JSON (ECharts options) ------------------------------------------------------------
/** Parses JSON plus what people write in ECharts examples: comments, unquoted keys, 'single quotes', trailing commas. */
export function parseRelaxedJson(text: string): unknown {
  let i = 0;
  const fail = (what: string): never => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`${what} at line ${line}`);
  };
  const ws = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? '')) i++;
      else if (text.startsWith('//', i)) i = text.includes('\n', i) ? text.indexOf('\n', i) : text.length;
      else if (text.startsWith('/*', i)) i = text.includes('*/', i + 2) ? text.indexOf('*/', i + 2) + 2 : fail('Unclosed comment');
      else return;
    }
  };
  const str = (): string => {
    const q = text[i++];
    let out = '';
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') {
        const c = text[i + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
        if (c === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += map[c] ?? c;
        i += 2;
      } else out += text[i++];
    }
    if (text[i] !== q) fail('Unclosed string');
    i++;
    return out;
  };
  const value = (): unknown => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (text[i] === '}') {
          i++;
          return o;
        }
        let k: string;
        if (text[i] === '"' || text[i] === "'") k = str();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
          if (!m) fail('Expected a key');
          k = m![0];
          i += k.length;
        }
        ws();
        if (text[i++] !== ':') fail('Expected ":"');
        o[k] = value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (text[i] === ']') {
          i++;
          return a;
        }
        a.push(value());
        ws();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail('Expected "," or "]"');
      }
    }
    if (c === '"' || c === "'") return str();
    const m = /^(?:-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|true|false|null|undefined|NaN|-?Infinity)/.exec(text.slice(i));
    if (!m) fail(c === 'f' || text.startsWith('(', i) ? 'Functions are not supported' : 'Unexpected character');
    i += m![0].length;
    const t = m![0];
    return t === 'true' ? true : t === 'false' ? false : t === 'null' || t === 'undefined' ? null : Number(t);
  };
  const v = value();
  ws();
  if (i < text.length) fail('Unexpected text after the value');
  return v;
}

// --- Mind map (a Markdown list) ----------------------------------------------------------------
export interface TreeNode {
  name: string;
  children?: TreeNode[];
}

/** "- a\n  - b" -> tree. Several top-level items get an empty root. */
export function parseMindmap(text: string): TreeNode {
  const root: TreeNode & { indent: number } = { name: '', children: [], indent: -1 };
  const stack: Array<TreeNode & { indent: number }> = [root];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line.replace(/\t/g, '    '));
    if (!m) continue;
    const indent = m[1].length;
    const node = { name: m[2].replace(/\*\*|__|`/g, '').trim(), indent };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    (parent.children ??= []).push(node);
    stack.push(node);
  }
  const strip = (n: TreeNode & { indent?: number }): TreeNode => ({ name: n.name, ...(n.children?.length ? { children: n.children.map(strip) } : {}) });
  const top = root.children ?? [];
  if (top.length === 0) throw new Error('A mind map is a Markdown list ("- item", indented for children)');
  return top.length === 1 ? strip(top[0]) : strip(root);
}

const leaves = (n: TreeNode): number => (n.children?.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1);

// --- Renderers ---------------------------------------------------------------------------------
type EChartsApi = {
  init(el: HTMLElement | null, theme?: string | null, opts?: Record<string, unknown>): { setOption(o: unknown): void; renderToSVGString(): string; dispose(): void };
};

async function echartsSvg(env: DiagramEnv, option: Record<string, unknown>, height: number): Promise<string> {
  const { echarts } = (await loadGlobals([`${env.libBase}/echarts/echarts.min.js`], ['echarts'])) as { echarts: EChartsApi };
  const chart = echarts.init(null, env.dark ? 'dark' : null, { renderer: 'svg', ssr: true, width: env.width, height });
  try {
    chart.setOption({ animation: false, ...option, ...(env.dark ? { backgroundColor: 'transparent' } : {}) });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

/** Keeps a rendered SVG inside its column (keeps the aspect ratio). */
function fitSvg(svg: SVGSVGElement, maxWidth = '100%'): string {
  const w = svg.getAttribute('width');
  const h = svg.getAttribute('height');
  if (!svg.getAttribute('viewBox') && w && h && !/%/.test(w + h)) svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
  svg.style.maxWidth = maxWidth;
  svg.style.height = 'auto';
  return svg.outerHTML;
}

/** A detached element in the page for libraries that measure text while drawing. */
function scratch(): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;';
  document.body.appendChild(d);
  return d;
}

const renderers: Record<DiagramKind, (code: string, env: DiagramEnv) => Promise<Rendered>> = {
  async graphviz(code, env) {
    const first = (await loadGlobals([`${env.libBase}/graphviz/viz.js`], ['Viz'])) as { Viz: { new (o: unknown): { renderString(s: string): Promise<string> } } & Record<string, unknown> };
    // full.render.js attaches Module/render to the global Viz.
    await loadGlobals([`${env.libBase}/graphviz/full.render.js`], ['Viz'], { Viz: first.Viz });
    const Viz = first.Viz;
    const viz = new Viz({ Module: Viz.Module, render: Viz.render });
    const svgText = await viz.renderString(code);
    const holder = document.createElement('div');
    holder.innerHTML = svgText.replace(/^<\?xml[^>]*>\s*(<!DOCTYPE[^>]*>)?/, '');
    return { html: fitSvg(holder.querySelector('svg')!) };
  },

  async flowchart(code, env) {
    const { flowchart } = (await loadGlobals([`${env.libBase}/flowchart.js/flowchart.min.js`], ['flowchart', 'Raphael'])) as {
      flowchart: { parse(s: string): { drawSVG(el: HTMLElement, o?: unknown): void } };
    };
    const d = scratch();
    try {
      flowchart.parse(code).drawSVG(d, env.dark ? { 'line-color': '#ccc', 'element-color': '#ccc', 'font-color': '#ddd', fill: 'transparent' } : {});
      const svg = d.querySelector('svg');
      if (!svg) throw new Error('Nothing to draw');
      return { html: fitSvg(svg) };
    } finally {
      d.remove();
    }
  },

  async echarts(code, env) {
    const option = parseRelaxedJson(code);
    if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('An ECharts block is one option object: { ... }');
    const o = option as Record<string, unknown>;
    const height = typeof o.height === 'number' ? o.height : 400;
    delete o.height;
    return { html: await echartsSvg(env, o, height) };
  },

  async mindmap(code, env) {
    const tree = parseMindmap(code);
    const height = Math.max(160, leaves(tree) * 28 + 40);
    const label = env.dark
      ? { backgroundColor: '#2d333b', borderColor: '#444c56', color: '#c9d1d9' }
      : { backgroundColor: '#f6f8fa', borderColor: '#d1d5da', color: '#24292f' };
    return {
      html: await echartsSvg(env, {
        series: [{
          type: 'tree', data: [tree], initialTreeDepth: -1, top: 20, bottom: 20, left: 80, right: 160,
          symbol: 'circle', symbolSize: 7, itemStyle: { color: '#4285f4', borderWidth: 0 },
          label: { ...label, position: 'left', verticalAlign: 'middle', align: 'right', borderWidth: 0.5, borderRadius: 4, padding: [2, 6], fontSize: 13 },
          leaves: { label: { position: 'right', align: 'left' } },
          lineStyle: { color: env.dark ? '#555' : '#c8cdd3', width: 1.2, curveness: 0.5 },
        }],
      }, height),
    };
  },

  async markmap(code, env) {
    const { markmap } = (await loadGlobals([`${env.libBase}/markmap/markmap.min.js`], ['markmap', 'd3'])) as {
      markmap: {
        Transformer: new () => { transform(md: string): { root: unknown } };
        Markmap: { create(svg: SVGSVGElement, opts: unknown, data: unknown): { fit(): Promise<void> } };
        globalCSS?: string;
      };
    };
    // Its plugins look up window.markmap while transforming (Vditor never uses it: blocks are claimed).
    win.markmap = markmap;
    const { root } = new markmap.Transformer().transform(code);
    const d = scratch();
    d.style.width = `${env.width}px`;
    d.innerHTML = '<svg class="markmap" style="width:100%;height:400px"></svg>';
    try {
      const svg = d.querySelector('svg')!;
      const mm = markmap.Markmap.create(svg, { duration: 0, autoFit: false, embedGlobalCSS: true }, root);
      await mm.fit();
      // Freeze the drawing: viewBox around the content instead of the zoom transform.
      const g = svg.querySelector('g')!;
      g.removeAttribute('transform');
      const box = g.getBBox();
      const pad = 10;
      svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
      svg.setAttribute('width', String(Math.ceil(box.width + 2 * pad)));
      svg.setAttribute('height', String(Math.ceil(box.height + 2 * pad)));
      svg.removeAttribute('style');
      if (markmap.globalCSS && !svg.querySelector('style')) svg.insertAdjacentHTML('afterbegin', `<style>${markmap.globalCSS}</style>`);
      if (env.dark) svg.style.color = '#c9d1d9';
      return { html: fitSvg(svg) };
    } finally {
      d.remove();
    }
  },

  async abc(code, env) {
    const { ABCJS } = (await loadGlobals([`${env.libBase}/abcjs/abcjs_basic.min.js`], ['ABCJS'])) as { ABCJS: { renderAbc(el: HTMLElement, s: string, o?: unknown): unknown[] } };
    const d = scratch();
    try {
      const tunes = ABCJS.renderAbc(d, code, { add_classes: true });
      const svg = d.querySelector('svg');
      if (!svg || tunes.length === 0) throw new Error('Nothing to draw (ABC notation needs at least an X: and K: line)');
      return { html: fitSvg(svg) };
    } finally {
      d.remove();
    }
  },

  async smiles(code, env) {
    const { SmiDrawer } = (await loadGlobals([`${env.libBase}/smiles-drawer/smiles-drawer.min.js`], ['SmiDrawer', 'SmilesDrawer'])) as {
      SmiDrawer: new (a: unknown, b: unknown) => { draw(s: string, t: string, theme: string, ok: (svg: SVGSVGElement) => void, err: (e: unknown) => void): void };
    };
    const svg = await new Promise<SVGSVGElement>((resolve, reject) => {
      new SmiDrawer({}, {}).draw(code.trim(), 'svg', env.dark ? 'dark' : 'light', resolve, reject);
    });
    return { html: fitSvg(svg, 'min(100%, 360px)') };
  },

  async plantuml(code, env) {
    if (!env.plantumlServer) throw new Error('Set the PlantUML server (setting mdStudio.plantuml.server) to draw PlantUML diagrams');
    const { plantumlEncoder } = (await loadGlobals([`${env.libBase}/plantuml/plantuml-encoder.min.js`], ['plantumlEncoder'])) as {
      plantumlEncoder: { encode(s: string): string };
    };
    const url = `${env.plantumlServer.replace(/\/+$/, '')}/svg/~1${plantumlEncoder.encode(code.trim())}`;
    return { html: `<img class="md-plantuml" alt="PlantUML diagram" src="${escapeHtml(url)}">`, remote: url };
  },
};

/** Draws one diagram; throws with a readable message on errors. */
export function renderDiagram(kind: DiagramKind, code: string, env: DiagramEnv): Promise<Rendered> {
  return renderers[kind](code, env);
}

export function diagramError(kind: DiagramKind, e: unknown): string {
  const message = String((e as Error)?.message ?? e);
  return `<div class="md-diagram-error"><strong>${escapeHtml(kind)} error</strong><pre>${escapeHtml(message)}</pre></div>`;
}
