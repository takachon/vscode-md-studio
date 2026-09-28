// Prints a self-contained HTML file to PDF with a locally installed Chromium-based browser
// (Edge / Chrome / Chromium) driven over the DevTools protocol on a pipe. No network access:
// every host name resolves to nothing and no port is opened.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
      [
        '--headless=new',
        '--remote-debugging-pipe',
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
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true },
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
        const e = new Error(`Browser exited (code ${code}). ${stderr.trim().split('\n').slice(-3).join(' ')}`);
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
      const { data } = await this.cdp.send('Page.printToPDF', { ...options, preferCSSPageSize: false }, sessionId);
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
