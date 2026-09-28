import * as vscode from 'vscode';
import * as path from 'node:path';
import { editorHtml } from './html';
import { mergeEdit, minimalReplace } from './merge';
import type { EditorSettings, EditorToHost, HostToEditor, ToolbarCommand } from './protocol';
import { FONT_SETTINGS, SECTION, editorFont, resolveMermaid, resourceRoots, toSetup } from './settings';
import type { Log } from './log';

export const VIEW_TYPE = 'mdStudio.editor';

export class MermaidStatus {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly versions = new Map<EditorSession, string>();
  private active: EditorSession | undefined;

  constructor() {
    this.item.command = 'mdStudio.showLog';
  }

  set(session: EditorSession, version: string, label: string): void {
    this.versions.set(session, `${version}\u0000${label}`);
    this.refresh();
  }

  focus(session: EditorSession | undefined): void {
    this.active = session;
    this.refresh();
  }

  blur(session: EditorSession): void {
    if (this.active === session) this.focus(undefined);
  }

  forget(session: EditorSession): void {
    this.versions.delete(session);
    if (this.active === session) this.active = undefined;
    this.refresh();
  }

  private refresh(): void {
    const v = this.active && this.versions.get(this.active);
    if (!v) {
      this.item.hide();
      return;
    }
    const [version, label] = v.split('\u0000');
    this.item.text = `$(type-hierarchy) Mermaid ${version}`;
    this.item.tooltip = `MD Studio uses ${label}`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

export class MdStudioEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<EditorSession>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Log,
    private readonly status: MermaidStatus,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const session = new EditorSession(this.context, this.log, this.status, document, panel);
    this.sessions.add(session);
    panel.onDidDispose(() => this.sessions.delete(session));
  }

  /** Pushes pending webview edits of `uri` into the TextDocument. */
  async flush(uri: vscode.Uri): Promise<void> {
    await Promise.all([...this.sessions].filter((s) => s.document.uri.toString() === uri.toString()).map((s) => s.flushAndApply()));
  }

  activeSession(): EditorSession | undefined {
    return [...this.sessions].find((s) => s.panel.active);
  }
}

