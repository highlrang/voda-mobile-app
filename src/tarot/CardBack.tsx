import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { TarotTheme } from './theme';

type Props = {
  width: number;
  height: number;
  theme: TarotTheme;
  isTopCard?: boolean;
  isBottomCard?: boolean;
  dimmed?: boolean;
};

// Mirrors DeckCardFace (top card) SVG from web
function TopCardSigil({ sigil, sigilSoft }: { sigil: string; sigilSoft: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 140">
      <Polygon points="50,20 75,35 75,65 50,80 25,65 25,35" fill="none" stroke={sigil} strokeWidth="0.8" opacity="0.4" />
      <Polygon points="50,30 68,42 68,58 50,70 32,58 32,42" fill="none" stroke={sigil} strokeWidth="0.6" opacity="0.35" />
      <Circle cx="50" cy="50" r="5" fill={sigil} opacity="0.42" />
      <Circle cx="50" cy="50" r="2.5" fill={sigil} opacity="0.62" />
      <Circle cx="50" cy="15" r="2" fill={sigilSoft} opacity="0.42" />
      <Circle cx="50" cy="85" r="2" fill={sigilSoft} opacity="0.42" />
      <Line x1="50" y1="50" x2="50" y2="20" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Line x1="50" y1="50" x2="75" y2="35" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Line x1="50" y1="50" x2="75" y2="65" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Line x1="50" y1="50" x2="50" y2="80" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Line x1="50" y1="50" x2="25" y2="65" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Line x1="50" y1="50" x2="25" y2="35" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <SvgText x="50" y="105" fontSize="10" fill={sigil} opacity="0.34" textAnchor="middle" fontStyle="italic" letterSpacing="1">✦ ARCANA ✦</SvgText>
      <SvgText x="50" y="120" fontSize="7" fill={sigilSoft} opacity="0.28" textAnchor="middle" letterSpacing="2">MAJOR</SvgText>
    </Svg>
  );
}

// Mirrors DeckCardFace (bottom card) SVG from web
function BottomCardSigil({ sigil, sigilSoft }: { sigil: string; sigilSoft: string }) {
  const spokes = Array.from({ length: 8 }, (_, idx) => {
    const angle = (idx * 45 - 90) * (Math.PI / 180);
    return { x2: 50 + Math.cos(angle) * 15, y2: 70 + Math.sin(angle) * 15 };
  });
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 140">
      <Rect x="8" y="8" width="84" height="124" fill="none" stroke={sigil} strokeWidth="0.5" opacity="0.34" rx="4" />
      <Rect x="12" y="12" width="76" height="116" fill="none" stroke={sigilSoft} strokeWidth="0.4" opacity="0.28" rx="3" />
      <Circle cx="50" cy="70" r="25" fill="none" stroke={sigil} strokeWidth="0.6" opacity="0.35" />
      <Circle cx="50" cy="70" r="20" fill="none" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Circle cx="50" cy="70" r="15" fill="none" stroke={sigilSoft} strokeWidth="0.4" opacity="0.25" />
      {spokes.map((s, i) => (
        <Line key={i} x1="50" y1="70" x2={s.x2} y2={s.y2} stroke={sigil} strokeWidth="0.4" opacity="0.3" />
      ))}
      <Circle cx="50" cy="70" r="3" fill={sigil} opacity="0.46" />
      <Circle cx="50" cy="70" r="1.5" fill={sigil} opacity="0.66" />
      <Circle cx="50" cy="25" r="8" fill="none" stroke={sigil} strokeWidth="0.5" opacity="0.3" />
      <Circle cx="50" cy="25" r="5" fill="none" stroke={sigilSoft} strokeWidth="0.4" opacity="0.25" />
      <Circle cx="50" cy="25" r="2" fill={sigil} opacity="0.38" />
      <SvgText x="20" y="22" fontSize="8" fill={sigilSoft} opacity="0.3">✦</SvgText>
      <SvgText x="77" y="22" fontSize="8" fill={sigilSoft} opacity="0.3">✦</SvgText>
      <SvgText x="20" y="126" fontSize="8" fill={sigilSoft} opacity="0.3">✦</SvgText>
      <SvgText x="77" y="126" fontSize="8" fill={sigilSoft} opacity="0.3">✦</SvgText>
      <SvgText x="50" y="112" fontSize="7" fill={sigil} opacity="0.28" textAnchor="middle" fontStyle="italic">TAROT</SvgText>
      <SvgText x="50" y="122" fontSize="6" fill={sigilSoft} opacity="0.24" textAnchor="middle" fontStyle="italic">MYSTIC ORACLE</SvgText>
    </Svg>
  );
}

export default function CardBack({ width, height, theme, isTopCard, isBottomCard, dimmed }: Props) {
  const r = Math.round(width * 0.09);

  return (
    <LinearGradient
      colors={[theme.cardStart, theme.cardMid, theme.cardEnd]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.15, y: 1 }}
      style={[styles.card, { width, height, borderRadius: r, opacity: dimmed ? 0.3 : 1, borderColor: theme.cardBorder }]}
    >
      {/* Highlight overlay */}
      <View style={[styles.highlight, { borderRadius: r }]} />

      {/* Inner border */}
      <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 0.5, borderColor: theme.cardLineSoft }]} />

      {/* Sigil */}
      {isTopCard && (
        <View style={StyleSheet.absoluteFill}>
          <TopCardSigil sigil={theme.cardSigil} sigilSoft={theme.cardSigilSoft} />
        </View>
      )}
      {isBottomCard && !isTopCard && (
        <View style={StyleSheet.absoluteFill}>
          <BottomCardSigil sigil={theme.cardSigil} sigilSoft={theme.cardSigilSoft} />
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.7,
    overflow: 'hidden',
  },
  highlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
});
