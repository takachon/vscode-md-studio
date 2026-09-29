// Updates from an in-house location instead of the Marketplace:
//   - a folder (local, mounted or UNC share) holding md-studio-<version>.vsix files, or
//   - an intranet URL serving latest.json ({"version": "x.y.z", "file": "md-studio-x.y.z.vsix"}).
// Nothing is contacted unless mdStudio.update.source is set.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { SECTION } from './settings';
import type { Log } from './log';
import { compareVersions, newestVsix } from './versions';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SKIP_KEY = 'mdStudio.update.skipVersion';

interface Available {
  version: string;
  /** Local file to install (downloaded first for URLs). */
  fetch: () => Promise<vscode.Uri>;
}

export class Updater implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Log,
  ) {}

  start(): void {
    setTimeout(() => void this.check(false), 15_000);
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get current(): string {
    return String(this.context.extension.packageJSON.version);
  }

  private get name(): string {
    return String(this.context.extension.packageJSON.name);
  }

  private source(): string {
    let s = vscode.workspace.getConfiguration(`${SECTION}.update`).get<string>('source', '').trim();
    if (s.startsWith('~')) s = path.join(homedir(), s.slice(1));
    return s;
  }

  private async find(source: string): Promise<Available | undefined> {
    if (/^https?:\/\//i.test(source)) {
      const base = source.endsWith('/') ? source : `${source}/`;
      const res = await fetch(new URL('latest.json', base), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${base}latest.json`);
      const info = (await res.json()) as { version?: string; file?: string };
      if (!info.version) throw new Error(`${base}latest.json has no "version"`);
      const file = info.file ?? `${this.name}-${info.version}.vsix`;
      return {
        version: info.version,
        fetch: async () => {
          const r = await fetch(new URL(file, base), { signal: AbortSignal.timeout(120_000) });
          if (!r.ok) throw new Error(`${r.status} ${r.statusText} downloading ${file}`);
          const dest = vscode.Uri.file(path.join(mkdtempSync(path.join(tmpdir(), 'md-studio-update-')), path.basename(file)));
          await vscode.workspace.fs.writeFile(dest, new Uint8Array(await r.arrayBuffer()));
          return dest;
        },
      };
    }
    const dir = vscode.Uri.file(source);
    const entries = await vscode.workspace.fs.readDirectory(dir);
    const best = newestVsix(entries.filter(([, t]) => t === vscode.FileType.File).map(([n]) => n), this.name);
    return best && { version: best.version, fetch: async () => vscode.Uri.joinPath(dir, best.file) };
  }

  /** Looks for a newer version; `manual` = started from the command (always reports the outcome). */
  async check(manual: boolean): Promise<void> {
    const source = this.source();
    if (!source) {
      if (manual) {
        const pick = await vscode.window.showInformationMessage(
          'Set mdStudio.update.source to the shared folder (or intranet URL) where new .vsix files are published.',
          'Open Settings',
        );
        if (pick) await vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.update`);
      }
      return;
    }
    if (this.checking) return;
    this.checking = true;
    try {
      let found: Available | undefined;
      try {
        found = await this.find(source);
      } finally {
        // Not "checking" while a notification waits for an answer (a manual check can show it again).
        this.checking = false;
      }
      if (!found || compareVersions(found.version, this.current) <= 0) {
        this.log.info(`update: ${this.current} is the latest (${source})`);
        if (manual) void vscode.window.showInformationMessage(`MD Studio ${this.current} is up to date.`);
        return;
      }
      const mode = vscode.workspace.getConfiguration(`${SECTION}.update`).get<string>('mode', 'prompt');
      if (!manual && mode === 'prompt' && this.context.globalState.get(SKIP_KEY) === found.version) return;
      this.log.info(`update: ${found.version} available (installed ${this.current})`);
      if (mode === 'auto' && !manual) {
        await this.install(found);
        return;
      }
      const pick = await vscode.window.showInformationMessage(
        `MD Studio ${found.version} is available (installed: ${this.current}).`,
        'Update',
        'Skip This Version',
      );
      if (pick === 'Update') await this.install(found);
      else if (pick === 'Skip This Version') await this.context.globalState.update(SKIP_KEY, found.version);
    } catch (e) {
      this.log.warn(`update check failed: ${(e as Error).message}`);
      if (manual) void vscode.window.showWarningMessage(`MD Studio update check failed: ${(e as Error).message}`);
    }
  }

  private async install(found: Available): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Installing MD Studio ${found.version}` },
      async () => {
        const vsix = await found.fetch();
        await vscode.commands.executeCommand('workbench.extensions.installExtension', vsix);
      },
    );
    this.log.info(`update: installed ${found.version}`);
    const pick = await vscode.window.showInformationMessage(
      `MD Studio ${found.version} was installed. Reload the window to use it.`,
      'Reload Window',
    );
    if (pick) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}
