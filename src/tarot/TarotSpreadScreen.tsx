import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import CardBack from './CardBack';
import { darkTheme, lightTheme, STATIC_STARS, type TarotTheme } from './theme';
import {
  DEFAULT_TAROT_DECK_ID,
  MAX_SELECTIONS,
  TOTAL_CARDS,
  type TarotNativeState,
} from './types';

const CARD_W = 85;
const CARD_H = 128;
const CARD_OVERLAP = 26;
const SLOT_W = 52;
const SLOT_H = 78;
const MAX_FAN_DISTANCE = 8;
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// ─── TarotCard ────────────────────────────────────────────────────────────────

interface TarotCardProps {
  deckIndex: number;
  isSelected: boolean;
  isRaised: boolean;
  cardWidth: number;
  cardHeight: number;
  cardOverlap: number;
  scrollX: SharedValue<number>;
  theme: TarotTheme;
  onPress: (deckIndex: number) => void;
}

const TarotCard = React.memo(function TarotCard({
  deckIndex,
  isSelected,
  isRaised,
  cardWidth,
  cardHeight,
  cardOverlap,
  scrollX,
  theme,
  onPress,
}: TarotCardProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const centeredPosition = scrollX.value / cardOverlap;
    const distanceFromCenter = Math.max(
      -MAX_FAN_DISTANCE,
      Math.min(MAX_FAN_DISTANCE, deckIndex - centeredPosition),
    );
    const deckDistanceFromCenter = deckIndex - (TOTAL_CARDS - 1) / 2;
    const fanTilt = interpolate(
      deckDistanceFromCenter,
      [-(TOTAL_CARDS - 1) / 2, 0, (TOTAL_CARDS - 1) / 2],
      [-16, 0, 16],
      Extrapolation.CLAMP,
    );
    const fanRise = interpolate(
      Math.abs(distanceFromCenter),
      [0, MAX_FAN_DISTANCE],
      [0, 34],
      Extrapolation.CLAMP,
    );
    const deckArc = interpolate(
      Math.abs(deckDistanceFromCenter),
      [0, (TOTAL_CARDS - 1) / 2],
      [0, 12],
      Extrapolation.CLAMP,
    );

    return {
      opacity: isSelected ? 0 : 1,
      transform: [
        { translateY: fanRise + deckArc + (isRaised ? -58 : 0) },
        { rotateZ: `${fanTilt}deg` },
        { scale: isRaised ? 1.08 : 1 },
      ],
    };
  }, [cardOverlap, isRaised]);

  return (
    <Animated.View
      style={[
        styles.cardAbsolute,
        {
          left: deckIndex * cardOverlap,
          zIndex: deckIndex,
          elevation: Math.max(1, Math.min(24, deckIndex + 1)),
        },
        animatedStyle,
      ]}
      pointerEvents={isSelected ? 'none' : 'auto'}
    >
      <Pressable onPress={() => onPress(deckIndex)} disabled={isSelected}>
        <View style={styles.spreadCardShell}>
          <View pointerEvents="none" style={[styles.spreadCardAura, { backgroundColor: theme.accentGlowSoft }]} />
          <CardBack width={cardWidth} height={cardHeight} theme={theme} isTopCard dimmed={isSelected} />
          <View pointerEvents="none" style={[styles.spreadCardGlint, { borderColor: theme.cardLineSoft }]} />
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ─── SelectedSlot ─────────────────────────────────────────────────────────────

function SelectedSlot({
  slotIndex, cardId, slotWidth, slotHeight, onRemove, theme,
}: {
  slotIndex: number;
  cardId: number | null;
  slotWidth: number;
  slotHeight: number;
  onRemove: (slotIndex: number) => void;
  theme: TarotTheme;
}) {
  return (
    <Pressable onPress={() => cardId !== null && onRemove(slotIndex)} style={styles.slot}>
      {cardId !== null ? (
        <CardBack width={slotWidth} height={slotHeight} theme={theme} isTopCard />
      ) : (
        <View style={[styles.emptySlot, { width: slotWidth, height: slotHeight, borderColor: theme.cardBorder }]}>
          <Text style={[styles.slotNumber, { color: theme.textMuted }]}>{slotIndex + 1}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ─── TarotSpreadScreen ────────────────────────────────────────────────────────

type Props = {
  flowState: TarotNativeState;
  deckOrder: number[];
  themePreference?: 'dark' | 'light';
  onConfirm: (selectedCards: number[], deckOrder: number[], tarotDeckVersionId: string) => void;
  onBack: () => void;
};

export default function TarotSpreadScreen({ flowState, deckOrder, themePreference, onConfirm, onBack }: Props) {
  const colorScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const resolvedTheme = themePreference ?? colorScheme ?? 'dark';
  const T = resolvedTheme === 'light' ? lightTheme : darkTheme;
  const isCompactLandscape = width > height && height <= 520;
  const cardWidth = isCompactLandscape ? 76 : CARD_W;
  const cardHeight = Math.round(cardWidth * (CARD_H / CARD_W));
  const cardOverlap = isCompactLandscape ? 24 : CARD_OVERLAP;
  const slotWidth = isCompactLandscape ? 42 : SLOT_W;
  const slotHeight = Math.round(slotWidth * (SLOT_H / SLOT_W));
  const spreadWidth = (TOTAL_CARDS - 1) * cardOverlap + cardWidth;
  const horizontalPadding = width / 2 - cardWidth / 2;
  const spreadStageHeight = cardHeight + (isCompactLandscape ? 82 : 108);

  const scrollX = useSharedValue(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const [centeredIndex, setCenteredIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<(number | null)[]>([null, null, null]);

  const selectedCardIds = new Set(selectedSlots.filter((c): c is number => c !== null));
  const filledCount = selectedSlots.filter((c) => c !== null).length;
  const deckName = flowState.tarotDeckVersionId ?? DEFAULT_TAROT_DECK_ID;

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollX.value = e.contentOffset.x; },
  });

  useAnimatedReaction(
    () => Math.round(scrollX.value / cardOverlap),
    (current, prev) => {
      if (current !== prev) {
        runOnJS(setCenteredIndex)(Math.max(0, Math.min(TOTAL_CARDS - 1, current)));
      }
    },
  );

  const handleCardPress = useCallback(
    (deckIndex: number) => {
      const cardId = deckOrder[deckIndex];

      if (selectedCardIds.has(cardId)) {
        return;
      }

      if (activeIndex === deckIndex) {
        if (filledCount >= MAX_SELECTIONS) return;
        setSelectedSlots((prev) => {
          const next = [...prev];
          const empty = next.findIndex((c) => c === null);
          if (empty !== -1) next[empty] = cardId;
          return next;
        });
        setActiveIndex(null);
        return;
      }

      setActiveIndex(deckIndex);

      if (deckIndex !== centeredIndex) {
        scrollViewRef.current?.scrollTo({ x: deckIndex * cardOverlap, animated: true });
      }
    },
    [activeIndex, centeredIndex, filledCount, deckOrder, selectedCardIds, cardOverlap],
  );

  const handleRemoveSlot = useCallback((slotIndex: number) => {
    const cardId = selectedSlots[slotIndex];
    setSelectedSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
    if (cardId !== null) {
      const deckIndex = deckOrder.findIndex((id) => id === cardId);
      if (deckIndex !== -1) {
        setActiveIndex(deckIndex);
        scrollViewRef.current?.scrollTo({ x: deckIndex * cardOverlap, animated: true });
      }
    }
  }, [cardOverlap, deckOrder, selectedSlots]);

  const handleConfirm = useCallback(() => {
    const cards = selectedSlots.filter((c): c is number => c !== null);
    onConfirm(cards, deckOrder, flowState.tarotDeckVersionId ?? DEFAULT_TAROT_DECK_ID);
  }, [selectedSlots, deckOrder, flowState.tarotDeckVersionId, onConfirm]);

  return (
    <LinearGradient colors={[T.ambientStart, T.ambientMid, T.ambientEnd]} style={styles.fill}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[T.ambientBlobA, 'rgba(255,255,255,0)']}
          start={{ x: 0.2, y: 0.2 }}
          end={{ x: 1, y: 1 }}
          style={styles.ambientBlobA}
        />
        <LinearGradient
          colors={[T.ambientBlobB, 'rgba(255,255,255,0)']}
          start={{ x: 0.78, y: 0.18 }}
          end={{ x: 0, y: 1 }}
          style={styles.ambientBlobB}
        />
        {STATIC_STARS.slice(0, 42).map((star) => (
          <View
            key={star.id}
            style={[
              styles.star,
              {
                left: `${star.left * 100}%`,
                top: `${star.top * 100}%`,
                opacity: star.opacity,
                backgroundColor: T.textMain,
              },
            ]}
          />
        ))}
      </View>

      <SafeAreaView style={styles.fill}>
        {/* Header */}
        <View
          style={[
            styles.header,
            isCompactLandscape && styles.headerCompact,
            { borderBottomColor: T.surfaceBorder },
          ]}
        >
          <Pressable
            onPress={onBack}
            style={[styles.backButton, { borderColor: T.surfaceBorder, backgroundColor: T.surfaceBg }]}
            hitSlop={12}
          >
            <Text style={[styles.backIcon, { color: T.textMain }]}>←</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: T.textMain }]}>타로 카드 선택</Text>
            <Text style={[styles.headerSubtitle, { color: T.textMuted }]}>
              {deckName} · {filledCount} / 3 선택
            </Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Selection indicator dots */}
        <View style={[styles.dotsRow, isCompactLandscape && styles.dotsRowCompact]}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { borderColor: T.cardBorder },
                selectedSlots[i] !== null
                  ? { backgroundColor: T.gold, borderColor: T.gold }
                  : { backgroundColor: 'transparent' },
              ]}
            />
          ))}
        </View>

        {/* Selected slots */}
        <View style={[styles.slotsRow, isCompactLandscape && styles.slotsRowCompact]}>
          {[0, 1, 2].map((i) => (
            <SelectedSlot
              key={i}
              slotIndex={i}
              cardId={selectedSlots[i]}
              slotWidth={slotWidth}
              slotHeight={slotHeight}
              onRemove={handleRemoveSlot}
              theme={T}
            />
          ))}
        </View>

        {/* Card spread */}
        <View style={[styles.spreadContainer, isCompactLandscape && styles.spreadContainerCompact]}>
          <AnimatedScrollView
            ref={scrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={scrollHandler}
            onScrollBeginDrag={() => setActiveIndex(null)}
            scrollEventThrottle={16}
            snapToInterval={cardOverlap}
            decelerationRate="fast"
            contentContainerStyle={[styles.spreadContent, { paddingHorizontal: horizontalPadding }]}
          >
            <View style={{ width: spreadWidth, height: spreadStageHeight }}>
              {deckOrder.map((cardId, deckIndex) => (
                <TarotCard
                  key={cardId}
                  deckIndex={deckIndex}
                  isSelected={selectedCardIds.has(cardId)}
                  isRaised={deckIndex === activeIndex}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  cardOverlap={cardOverlap}
                  scrollX={scrollX}
                  theme={T}
                  onPress={handleCardPress}
                />
              ))}
            </View>
          </AnimatedScrollView>
          <Pressable
            style={[
              styles.centerCardTouchTarget,
              {
                width: cardWidth + 12,
                height: cardHeight + 28,
                marginLeft: -(cardWidth + 12) / 2,
                marginTop: -(cardHeight + 28) / 2,
              },
            ]}
            onPress={() => handleCardPress(centeredIndex)}
            disabled={selectedCardIds.has(deckOrder[centeredIndex])}
          />
        </View>

        {/* Confirm button */}
        <View style={[styles.footer, isCompactLandscape && styles.footerCompact]}>
          {filledCount === MAX_SELECTIONS && (
            <Pressable onPress={handleConfirm} style={styles.confirmButton}>
              <LinearGradient
                colors={[T.ctaStart, T.ctaMid, T.ctaEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.confirmGradient, { borderColor: T.ctaBorder }]}
              >
                <Text style={[styles.confirmText, { color: T.textMain }]}>✦ 운세 보기</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  star: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  ambientBlobA: {
    position: 'absolute',
    left: '10%',
    top: '22%',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.78,
  },
  ambientBlobB: {
    position: 'absolute',
    right: '-6%',
    bottom: '10%',
    width: 380,
    height: 380,
    borderRadius: 190,
    opacity: 0.72,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCompact: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 18 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  headerRight: { width: 36 },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
    paddingBottom: 6,
  },
  dotsRowCompact: {
    paddingTop: 4,
    paddingBottom: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  slotsRowCompact: {
    gap: 8,
    paddingTop: 4,
    paddingBottom: 18,
  },
  slot: {},
  emptySlot: {
    width: SLOT_W,
    height: SLOT_H,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumber: { fontSize: 14, fontWeight: '500' },
  spreadContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  spreadContainerCompact: {
    justifyContent: 'flex-end',
    paddingBottom: 12,
  },
  centerCardTouchTarget: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    zIndex: 1000,
  },
  spreadContent: { alignItems: 'center' },
  cardAbsolute: {
    position: 'absolute',
    top: 48,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  spreadCardShell: {
    overflow: 'visible',
  },
  spreadCardAura: {
    position: 'absolute',
    left: -7,
    right: -7,
    top: -8,
    bottom: -8,
    borderRadius: 12,
    opacity: 0.26,
  },
  spreadCardGlint: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 5,
    bottom: 5,
    borderWidth: 0.5,
    borderRadius: 8,
    opacity: 0.62,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 24,
    alignItems: 'center',
    minHeight: 72,
    justifyContent: 'center',
  },
  footerCompact: {
    minHeight: 54,
    paddingBottom: 10,
  },
  confirmButton: {
    minWidth: 168,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  confirmGradient: {
    paddingVertical: 16,
    paddingHorizontal: 26,
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
  },
  confirmText: { fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
