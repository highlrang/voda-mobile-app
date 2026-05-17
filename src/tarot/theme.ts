export type TarotTheme = {
  ambientStart: string; ambientMid: string; ambientEnd: string;
  ambientBlobA: string; ambientBlobB: string;
  textMain: string; textMuted: string;
  surfaceBg: string; surfaceBorder: string;
  ctaStart: string; ctaMid: string; ctaEnd: string; ctaBorder: string;
  cardStart: string; cardMid: string; cardEnd: string;
  cardBorder: string; cardGlow: string; cardLineSoft: string;
  cardSigil: string; cardSigilSoft: string;
  accentGlowSoft: string; gold: string;
};

export const darkTheme: TarotTheme = {
  ambientStart: '#1e1b4b',
  ambientMid: '#312e81',
  ambientEnd: '#2e1065',
  ambientBlobA: 'rgba(173,136,255,0.24)',
  ambientBlobB: 'rgba(223,188,95,0.12)',

  textMain: '#f1efff',
  textMuted: 'rgba(241,239,255,0.76)',

  surfaceBg: 'rgba(255,255,255,0.07)',
  surfaceBorder: 'rgba(223,188,95,0.38)',

  ctaStart: 'rgba(223,188,95,0.3)',
  ctaMid: 'rgba(173,136,255,0.32)',
  ctaEnd: 'rgba(45,34,78,0.84)',
  ctaBorder: 'rgba(223,188,95,0.42)',

  cardStart: 'rgba(76,29,149,0.9)',
  cardMid: 'rgba(91,33,182,0.85)',
  cardEnd: 'rgba(76,29,149,0.9)',
  cardBorder: 'rgba(223,188,95,0.4)',
  cardGlow: 'rgba(168,85,247,0.35)',
  cardLineSoft: 'rgba(255,255,255,0.24)',
  cardSigil: 'rgba(255,255,255,0.55)',
  cardSigilSoft: 'rgba(255,255,255,0.5)',

  accentGlowSoft: 'rgba(173,136,255,0.28)',
  gold: '#dfbe66',
};

export const lightTheme: TarotTheme = {
  ambientStart: 'rgba(248,247,244,0.99)',
  ambientMid: 'rgba(240,235,255,0.68)',
  ambientEnd: 'rgba(248,247,244,0.99)',
  ambientBlobA: 'rgba(210,190,255,0.18)',
  ambientBlobB: 'rgba(214,188,132,0.18)',

  textMain: '#3a3a3a',
  textMuted: 'rgba(58,58,58,0.62)',

  surfaceBg: 'rgba(255,255,255,0.72)',
  surfaceBorder: 'rgba(196,168,108,0.52)',

  ctaStart: 'rgba(214,188,132,0.32)',
  ctaMid: 'rgba(210,190,255,0.14)',
  ctaEnd: 'rgba(255,255,255,0.60)',
  ctaBorder: 'rgba(196,168,108,0.52)',

  cardStart: 'rgba(255,251,238,1.0)',
  cardMid: 'rgba(240,218,158,0.99)',
  cardEnd: 'rgba(222,188,112,0.97)',
  cardBorder: 'rgba(140,108,48,0.40)',
  cardGlow: 'rgba(214,188,132,0.42)',
  cardLineSoft: 'rgba(45,32,8,0.14)',
  cardSigil: 'rgba(110,78,28,0.68)',
  cardSigilSoft: 'rgba(148,112,52,0.44)',

  accentGlowSoft: 'rgba(210,190,255,0.18)',
  gold: '#c8a85e',
};

// Star positions deterministic (same as web's STATIC_STARS)
function fract(v: number) { return v - Math.floor(v); }
export const STATIC_STARS = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  left: fract(Math.sin(i * 12.9898) * 43758.5453),
  top: fract(Math.sin((i + 1) * 78.233) * 12345.6789),
  opacity: 0.14 + fract(Math.sin((i + 1) * 4.123) * 2468.1357) * 0.38,
}));
