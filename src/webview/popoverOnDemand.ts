// Vditor's WYSIWYG popover (move up/down, delete, code-block language, table, link, ...) shows up
// above whichever block the caret is in, after every click and key. It stays hidden until the
// block is right-clicked, and goes away again on the next click or key in the document. When
// Vditor moves focus into it (a link inserted from the toolbar), it shows so it can be filled in.

const SHOWN = 'md-popover--shown';

/** The caret position for a right-click at (x, y). */
function caretAt(content: HTMLElement, x: number, y: number): Range | undefined {
  const r = document.caretRangeFromPoint?.(x, y);
  return r && content.contains(r.startContainer) ? r : undefined;
}

function insideSelection(x: number, y: number): boolean {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  return [...sel.getRangeAt(0).getClientRects()].some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
}

export function installPopoverOnDemand(readOnly: () => boolean): void {
  const area = document.querySelector<HTMLElement>('.vditor-wysiwyg');
  const content = area?.querySelector<HTMLElement>(':scope > .vditor-reset');
  const popover = area?.querySelector<HTMLElement>(':scope > .vditor-panel--none');
  if (!area || !content || !popover) return;
  const hide = () => popover.classList.remove(SHOWN);

  content.addEventListener('contextmenu', (e) => {
    // Right-clicking selected text keeps the usual menu (Copy, Paste); images have their own menu.
    if (readOnly() || e.defaultPrevented || insideSelection(e.clientX, e.clientY)) return;
    const target = e.target as HTMLElement;
    // A rendered diagram or formula is not editable: open its source the way a left click does.
    const preview = target.closest<HTMLElement>('.vditor-wysiwyg__preview');
    const range = preview ? undefined : caretAt(content, e.clientX, e.clientY);
    if (!preview && !range) return;
    e.preventDefault();
    // Vditor places the popover for the caret's block a moment later; until then the one for the
    // block clicked before must not show.
    popover.style.display = 'none';
    popover.classList.add(SHOWN);
    if (preview) {
      preview.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      return;
    }
    range!.collapse(true);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range!);
    content.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true }));
  });
  content.addEventListener('mousedown', (e) => {
    if (e.button === 0) hide();
  }, true);
  content.addEventListener('keydown', (e) => {
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) hide();
  }, true);
  popover.addEventListener('focusin', () => popover.classList.add(SHOWN));
}
