// Highlights the outline entry of the section at the top of the editor, like Office Viewer.

function editingRoot(): HTMLElement | undefined {
  for (const el of document.querySelectorAll<HTMLElement>('.vditor-wysiwyg > .vditor-reset, .vditor-ir > .vditor-reset')) {
    if (el.offsetParent !== null) return el;
  }
  return undefined;
}

export function currentHeadingId(): string | undefined {
  const root = editingRoot();
  if (!root) return undefined;
  const top = root.getBoundingClientRect().top;
  const headings = root.querySelectorAll<HTMLElement>(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
  let current: HTMLElement | undefined = headings[0];
  for (const h of headings) {
    if (h.getBoundingClientRect().top - top <= 48) current = h;
    else break;
  }
  return current?.id || undefined;
}

export function installOutlineSpy(): void {
  let scheduled = false;
  let lastId: string | undefined;
  const update = () => {
    scheduled = false;
    const outline = document.querySelector<HTMLElement>('.vditor-outline');
    if (!outline || outline.offsetParent === null) return;
    const id = currentHeadingId();
    const spans = outline.querySelectorAll<HTMLElement>('span[data-target-id]');
    let active: HTMLElement | undefined;
    for (const s of spans) {
      const on = !!id && s.dataset.targetId === id;
      s.classList.toggle('md-outline--active', on);
      if (on) active = s;
    }
    if (active && id !== lastId) {
      const box = outline.querySelector<HTMLElement>('.vditor-outline__content') ?? outline;
      const a = active.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (a.top < b.top || a.bottom > b.bottom) box.scrollTop += a.top - b.top - b.height / 3;
    }
    lastId = id;
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  };
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true });
  schedule();
}
