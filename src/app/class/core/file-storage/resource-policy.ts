export type ResourceTier = 'low' | 'medium' | 'high';

export interface ResourcePolicy {
  tier: ResourceTier;
  maxConcurrentReceives: number;
  maxConcurrentHydrate: number;
  pdfMaxWidthPx: number;
  pdfMaxScale: number;
  showMemoryWarning: boolean;
  weatherAudioPreload: 'auto' | 'metadata';
}

export const RESOURCE_POLICY_TABLE: Record<ResourceTier, ResourcePolicy> = {
  low: {
    tier: 'low',
    maxConcurrentReceives: 2,
    maxConcurrentHydrate: 2,
    pdfMaxWidthPx: 800,
    pdfMaxScale: 2,
    showMemoryWarning: true,
    weatherAudioPreload: 'metadata',
  },
  medium: {
    tier: 'medium',
    maxConcurrentReceives: 2,
    maxConcurrentHydrate: 3,
    pdfMaxWidthPx: 1200,
    pdfMaxScale: 3,
    showMemoryWarning: false,
    weatherAudioPreload: 'metadata',
  },
  high: {
    tier: 'high',
    maxConcurrentReceives: 4,
    maxConcurrentHydrate: 4,
    pdfMaxWidthPx: 1600,
    pdfMaxScale: 4,
    showMemoryWarning: false,
    weatherAudioPreload: 'auto',
  },
};

let activePolicy: ResourcePolicy = RESOURCE_POLICY_TABLE.high;

export function getResourcePolicy(): ResourcePolicy {
  return activePolicy;
}

export function applyResourcePolicy(tier: ResourceTier): ResourcePolicy {
  activePolicy = RESOURCE_POLICY_TABLE[tier];
  return activePolicy;
}

/** ~512 MB stored blob bytes triggers low tier on mobile. */
export const MOBILE_LOW_TIER_TOTAL_BYTES = 512 * 1024 * 1024;
