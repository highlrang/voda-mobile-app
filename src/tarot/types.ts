export type ConsultationType = 'saju' | 'tarot' | 'comprehensive' | null;

export type TarotNativeState = {
  homeDailyDraw?: boolean;
  selectedType?: ConsultationType;
  selectedScenario?: string;
  selectedScenarioTitle?: string;
  question?: string;
  tarotDeckVersionId?: string;
  deckOrder?: number[];
  selectedCards?: number[];
};

export const TOTAL_CARDS = 78;
export const MAX_SELECTIONS = 3;
export const DEFAULT_TAROT_DECK_ID = 'classic-rider-waite';

export function makeDefaultDeckOrder(): number[] {
  return Array.from({ length: TOTAL_CARDS }, (_, i) => i);
}

export function shuffleDeck(order: number[]): number[] {
  const next = [...order];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
