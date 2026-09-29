// Prints a self-contained HTML file to PDF with a locally installed Chromium-based browser
// (Edge / Chrome / Chromium) driven over the DevTools protocol on a pipe. No network access:
// every host name resolves to nothing and no port is opened.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PrintOptions {
  landscape?: boolean;
  paperWidth?: number; // inches
  paperHeight?: number; // inches
  marginTop?: number; // inches
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  generateDocumentOutline?: boolean;
  scale?: number;
  preferCSSPageSize?: boolean;
}

/** Candidate browser executables for this OS, most preferred first. */
export function browserCandidates(platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean) as string[];
    return roots.flatMap((r) => [
      path.win32.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  const dirs = (env.PATH ?? '/usr/bin:/usr/local/bin').split(':');
  const names = ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  return [...names.flatMap((n) => dirs.map((d) => path.join(d, n))), '/snap/bin/chromium'];
}

export function findBrowser(configured?: string): string | undefined {
  if (configured) return existsSync(configured) ? configured : undefined;
  return browserCandidates().find((p) => existsSync(p));
}

/** Every installed browser to try, the configured one first. */
export function allBrowsers(configured?: string): string[] {
  const list = configured && existsSync(configured) ? [configured] : [];
  for (const p of browserCandidates()) if (existsSync(p) && !list.includes(p)) list.push(p);
  return list;
}

/**
 * Environment for the browser: without VS Code's own variables (the extension host runs with
 * ELECTRON_RUN_AS_NODE etc., which are meaningless or harmful for another Chromium).
 */
function browserEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(ELECTRON_|VSCODE_|CHROME_CRASHPAD)/i.test(k)) env[k] = v;
  }
  return env;
}

/**
 * Browser policies that block background printing, read from the Windows registry
 * (e.g. "Edge HeadlessModeEnabled = 0 (HKLM)"). Empty on other systems or when none are set.
 */
export async function blockingPolicies(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const found: string[] = [];
  for (const [name, key] of [
    ['Edge', 'SOFTWARE\\Policies\\Microsoft\\Edge'],
    ['Chrome', 'SOFTWARE\\Policies\\Google\\Chrome'],
  ]) {
    for (const hive of ['HKLM', 'HKCU']) {
      const out = await new Promise<string>((resolve) =>
        execFile('reg', ['query', `${hive}\\${key}`], { windowsHide: true, timeout: 5000 }, (_e, stdout) => resolve(stdout ?? '')),
      );
      for (const m of out.matchAll(/^\s*(HeadlessModeEnabled|RemoteDebuggingAllowed)\s+REG_DWORD\s+0x([0-9a-f]+)/gim)) {
        found.push(`${name} ${m[1]} = ${parseInt(m[2], 16)} (${hive})`);
      }
    }
  }
  return found;
}

/** Flags shared by both print methods: no first-run UI, no background traffic, no name resolution. */
function quietFlags(profile: string): string[] {
  return [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--mute-audio',
    // Chromium refuses to start as root with its sandbox (containers, some remote hosts).
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ];
}

/**
 * Prints with the browser's own `--print-to-pdf` switch (one browser process per file). Page size,
 * margins, page numbers and header come from the page's CSS `@page` rules. This does not need the
 * DevTools protocol, which some company policies turn off (RemoteDebuggingAllowed).
 */
export function printPdfCli(browser: string, htmlFile: string, o: { outline: boolean; timeoutMs?: number }): Promise<Buffer> {
  const profile = mkdtempSync(path.join(tmpdir(), 'md-studio-pdf-'));
  const out = path.join(profile, 'out.pdf');
  const args = [
    '--headless',
    '--disable-gpu',
    ...quietFlags(profile),
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    // Windows builds only write their log (e.g. "disallowed by policy") when asked to.
    '--enable-logging=stderr',
    ...(o.outline ? ['--generate-pdf-document-outline'] : []),
    `--print-to-pdf=${out}`,
    pathToFileURL(htmlFile).href,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: browserEnv() });
    let log = '';
    const keep = (d: Buffer) => (log = (log + d).slice(-4000));
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => child.kill(), o.timeoutMs ?? 120_000);
    const done = (e?: Error) => {
      clearTimeout(timer);
      let pdf: Buffer | undefined;
      try {
        pdf = readFileSync(out);
      } catch {
        /* no output */
      }
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000);
      if (pdf && pdf.length > 0) resolve(pdf);
      else reject(e ?? new Error(`no PDF was written. ${lastLines(log)}`));
    };
    child.on('error', (e) => done(new Error(`cannot start ${browser}: ${e.message}`)));
    child.on('exit', (code) => done(code ? new Error(`browser exited with code ${code}. ${lastLines(log)}`) : undefined));
  });
}

function lastLines(log: string): string {
  const lines = log.split(/\r?\n/).filter((l) => l.trim() && !/dbus|Fontconfig|GPU|gpu_|viz_|crashpad/i.test(l));
  const telling = lines.filter((l) => /polic|disallow|admin|headless|denied|not allowed|sandbox/i.test(l));
  return (telling.length ? telling : lines).slice(-3).join(' ').trim();
}

class Cdp {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private readonly listeners: Array<(msg: any) => void> = [];

  private readonly write: NodeJS.WritableStream;

