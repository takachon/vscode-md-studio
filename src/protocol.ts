// Messages between the extension host and the webviews. Shared by both sides.

export interface MermaidSetup {
  /** Webview URL of the mermaid.min.js to load. */
  url: string;
  /** Human readable origin of the build, for logs ("bundled 12.0.0" / a file path). */
  label: string;
  /** Passed to mermaid.initialize(). */
  config: Record<string, unknown>;
}

export interface EditorSettings {
  /** Base URL of the Vditor distribution (Vditor's `cdn` option). */
  vditorCdn: string;
  /** Webview URL of the Markdown file's folder, with a trailing slash. */
  linkBase: string;
  mode: 'ir' | 'wysiwyg' | 'sv';
  toolbar: boolean;
  outline: boolean;
  mermaid: MermaidSetup;
}

export type ToolbarCommand = 'openText' | 'save' | 'export' | 'settings';

export interface ExportSettings {
  mermaid: MermaidSetup;
  /** Webview URL of highlight.min.js. */
  hljsUrl: string;
}

export type HostToEditor =
  | { type: 'init'; text: string; syncId: number }
  | { type: 'update'; text: string; syncId: number }
  | { type: 'flush'; requestId: number }
  | { type: 'imageSaved'; requestId: number; path?: string; error?: string };

export type EditorToHost =
  | { type: 'ready' }
  | { type: 'baseline'; norm: string; syncId: number }
  | { type: 'edit'; text: string; syncId: number }
  | { type: 'flushed'; requestId: number; text?: string; syncId: number }
  | { type: 'saveImage'; requestId: number; name: string; mime: string; data: string }
  | { type: 'openLink'; href: string }
  | { type: 'command'; command: ToolbarCommand }
  | { type: 'mermaidLoaded'; version: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type HostToExporter =
  | { type: 'render'; markdown: string; title: string }
  | { type: 'images'; images: Record<string, string> };

export type ExporterToHost =
  | { type: 'ready' }
  | { type: 'needImages'; srcs: string[] }
  | { type: 'done'; html: string; mermaidVersion: string; diagrams: number; problems: string[] }
  | { type: 'failed'; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
