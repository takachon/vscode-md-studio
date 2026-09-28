import type { MermaidSetup } from '../protocol';

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
  version?: string;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

let loading: Promise<MermaidApi> | undefined;

/** Loads the configured mermaid.min.js once and initialises it with the user's settings. */
export function loadMermaid(setup: MermaidSetup): Promise<MermaidApi> {
  loading ??= new Promise<MermaidApi>((resolve, reject) => {
    const previous = window.mermaid;
    const script = document.createElement('script');
    script.src = setup.url;
    script.onload = () => {
      const real = window.mermaid;
      window.mermaid = previous;
      if (!real || typeof real.render !== 'function') {
        reject(new Error(`${setup.label} did not define window.mermaid (use the IIFE build mermaid.min.js)`));
        return;
      }
      real.initialize({ ...setup.config });
      resolve(real);
    };
    script.onerror = () => reject(new Error(`Failed to load Mermaid from ${setup.label}`));
    document.head.appendChild(script);
  });
  return loading;
}

/** Mermaid does not export its version everywhere; the `info` diagram prints it in every release. */
export async function mermaidVersion(api: MermaidApi): Promise<string> {
  if (typeof api.version === 'string') return api.version;
  const id = 'md-studio-mermaid-version';
  try {
    const { svg } = await api.render(id, 'info');
    return /v(\d+\.\d+\.\d+[\w.+-]*)/.exec(svg)?.[1] ?? 'unknown';
  } catch {
    cleanupFailedRender(id);
    return 'unknown';
  }
}

/** Removes the temporary nodes Mermaid leaves in <body> when a render fails. */
export function cleanupFailedRender(id: string): void {
  for (const sel of [`#${id}`, `#d${id}`, `#i${id}`]) {
    document.querySelector(sel)?.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
