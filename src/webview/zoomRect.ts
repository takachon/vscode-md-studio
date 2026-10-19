// The document and the outline entries are scaled with CSS zoom (Ctrl+wheel, --md-zoom).

export function currentZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--md-zoom'));
  return z > 0 ? z : 1;
}

/**
 * Factor from getBoundingClientRect() of `zoomed` (an element scaled with CSS zoom) or anything
 * inside it to screen pixels. Chromium 128+ already reports the scaled box (1); older ones report
 * it unscaled, the same as offsetWidth, so things placed from it landed short of the element.
 */
export function rectScale(zoomed: Element): number {
  if (!(zoomed instanceof HTMLElement)) return 1;
  return Math.abs(zoomed.getBoundingClientRect().width - zoomed.offsetWidth) < 1 ? currentZoom() : 1;
}

/** The on-screen box of `el`, which sits in the zoomed element `zoomed`. */
export function screenRect(el: Element, zoomed: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const k = rectScale(zoomed);
  return k === 1 ? r : new DOMRect(r.x * k, r.y * k, r.width * k, r.height * k);
}
