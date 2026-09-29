// Version helpers for the in-house updater (no `vscode` import, so they can be unit tested).

/** Compares dotted versions numerically (pre-release suffixes are ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Newest `<name>-<version>.vsix` among `files`. */
export function newestVsix(files: string[], name: string): { file: string; version: string } | undefined {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+\\.\\d+\\.\\d+)\\.vsix$`, 'i');
  let best: { file: string; version: string } | undefined;
  for (const f of files) {
    const m = re.exec(f);
    if (m && (!best || compareVersions(m[1], best.version) > 0)) best = { file: f, version: m[1] };
  }
  return best;
}
