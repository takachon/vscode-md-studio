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
  font: EditorFont;
  /** Content zoom factor (Ctrl+wheel), 1 = 100 %. */
  zoom: number;
  mermaid: MermaidSetup;
}

/** Fonts taken from VS Code's settings (markdown.preview.* for text, editor.* for code). */
export interface EditorFont {
  family: string;
  size: number;
  lineHeight: number;
  codeFamily: string;
  codeSize: number;
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
  | { type: 'zoom'; value: number }
  | { type: 'mermaidLoaded'; version: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type ImageMode = 'embed' | 'link' | 'copy';
export type PaperSize = 'A4' | 'A3' | 'B5' | 'Letter' | 'Legal';

/** Everything the export panel lets the user choose. Defaults come from mdStudio.export.* / mdStudio.pdf.*. */
export interface ExportOptions {
  format: 'html' | 'pdf';
  /** HTML: embed as data URIs / keep links (rewritten relative to the output) / copy next to the output. */
  images: ImageMode;
  highlight: boolean;
  tocDepth: number;
  tocTitle: string;
  openAfter: boolean;
  html: {
    toc: 'none' | 'top' | 'sidebar';
    theme: 'light' | 'dark' | 'auto';
    maxWidth: number;
  };
  pdf: {
    toc: boolean;
    bookmarks: boolean;
    paper: PaperSize;
    landscape: boolean;
    margin: 'narrow' | 'normal' | 'wide';
    pageNumbers: boolean;
    headerTitle: boolean;
  };
}

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export type HostToExporter =
  | { type: 'init'; fileName: string; options: ExportOptions; target: string; browser: string | null }
  | { type: 'target'; target: string }
  | { type: 'start' }
  | { type: 'render'; markdown: string; highlight: boolean }
  | { type: 'images'; images: Record<string, string> }
  | { type: 'status'; message: string }
  | { type: 'result'; ok: boolean; message: string; problems: string[] };

export type ExporterToHost =
  | { type: 'ready' }
  | { type: 'browse'; format: 'html' | 'pdf'; target: string }
  | { type: 'export'; options: ExportOptions; target: string }
  | { type: 'saveDefaults'; options: ExportOptions }
  | { type: 'openResult'; action: 'open' | 'reveal' }
  | { type: 'needImages'; srcs: string[] }
  | { type: 'rendered'; html: string; headings: Heading[]; mermaidVersion: string; diagrams: number; problems: string[] }
  | { type: 'failed'; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
