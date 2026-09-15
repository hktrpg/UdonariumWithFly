/** Token hover / pinned quick-display panels (overview-panel host + surface root). */
export const OVERVIEW_PANEL_SURFACE_SELECTOR = 'overview-panel, .overview-panel-surface';

/**
 * True when a dblclick originated on (or inside) an interactive control.
 * Rapid clicks on PDF next/prev, video controls, inputs, etc. must not open
 * object detail panels via parent (dblclick) handlers.
 */
export function isInteractiveControlTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest(
    [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      'option',
      'label',
      'video',
      'audio',
      'summary',
      '[contenteditable="true"]',
      '[role="button"]',
      '[data-no-dblclick]',
      OVERVIEW_PANEL_SURFACE_SELECTOR,
      '.pdf-nav',
      '.pdf-btn',
      '.nav-btn',
      '.resize-grab',
      '.rotate-grab',
    ].join(','),
  );
  return !!el;
}

export function isOverviewPanelTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(OVERVIEW_PANEL_SURFACE_SELECTOR);
}

/** True when viewport coordinates fall inside a visible overview quick panel. */
export function isPointOverOverviewPanel(x: number, y: number, doc: Document = document): boolean {
  const panels = doc.querySelectorAll<HTMLElement>('.overview-panel-surface');
  for (const panel of Array.from(panels)) {
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return true;
  }
  return false;
}

function stopTabletopInteract(e: Event): void {
  e.stopPropagation();
  e.preventDefault?.();
}

/** Call at the start of tabletop onDoubleClick handlers. */
export function shouldIgnoreTabletopDoubleClick(e: Event | null | undefined): boolean {
  if (!e) return false;
  if (isInteractiveControlTarget(e.target)) {
    stopTabletopInteract(e);
    return true;
  }
  if (e instanceof MouseEvent && isPointOverOverviewPanel(e.clientX, e.clientY, e.view?.document ?? document)) {
    stopTabletopInteract(e);
    return true;
  }
  return false;
}

/** Call before tabletop Hammer tap2 / interact handlers. */
export function shouldIgnoreTabletopObjectInteract(e: Event | null | undefined): boolean {
  return shouldIgnoreTabletopDoubleClick(e);
}
