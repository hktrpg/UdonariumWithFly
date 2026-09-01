import { Card } from '@udonarium/card';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { GmCardPeek } from '@udonarium/gm-card-peek';

/** True when the viewer may see the card's real name / effect text. */
export function canRevealCardCaption(card: Card | null | undefined): boolean {
  if (!card) return false;
  return !!(card.isFront || card.isHand || GmCardPeek.active);
}

/** Same gate as caption — face-down table cards must not open detail (spoilers). */
export function canOpenCardDetail(card: Card | null | undefined): boolean {
  return canRevealCardCaption(card);
}

export function cardCaptionName(card: Card | null | undefined, backLabel: string): string {
  if (!card) return '';
  if (canRevealCardCaption(card)) return card.name || '';
  return backLabel || '';
}

export function cardCaptionRubiedText(card: Card | null | undefined): string {
  if (!card || !canRevealCardCaption(card)) return '';
  return cardEffectRubiedText(card);
}

/** Rubied card.text without visibility gate (hand rail face is always shown). */
export function cardEffectRubiedText(card: Card | null | undefined): string {
  if (!card) return '';
  const raw = (card.text || '').trim();
  if (!raw) return '';
  return StringUtil.rubyToHtml(StringUtil.escapeHtml(raw));
}

export function anchorFromElement(el: Element | null): { x: number; y: number } {
  if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') {
    return { x: 0, y: 0 };
  }
  const r = (el as HTMLElement).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

/**
 * Table `<card>` / `<card-stack>` hosts are transform-free (often ~0×0).
 * Caption must anchor to the movable visual (`.component` / `.card-image`).
 */
export function resolveCardCaptionVisualEl(host: Element | null): Element | null {
  if (!host) return null;
  const root = host as HTMLElement;
  return (
    root.querySelector('.stack-top .card-image')
    || root.querySelector('.card-image')
    || root.querySelector('.component-content')
    || root.querySelector('.component')
    || root
  );
}

/** Screen point beside a card (prefer right; flip left near the viewport edge). */
export function anchorBesideCard(el: Element | null): { x: number; y: number; flipX: boolean } {
  if (!el) return { x: 0, y: 0, flipX: false };
  const visual = resolveCardCaptionVisualEl(el) ?? el;
  const r = (visual as HTMLElement).getBoundingClientRect();
  if (r.width < 1 && r.height < 1) {
    const fallback =
      (el as HTMLElement).querySelector?.('.component') as HTMLElement | null
      || (el as HTMLElement);
    if (fallback !== visual) return anchorBesideCardRaw(fallback);
  }
  return anchorBesideCardRaw(visual as HTMLElement);
}

function anchorBesideCardRaw(el: HTMLElement): { x: number; y: number; flipX: boolean } {
  const r = el.getBoundingClientRect();
  const gap = 10;
  const estimateWidth = 160;
  const preferRight = r.right + gap + estimateWidth < (typeof window !== 'undefined' ? window.innerWidth : 1e9);
  return {
    x: preferRight ? r.right + gap : r.left - gap,
    y: r.top + r.height / 2,
    flipX: !preferRight,
  };
}
