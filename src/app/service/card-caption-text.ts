import { Card } from '@udonarium/card';
import { StringUtil } from '@udonarium/core/system/util/string-util';

/** True when the viewer may see the card's real name / effect text. */
export function canRevealCardCaption(card: Card | null | undefined): boolean {
  if (!card) return false;
  return !!(card.isFront || card.isHand || card.isGMMode);
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

/** Screen point beside a card (prefer right; flip left near the viewport edge). */
export function anchorBesideCard(el: Element | null): { x: number; y: number; flipX: boolean } {
  if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') {
    return { x: 0, y: 0, flipX: false };
  }
  const r = (el as HTMLElement).getBoundingClientRect();
  const gap = 10;
  const estimateWidth = 160;
  const preferRight = r.right + gap + estimateWidth < (typeof window !== 'undefined' ? window.innerWidth : 1e9);
  return {
    x: preferRight ? r.right + gap : r.left - gap,
    y: r.top + r.height / 2,
    flipX: !preferRight,
  };
}
