// Vditor places its WYSIWYG popover (code-block language, table, link, ...) 21px above the block
// using offsetTop/offsetLeft. The document is scaled with CSS zoom (Ctrl+wheel) and those offsets
// are unzoomed, so at any zoom but 100% the popover drifts onto the block it belongs to (or far
// above it). Rescale each position Vditor writes.

const GAP = 21; // Vditor's distance between the popover and the block (setPopoverPosition)

function currentZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--md-zoom'));
  return z > 0 ? z : 1;
}

export function installPopoverZoom(): void {
  const area = document.querySelector<HTMLElement>('.vditor-wysiwyg');
  const content = area?.querySelector<HTMLElement>(':scope > .vditor-reset');
  const popover = area?.querySelector<HTMLElement>(':scope > .vditor-panel--none');
  if (!area || !content || !popover) return;
  let written = '';
  let rawLeft = NaN;
  const fix = (records: MutationRecord[]) => {
    // A new position always rewrites data-top too; scrolling and zooming move only the top.
    if (records.some((r) => r.attributeName === 'data-top')) rawLeft = parseFloat(popover.style.left);
    else if (popover.style.cssText === written) return;
    const dataTop = parseFloat(popover.getAttribute('data-top') ?? '');
    if (popover.style.display !== 'block' || !Number.isFinite(dataTop) || !Number.isFinite(rawLeft)) return;
    const zoom = currentZoom();
    // scrollTop, clientWidth and clientHeight of the zoomed element are unzoomed as well.
    const top = (dataTop + GAP - content.scrollTop) * zoom - GAP;
    popover.style.top = `${Math.max(-8, Math.min(top, content.clientHeight * zoom - GAP))}px`;
    // Vditor clamps the left edge to the right margin; only an unclamped value is an offset.
    const width = popover.clientWidth;
    const offset = rawLeft < content.clientWidth - width ? rawLeft * zoom : Infinity;
    popover.style.left = `${Math.max(0, Math.min(offset, content.clientWidth * zoom - width))}px`;
    written = popover.style.cssText;
  };
  new MutationObserver(fix).observe(popover, { attributes: true, attributeFilter: ['style', 'data-top'] });
}

/** Moves an open popover after the zoom changed, the same way scrolling does. */
export function refreshPopover(): void {
  document.querySelector('.vditor-wysiwyg > .vditor-reset')?.dispatchEvent(new Event('scroll'));
}
