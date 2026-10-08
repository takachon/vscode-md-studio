// Vditor places its WYSIWYG popover (code-block language, table, link, ...) 21px above the block
// using offsetTop/offsetLeft. The document is scaled with CSS zoom (Ctrl+wheel), and how those
// offsets relate to the zoomed page differs between Chromium versions, so the popover drifted onto
// the block it belongs to. Find the element Vditor placed it for and put the popover above that
// element's on-screen box instead; scrolling and zooming move it the same way.

const GAP = 21; // Vditor's distance between the popover and the block (setPopoverPosition)

function currentZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--md-zoom'));
  return z > 0 ? z : 1;
}

/** The element Vditor positioned the popover for: it wrote data-top = offsetTop - 21. */
function findTarget(area: HTMLElement, content: HTMLElement, dataTop: number, rawLeft: number): HTMLElement | undefined {
  // Vditor's offsets are relative to the editing area (a table cell's would be to its table).
  const placed = (el: HTMLElement) => el.offsetParent === area;
  const distance = (el: HTMLElement) => Math.abs(el.offsetTop - GAP - dataTop);
  // An image is selected by clicking it, without moving the caret.
  const image = [...content.querySelectorAll<HTMLElement>('img')].find((el) => placed(el) && distance(el) === 0 && el.offsetLeft === rawLeft);
  if (image) return image;
  const selection = getSelection();
  const chain: HTMLElement[] = [];
  let node: Node | null = selection && selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
  for (; node && node !== content; node = node.parentNode) if (node instanceof HTMLElement && placed(node)) chain.push(node);
  // data-top can be stale already: closing another code block's editor moves the block right after.
  const nearest = Math.min(...chain.map(distance));
  // Of equally near ones, Vditor wrote left = min(offsetLeft, right margin).
  const near = chain.filter((el) => distance(el) === nearest);
  return near.find((el) => el.offsetLeft >= rawLeft - 0.5) ?? near[0];
}

export function installPopoverZoom(): void {
  const area = document.querySelector<HTMLElement>('.vditor-wysiwyg');
  const content = area?.querySelector<HTMLElement>(':scope > .vditor-reset');
  const popover = area?.querySelector<HTMLElement>(':scope > .vditor-panel--none');
  if (!area || !content || !popover) return;
  let written = '';
  let rawLeft = NaN;
  let target: HTMLElement | undefined;
  const place = () => {
    const dataTop = parseFloat(popover.getAttribute('data-top') ?? '');
    if (popover.style.display !== 'block') return;
    const width = popover.offsetWidth;
    const maxLeft = area.clientWidth - width;
    if (target?.isConnected) {
      const box = target.getBoundingClientRect();
      const frame = area.getBoundingClientRect();
      const view = content.getBoundingClientRect();
      const top = box.top - frame.top - GAP;
      popover.style.top = `${Math.max(-8, Math.min(top, view.bottom - frame.top - GAP))}px`;
      popover.style.left = `${Math.max(0, Math.min(box.left - frame.left, maxLeft))}px`;
    } else if (Number.isFinite(dataTop) && Number.isFinite(rawLeft)) {
      // Unknown target: assume offsets, scrollTop and client sizes are unzoomed (current Chromium).
      const zoom = currentZoom();
      const top = (dataTop + GAP - content.scrollTop) * zoom - GAP;
      popover.style.top = `${Math.max(-8, Math.min(top, content.clientHeight * zoom - GAP))}px`;
      const offset = rawLeft < content.clientWidth - width ? rawLeft * zoom : Infinity;
      popover.style.left = `${Math.max(0, Math.min(offset, content.clientWidth * zoom - width, maxLeft))}px`;
    }
    written = popover.style.cssText;
  };
  new MutationObserver((records) => {
    // A new position always rewrites data-top too; scrolling and zooming move only the top.
    if (records.some((r) => r.attributeName === 'data-top')) {
      const dataTop = parseFloat(popover.getAttribute('data-top') ?? '');
      rawLeft = parseFloat(popover.style.left);
      target = Number.isFinite(dataTop) && Number.isFinite(rawLeft) ? findTarget(area, content, dataTop, rawLeft) : undefined;
    } else if (popover.style.cssText === written) return;
    place();
  }).observe(popover, { attributes: true, attributeFilter: ['style', 'data-top'] });
  // The block can move without Vditor noticing: a code block above it closes its editor when the
  // caret leaves, a diagram finishes rendering, text is typed above it.
  let frame = 0;
  new MutationObserver(() => {
    if (frame || popover.style.display !== 'block' || !target) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  }).observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
}

/** Moves an open popover after the zoom changed, the same way scrolling does. */
export function refreshPopover(): void {
  document.querySelector('.vditor-wysiwyg > .vditor-reset')?.dispatchEvent(new Event('scroll'));
}
