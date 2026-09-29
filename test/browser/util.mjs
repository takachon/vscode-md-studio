import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const fixtures = join(import.meta.dirname, '..', 'fixtures');

export async function launch() {
  // Uses PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH when set; otherwise Playwright's default lookup.
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

/** New page that refuses and records every request that does not start with `origin`. */
export async function offlinePage(browser, origin, opts = {}) {
  const page = await browser.newPage(opts);
  const external = [];
  const errors = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (origin && url.startsWith(origin)) return route.continue();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
    external.push(url);
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text());
  });
  return { page, external, errors };
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

/** What the extension host does for `needImages` (see src/export.ts), for fixture files. */
export async function readFixtureImages(srcs) {
  const out = {};
  for (const src of srcs) {
    try {
      const file = join(fixtures, decodeURI(src.replace(/[?#].*$/, '')));
      out[src] = `data:${MIME[extname(file)]};base64,${(await readFile(file)).toString('base64')}`;
    } catch {
      /* missing -> reported as a problem by the webview */
    }
  }
  return out;
}
