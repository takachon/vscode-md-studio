import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EditorFont, MermaidSetup } from './protocol';

export const SECTION = 'mdStudio';

export interface ResolvedMermaid {
  /** File to load in the webview. */
  file: vscode.Uri;
  /** Extra folder the webview must be allowed to read (for a user supplied file). */
  root?: vscode.Uri;
  label: string;
  config: Record<string, unknown>;
  /** Set when the configured file could not be used and the bundled build is used instead. */
  warning?: string;
}

let bundledVersion: string | undefined;

export async function readBundledVersion(extensionUri: vscode.Uri): Promise<string> {
  if (bundledVersion) return bundledVersion;
  try {
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'media', 'vendor', 'versions.json'));
    bundledVersion = JSON.parse(Buffer.from(raw).toString('utf8')).mermaid as string;
  } catch {
    bundledVersion = 'unknown';
  }
  return bundledVersion;
}

function expandPath(p: string, doc?: vscode.Uri): string {
  let s = p.trim();
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(os.homedir(), s.slice(1));
  const folder = (doc && vscode.workspace.getWorkspaceFolder(doc)) ?? vscode.workspace.workspaceFolders?.[0];
  if (folder) s = s.replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath);
  return s;
}

/** Config passed to mermaid.initialize(): user extras < theme/look/layout settings. Frontmatter wins inside Mermaid. */
export function mermaidConfig(scope?: vscode.Uri): Record<string, unknown> {
  const c = vscode.workspace.getConfiguration(`${SECTION}.mermaid`, scope);
  const extra = c.get<Record<string, unknown>>('config') ?? {};
  const cfg: Record<string, unknown> = { ...extra, startOnLoad: false, securityLevel: c.get<string>('securityLevel') || 'loose' };
  for (const key of ['theme', 'look', 'layout'] as const) {
    const v = c.get<string>(key);
    if (v) cfg[key] = v;
  }
  return cfg;
}

export async function resolveMermaid(extensionUri: vscode.Uri, doc?: vscode.Uri): Promise<ResolvedMermaid> {
  const c = vscode.workspace.getConfiguration(`${SECTION}.mermaid`, doc);
  const config = mermaidConfig(doc);
  const bundled: ResolvedMermaid = {
    file: vscode.Uri.joinPath(extensionUri, 'media', 'vendor', 'mermaid', 'mermaid.min.js'),
    label: `bundled Mermaid ${await readBundledVersion(extensionUri)}`,
    config,
  };
  if (c.get<string>('source') !== 'file') return bundled;

  const raw = c.get<string>('file') ?? '';
  if (!raw.trim()) {
    return { ...bundled, warning: 'mdStudio.mermaid.source is "file" but mdStudio.mermaid.file is empty; using the bundled Mermaid.' };
  }
  const fsPath = expandPath(raw, doc);
  if (!path.isAbsolute(fsPath)) {
    return { ...bundled, warning: `mdStudio.mermaid.file must be an absolute path: ${raw}; using the bundled Mermaid.` };
  }
  const file = vscode.Uri.file(fsPath);
  try {
    const stat = await vscode.workspace.fs.stat(file);
    if (stat.type & vscode.FileType.Directory) throw new Error('is a directory');
  } catch (e) {
    return { ...bundled, warning: `Cannot read mdStudio.mermaid.file (${fsPath}): ${(e as Error).message}; using the bundled Mermaid.` };
  }
  return { file, root: vscode.Uri.file(path.dirname(fsPath)), label: fsPath, config };
}

export function toSetup(webview: vscode.Webview, m: ResolvedMermaid): MermaidSetup {
  return { url: webview.asWebviewUri(m.file).toString(), label: m.label, config: m.config };
}

/** Folders a webview may read: the extension, the document's folder and the workspace folders. */
export function resourceRoots(extensionUri: vscode.Uri, doc: vscode.Uri, extra: (vscode.Uri | undefined)[] = []): vscode.Uri[] {
  const roots = [extensionUri, vscode.Uri.joinPath(doc, '..')];
  for (const f of vscode.workspace.workspaceFolders ?? []) roots.push(f.uri);
  for (const e of extra) if (e) roots.push(e);
  return roots;
}

/** VS Code settings that decide the editor's fonts (the same ones the built-in Markdown preview uses). */
export const FONT_SETTINGS = ['markdown.preview.fontFamily', 'markdown.preview.fontSize', 'markdown.preview.lineHeight', 'editor.fontFamily', 'editor.fontSize'];

export function editorFont(scope?: vscode.Uri): EditorFont {
  const md = vscode.workspace.getConfiguration('markdown.preview', scope);
  const ed = vscode.workspace.getConfiguration('editor', scope);
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 ? v : fallback);
  return {
    family:
      md.get<string>('fontFamily') ||
      "-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif",
    size: num(md.get('fontSize'), 14),
    lineHeight: num(md.get('lineHeight'), 1.6),
    codeFamily: ed.get<string>('fontFamily') || "Consolas, 'Courier New', monospace",
    codeSize: num(ed.get('fontSize'), 14),
  };
}