class EditorSession {
  /** Bumped whenever the webview content is replaced from the document. */
  private syncId = 0;
  /** Document text sent with the current syncId. */
  private syncText = '';
  /** orig = document text, norm = the editor's Markdown for it (see merge.ts). */
  private baseline: { orig: string; norm: string } | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequest = 1;
  private readonly flushWaiters = new Map<number, (m: { text?: string; syncId: number }) => void>();
  private readonly disposables: vscode.Disposable[] = [];
  private mermaidLabel = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Log,
    private readonly status: MermaidStatus,
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
  ) {
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: EditorToHost) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === document && e.contentChanges.length > 0) this.onDocumentChanged();
      }),
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.document === document) e.waitUntil(this.editsBeforeSave());
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        const fontChanged = FONT_SETTINGS.some((k) => e.affectsConfiguration(k, document.uri));
        if (e.affectsConfiguration(SECTION, document.uri) || fontChanged) void this.flushAndApply().then(() => this.render());
      }),
      panel.onDidChangeViewState(() => {
        if (panel.active) status.focus(this);
        else status.blur(this);
      }),
    );
    panel.onDidDispose(() => {
      status.forget(this);
      for (const d of this.disposables) d.dispose();
    });
    void this.render();
    if (panel.active) status.focus(this);
  }

  private post(msg: HostToEditor): void {
    void this.panel.webview.postMessage(msg);
  }

  private async render(): Promise<void> {
    const webview = this.panel.webview;
    const ext = this.context.extensionUri;
    const mermaid = await resolveMermaid(ext, this.document.uri);
    if (mermaid.warning) {
      this.log.warn(mermaid.warning);
      void vscode.window.showWarningMessage(mermaid.warning);
    }
    this.mermaidLabel = mermaid.label;
    const cfg = vscode.workspace.getConfiguration(SECTION, this.document.uri);
    webview.options = {
      enableScripts: true,
      localResourceRoots: resourceRoots(ext, this.document.uri, [mermaid.root]),
    };
    const settings: EditorSettings = {
      vditorCdn: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'media', 'vendor', 'vditor')).toString(),
      linkBase: webview.asWebviewUri(vscode.Uri.joinPath(this.document.uri, '..')).toString().replace(/\/?$/, '/'),
      mode: cfg.get('editor.mode', 'ir'),
      toolbar: cfg.get('editor.toolbar', true),
      outline: cfg.get('editor.outline', true),
      font: editorFont(this.document.uri),
      mermaid: toSetup(webview, mermaid),
    };
    webview.html = editorHtml({
      cspSource: webview.cspSource,
      scriptUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'webview', 'editor.js')).toString(),
      cssUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'media', 'editor.css')).toString(),
      settings,
      allowRemoteImages: cfg.get('editor.allowRemoteImages', false),
    });
  }

  private sendDocument(type: 'init' | 'update'): void {
    this.syncId++;
    this.syncText = this.document.getText();
    this.baseline = undefined;
    this.post({ type, text: this.syncText, syncId: this.syncId });
  }

  private onDocumentChanged(): void {
    // Our own edits leave the document equal to the baseline; anything else came from outside
    // (text editor, undo/redo from the menu, git checkout ...) and replaces the editor content.
    if (this.baseline && this.document.getText() === this.baseline.orig) return;
    if (!this.baseline && this.document.getText() === this.syncText) return;
    this.sendDocument('update');
  }

  private onMessage(m: EditorToHost): void {
    switch (m.type) {
      case 'ready':
        this.sendDocument('init');
        break;
      case 'baseline':
        if (m.syncId === this.syncId) {
          this.baseline = { orig: this.syncText, norm: m.norm };
          if (this.document.getText() !== this.syncText) this.sendDocument('update');
        }
        break;
      case 'edit':
        this.enqueue(() => this.applyFromEditor(m.text, m.syncId));
        break;
      case 'flushed':
        this.flushWaiters.get(m.requestId)?.(m);
        this.flushWaiters.delete(m.requestId);
        break;
      case 'saveImage':
        void this.saveImage(m.requestId, m.name, m.mime, m.data);
        break;
      case 'openLink':
        void this.openLink(m.href);
        break;
      case 'command':
        void this.runCommand(m.command);
        break;
      case 'mermaidLoaded':
        this.log.info(`${this.fileName()}: Mermaid ${m.version} loaded (${this.mermaidLabel})`);
        this.status.set(this, m.version, this.mermaidLabel);
        break;
      case 'log':
        this.log[m.level](`${this.fileName()}: ${m.message}`);
        break;
    }
  }

  private fileName(): string {
    return path.basename(this.document.uri.path);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** New document text for the editor's Markdown, or undefined when the edit is stale. */
  private merged(next: string, syncId: number): string | undefined {
    if (syncId !== this.syncId || !this.baseline) return undefined;
    const current = this.document.getText();
    if (current !== this.baseline.orig) {
      // The document moved on without us: show it in the editor instead of overwriting it.
      this.sendDocument('update');
      return undefined;
    }
    const merged = mergeEdit(this.baseline.orig, this.baseline.norm, next);
    this.baseline = { orig: merged, norm: next };
    return merged;
  }

  private async applyFromEditor(next: string, syncId: number): Promise<void> {
    const before = this.document.getText();
    const merged = this.merged(next, syncId);
    if (merged === undefined || merged === before) return;
    const r = minimalReplace(before, merged)!;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(r.start), this.document.positionAt(r.end)), r.text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.log.warn(`${this.fileName()}: could not apply the edit; reloading the editor`);
      this.sendDocument('update');
    }
  }

  private requestFlush(): Promise<{ text?: string; syncId: number } | undefined> {
    const requestId = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.flushWaiters.delete(requestId);
        resolve(undefined);
      }, 1500);
      this.flushWaiters.set(requestId, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      this.post({ type: 'flush', requestId });
    });
  }

  async flushAndApply(): Promise<void> {
    const m = await this.requestFlush();
    if (m?.text !== undefined) await this.enqueue(() => this.applyFromEditor(m.text!, m.syncId));
    else await this.enqueue(async () => undefined);
  }

  private async editsBeforeSave(): Promise<vscode.TextEdit[]> {
    const m = await this.requestFlush();
    return this.enqueue(async () => {
      if (m?.text === undefined) return [];
      const before = this.document.getText();
      const merged = this.merged(m.text, m.syncId);
      if (merged === undefined || merged === before) return [];
      const r = minimalReplace(before, merged)!;
      return [vscode.TextEdit.replace(new vscode.Range(this.document.positionAt(r.start), this.document.positionAt(r.end)), r.text)];
    });
  }

  private async saveImage(requestId: number, name: string, mime: string, data: string): Promise<void> {
    try {
      if (this.document.uri.scheme === 'untitled') throw new Error('save the Markdown file first');
      const folder = vscode.workspace.getConfiguration(SECTION, this.document.uri).get<string>('image.folder', 'images').replace(/^[/\\]+|[/\\]+$/g, '');
      const dir = vscode.Uri.joinPath(this.document.uri, '..', ...(folder ? folder.split(/[/\\]+/) : []));
      await vscode.workspace.fs.createDirectory(dir);
      const fileName = await uniqueName(dir, imageName(name, mime));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, fileName), Buffer.from(data, 'base64'));
      const rel = folder ? `${folder.replace(/\\/g, '/')}/${fileName}` : fileName;
      this.log.info(`${this.fileName()}: saved image ${rel}`);
      this.post({ type: 'imageSaved', requestId, path: rel });
    } catch (e) {
      this.post({ type: 'imageSaved', requestId, error: (e as Error).message });
    }
  }

  private async runCommand(command: ToolbarCommand): Promise<void> {
    const uri = this.document.uri;
    switch (command) {
      case 'save':
        await this.flushAndApply();
        await this.document.save();
        break;
      case 'openText':
        await vscode.commands.executeCommand('mdStudio.openTextEditor', uri);
        break;
      case 'export':
        await vscode.commands.executeCommand('mdStudio.exportHtml', uri);
        break;
      case 'settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${this.context.extension.id}`);
        break;
    }
  }

  private async openLink(href: string): Promise<void> {
    if (/^(https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    const [p] = href.split('#');
    let decoded = p;
    try {
      decoded = decodeURI(p);
    } catch {
      /* use as is */
    }
    const target = vscode.Uri.joinPath(this.document.uri, '..', decoded);
    await vscode.commands.executeCommand('vscode.open', target);
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

function imageName(name: string, mime: string): string {
  const ext = path.extname(name).toLowerCase() || EXT_BY_MIME[mime] || '.png';
  let base = path.basename(name, path.extname(name)).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!base || /^image$/i.test(base)) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    base = `image-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  return base + ext;
}

async function uniqueName(dir: vscode.Uri, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? name : `${base}-${i}${ext}`;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, candidate));
    } catch {
      return candidate;
    }
  }
}