  constructor(write: NodeJS.WritableStream, read: NodeJS.ReadableStream) {
    this.write = write;
    read.setEncoding?.('utf8');
    read.on('error', () => undefined); // surfaced through the process 'exit' handler
    write.on('error', () => undefined);
    read.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const msg = JSON.parse(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
          else p.resolve(msg.result);
        } else {
          for (const l of this.listeners) l(msg);
        }
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }

  waitFor(method: string, sessionId?: string): Promise<any> {
    return new Promise((resolve) => {
      const l = (msg: any) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          resolve(msg.params);
        }
      };
      this.listeners.push(l);
    });
  }

  failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
}

/** A running headless browser that can print several pages. */
export class PdfPrinter {
  private readonly cdp: Cdp;
  private readonly kill: () => void;

  private constructor(cdp: Cdp, kill: () => void) {
    this.cdp = cdp;
    this.kill = kill;
  }

  static async launch(browser: string, timeoutMs = 60_000): Promise<PdfPrinter> {
    const profile = mkdtempSync(path.join(tmpdir(), 'md-studio-pdf-'));
    const child = spawn(
      browser,
      ['--headless=new', '--remote-debugging-pipe', '--enable-logging=stderr', ...quietFlags(profile), 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true, env: browserEnv() },
    );
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    const cdp = new Cdp(child.stdio[3] as NodeJS.WritableStream, child.stdio[4] as NodeJS.ReadableStream);
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000);
    };
    const failed = new Promise<never>((_, reject) => {
      child.on('error', (e) => reject(new Error(`Cannot start ${browser}: ${e.message}`)));
      child.on('exit', (code) => {
        const e = new Error(`Browser exited (code ${code}). ${lastLines(stderr)}`);
        cdp.failAll(e);
        reject(e);
      });
    });
    failed.catch(() => undefined);
    const timer = setTimeout(kill, timeoutMs);
    try {
      await Promise.race([cdp.send('Browser.getVersion'), failed]);
    } catch (e) {
      kill();
      throw e;
    } finally {
      clearTimeout(timer);
    }
    return new PdfPrinter(cdp, kill);
  }

  async version(): Promise<string> {
    return (await this.cdp.send('Browser.getVersion')).product as string;
  }

  /** Loads `htmlFile` and prints it. */
  async print(htmlFile: string, options: PrintOptions): Promise<Buffer> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    try {
      await this.cdp.send('Page.enable', {}, sessionId);
      const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId);
      await this.cdp.send('Page.navigate', { url: pathToFileURL(htmlFile).href }, sessionId);
      await loaded;
      await this.cdp.send(
        'Runtime.evaluate',
        { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true },
        sessionId,
      );
      const { data } = await this.cdp.send('Page.printToPDF', { ...options }, sessionId);
      return Buffer.from(data, 'base64');
    } finally {
      await this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.cdp.send('Browser.close').catch(() => undefined);
    this.kill();
  }
}

/**
 * Page number (1-based) of every named destination in a Chromium-made PDF. Chromium writes a
 * destination for each element id that an internal link points to, so linking the table of contents
 * to the headings tells us the page of each heading. Returns an empty map if the layout is unexpected.
 */
export function namedDestinationPages(pdf: Buffer): Map<string, number> {
  const s = pdf.toString('latin1');
  const result = new Map<string, number>();
  const objText = (n: string): string | undefined => {
    const m = new RegExp(`(?:^|[\\r\\n])${n} 0 obj\\b`).exec(s);
    if (!m) return undefined;
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    const text = s.slice(start, end < 0 ? undefined : end);
    const stream = text.indexOf('stream');
    return stream >= 0 ? text.slice(0, stream) : text;
  };
  const catalog = /\/Type\s*\/Catalog\b[\s\S]*?>>/.exec(s)?.[0] ?? '';
  const pagesRef = /\/Pages\s+(\d+)\s+0\s+R/.exec(catalog)?.[1];
  const destsRef = /\/Dests\s+(\d+)\s+0\s+R/.exec(catalog)?.[1];
  if (!pagesRef || !destsRef) return result;

  // Page object number -> page index, walking the page tree in order.
  const pageIndex = new Map<string, number>();
  const walk = (ref: string, depth: number) => {
    if (depth > 32) return;
    const t = objText(ref) ?? '';
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(t);
    if (/\/Type\s*\/Pages\b/.test(t) && kids) {
      for (const k of kids[1].matchAll(/(\d+)\s+0\s+R/g)) walk(k[1], depth + 1);
    } else {
      pageIndex.set(ref, pageIndex.size + 1);
    }
  };
  walk(pagesRef, 0);

  const dests = objText(destsRef) ?? '';
  for (const m of dests.matchAll(/\/((?:[^\s/\[\]()<>{}%]|#[0-9A-Fa-f]{2})+)\s*\[\s*(\d+)\s+0\s+R/g)) {
    const page = pageIndex.get(m[2]);
    if (page) result.set(decodeName(m[1]), page);
  }
  return result;
}

function decodeName(raw: string): string {
  const bytes = raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const utf8 = Buffer.from(bytes, 'latin1').toString('utf8');
  try {
    return decodeURIComponent(utf8);
  } catch {
    return utf8;
  }
}

export const PAPER_SIZES: Record<string, [number, number]> = {
  A4: [8.27, 11.69],
  A3: [11.69, 16.54],
  B5: [7.17, 10.12],
  Letter: [8.5, 11],
  Legal: [8.5, 14],
};
