// Draws Graphviz / flowchart / ECharts / mind map / markmap / ABC / SMILES / PlantUML blocks in the
// editor with diagrams.ts. Vditor's own renderers are disabled (facades), so these blocks look the
// same in the editor and in exports.
import { DIAGRAM_KINDS, diagramError, installVditorFacades, isDiagramKind, renderDiagram, type DiagramEnv, type DiagramKind } from './diagrams';

const OUT = 'md-diagram-out';
const selector = [
  ...DIAGRAM_KINDS.map((k) => `.vditor-reset .language-${k}`),
  '[data-md-diagram]',
].join(', ');

/** The Markdown source of a preview element: the hidden code block next to the preview. */
function sourceOf(el: HTMLElement): string {
  const preview = el.closest('.vditor-wysiwyg__preview, .vditor-ir__preview');
  const code = preview?.previousElementSibling?.querySelector('code');
  if (code) return code.textContent ?? '';
  return el.textContent ?? '';
}

let generation = 0;

export function installEditorDiagrams(env: () => Omit<DiagramEnv, 'width'>): { redraw(): void } {
  installVditorFacades();

  const draw = async (el: HTMLElement, kind: DiagramKind, code: string) => {
    const token = `${generation}:${code}`;
    el.dataset.mdRendered = token;
    let html: string;
    try {
      const width = Math.min(Math.max(el.clientWidth || 800, 320), 1000);
      html = (await renderDiagram(kind, code, { ...env(), width })).html;
    } catch (e) {
      html = diagramError(kind, e);
    }
    if (el.dataset.mdRendered !== token || !el.isConnected) return;
    el.innerHTML = `<div class="${OUT}" contenteditable="false">${html}</div>`;
  };

  const scan = () => {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      // The hidden source (<pre><code class="language-x">) is not a preview.
      if (el.closest('.vditor-wysiwyg__pre, .vditor-ir__marker--pre, .vditor-sv')) continue;
      const kind = el.dataset.mdDiagram ?? /(?:^|\s)language-(\S+)/.exec(el.className)?.[1] ?? '';
      if (!isDiagramKind(kind)) continue;
      // Keep Vditor's renderers away, remember what to draw before anyone replaces the content.
      el.setAttribute('data-processed', 'true');
      el.dataset.mdDiagram = kind;
      el.dataset.mdCode ??= sourceOf(el);
      if (!el.classList.contains(`language-${kind}`) || !el.classList.contains('md-diagram')) el.className = `language-${kind} md-diagram`;
      const code = el.dataset.mdCode;
      if (el.dataset.mdRendered === `${generation}:${code}` && el.querySelector(`:scope > .${OUT}`)) continue;
      if (el.dataset.mdRendered === `${generation}:${code}` && el.dataset.mdBusy) continue;
      el.dataset.mdBusy = '1';
      void draw(el, kind, code).finally(() => delete el.dataset.mdBusy);
    }
  };

  new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  return {
    redraw() {
      generation++;
      scan();
    },
  };
}
