import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import CardBack from './CardBack';
import { darkTheme, lightTheme, STATIC_STARS, type TarotTheme } from './theme';
import {
  DEFAULT_TAROT_DECK_ID,
  makeDefaultDeckOrder,
  shuffleDeck,
  TOTAL_CARDS,
  type TarotNativeState,
} from './types';

// ─── Constants (mirror web) ───────────────────────────────────────────────────
const CARD_W = 220;
const CARD_H = 340;
const CARD_THICKNESS = 1.95;
const SPLIT_GAP = 56;
const SPLIT_TRAVEL = 180;
const SHUFFLE_MS = 1200;
const RANDOM_SHUFFLE_MS = 980;
const RANDOM_SHUFFLE_LAYER_COUNT = TOTAL_CARDS;
const ROTATION_MAX = 30;
const DECK_TOP_TILT = '72deg';
const DECK_TOP_TILT_COMPACT = '68deg';
const DECK_TOP_HEIGHT_SCALE = 1.18;
const DECK_SIDE_WIDTH_COMPENSATION = 0.90;

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  flowState: TarotNativeState;
  themePreference?: 'dark' | 'light';
  onConfirm: (deckOrder: number[], tarotDeckVersionId: string) => void;
  onBack: () => void;
};

function getSinglePassInterleavedOrder(order: number[], cutIndex: number) {
  const upperHalf = order.slice(0, cutIndex);
  const lowerHalf = order.slice(cutIndex);
  const merged: number[] = [];
  let upperIndex = 0;
  let lowerIndex = 0;
  let takeLowerNext = lowerHalf.length >= upperHalf.length;

  while (upperIndex < upperHalf.length || lowerIndex < lowerHalf.length) {
    const currentHalf = takeLowerNext ? lowerHalf : upperHalf;
    const currentIndex = takeLowerNext ? lowerIndex : upperIndex;
    const remaining = currentHalf.length - currentIndex;

    if (remaining <= 0) {
      takeLowerNext = !takeLowerNext;
      continue;
    }

    const packetSize = Math.min(
      remaining,
      1 + Math.floor(Math.random() * (remaining > 2 ? 3 : 2)),
    );

    for (let offset = 0; offset < packetSize; offset += 1) {
      merged.push(currentHalf[currentIndex + offset]);
    }

    if (takeLowerNext) {
      lowerIndex += packetSize;
    } else {
      upperIndex += packetSize;
    }

    takeLowerNext = !takeLowerNext;
  }

  return merged;
}

// ─── Side-exposed deck ───────────────────────────────────────────────────────

interface SideDeckProps {
  cardCount: number;
  theme: TarotTheme;
  onSidePress?: (locationY: number, sideHeight: number) => void;
  onDeckPress?: () => void;
  cardWidth: number;
  cardHeight: number;
  cardThickness: number;
  isRandomAnimating?: boolean;
  randomProgress?: SharedValue<number>;
}

interface RandomShuffleCardProps {
  index: number;
  cardWidth: number;
  cardHeight: number;
  theme: TarotTheme;
  progress: SharedValue<number>;
}

const RandomShuffleCard = React.memo(function RandomShuffleCard({
  index,
  cardWidth,
  cardHeight,
  theme,
  progress,
}: RandomShuffleCardProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const chunkSize = Math.ceil(RANDOM_SHUFFLE_LAYER_COUNT / 4);
    const chunkIndex = Math.floor(index / chunkSize);
    const cardIndexInChunk = index % chunkSize;
    const chunkCenter = chunkIndex - 1.5;
    const direction = chunkCenter === 0 ? 1 : Math.sign(chunkCenter);
    const intraOffset = cardIndexInChunk - (chunkSize - 1) / 2;
    const delay = chunkIndex * 0.035 + cardIndexInChunk * 0.008;
    const local = Math.max(0, Math.min(1, (progress.value - delay) / Math.max(0.001, 1 - delay)));
    const burst = Math.sin(local * Math.PI);
    const settle = local > 0.62 ? (local - 0.62) / 0.38 : 0;
    const verticalDirection = chunkIndex % 2 === 0 ? -1 : 1;
    const depthWeight = 1 - index / RANDOM_SHUFFLE_LAYER_COUNT;
    const chunkStrength = 0.9 + Math.abs(chunkCenter) * 0.28;
    const spreadX = chunkCenter * 14 * chunkStrength + intraOffset * 2;
    const spreadY = verticalDirection * (18 + Math.abs(chunkCenter) * 9) * (0.72 + depthWeight * 0.28) + intraOffset * 2.4;
    const rotate = direction * (7 + Math.abs(chunkCenter) * 3.5) + intraOffset * 1.4;
    const lift = burst * (1 - settle * 0.22);

    return {
      opacity: burst * 0.9,
      transform: [
        { translateX: spreadX * lift },
        { translateY: spreadY * lift },
        { rotateZ: `${rotate * lift}deg` },
      ],
    };
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.randomShuffleCard,
        {
          width: cardWidth,
          height: cardHeight,
          zIndex: 80 + index,
        },
        animatedStyle,
      ]}
    >
      <CardBack width={cardWidth} height={cardHeight} theme={theme} isTopCard={index % 5 === 0} />
    </Animated.View>
  );
});

const SideDeck = React.memo(function SideDeck({
  cardCount,
  theme,
  onSidePress,
  onDeckPress,
  cardWidth,
  cardHeight,
  cardThickness,
  isRandomAnimating,
  randomProgress,
}: SideDeckProps) {
  const sideHeight = Math.max(cardThickness, cardCount * cardThickness);
  const deckHeight = cardHeight + sideHeight + 20;
  const visibleLayerStep = cardCount > 52 ? 2 : 1;

  return (
    <Pressable onPress={onDeckPress} disabled={!onDeckPress}>
      <View style={[styles.sideDeck, { width: cardWidth, height: deckHeight }]}>

        {/* Card face layers tilted away so the side edge reads as the front selection surface. */}
        <View
          pointerEvents="none"
          style={[
            styles.deckPerspectivePlane,
            {
              width: cardWidth,
              height: cardHeight + sideHeight,
              transform: [
                { rotateX: cardWidth < 160 ? DECK_TOP_TILT_COMPACT : DECK_TOP_TILT },
                { scaleY: DECK_TOP_HEIGHT_SCALE },
              ],
            },
          ]}
        >
          {Array.from({ length: cardCount }, (_, i) => {
            const isTopCard = i === cardCount - 1;
            const isBottomCard = i === 0;
            const isVisible =
              isTopCard || isBottomCard ||
              i < 5 || i > cardCount - 6 ||
              i % visibleLayerStep === 0;
            const yOffset = sideHeight - i * cardThickness;
            const opacity = isVisible ? (isTopCard || isBottomCard ? 1 : 0.95) : 0.3;
            const sideProgress = 1 - i / Math.max(1, cardCount - 1);
            const visualWidth = cardWidth * (1 - (1 - DECK_SIDE_WIDTH_COMPENSATION) * sideProgress);

            return (
              <View
                key={i}
                style={[
                  styles.deckCardLayer,
                  {
                    width: visualWidth,
                    height: cardHeight,
                    left: (cardWidth - visualWidth) / 2,
                    opacity,
                    zIndex: i,
                    transform: [{ translateY: yOffset }],
                  },
                ]}
              >
                <CardBack
                  width={visualWidth}
                  height={cardHeight}
                  theme={theme}
                  isTopCard={isTopCard}
                  isBottomCard={isBottomCard}
                />
                {!isTopCard && (
                  <View
                    pointerEvents="none"
                    style={[styles.cardLayerEdge, { borderBottomColor: theme.cardBorder }]}
                  />
                )}
              </View>
            );
          })}
        </View>

        {isRandomAnimating && randomProgress && (
          <View
            pointerEvents="none"
            style={[
              styles.randomShuffleOverlay,
              { width: cardWidth, height: deckHeight + 52, top: Math.round(cardHeight * 0.18) },
            ]}
          >
            {Array.from({ length: RANDOM_SHUFFLE_LAYER_COUNT }, (_, index) => (
              <RandomShuffleCard
                key={index}
                index={index}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                theme={theme}
                progress={randomProgress}
              />
            ))}
          </View>
        )}

        {onSidePress && (
          <Pressable
            style={[styles.sidePressTarget, { height: sideHeight + 40, top: cardHeight * 0.70 - 8 }]}
            hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            onPress={(e) => {
              const y = (e.nativeEvent as any).locationY ?? sideHeight / 2;
              onSidePress(y, sideHeight);
            }}
          />
        )}
      </View>
    </Pressable>
  );
});

// ─── TarotPickerScreen ────────────────────────────────────────────────────────

export default function TarotPickerScreen({ flowState, themePreference, onConfirm, onBack }: Props) {
  const colorScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const resolvedTheme = themePreference ?? colorScheme ?? 'dark';
  const T = resolvedTheme === 'light' ? lightTheme : darkTheme;
  const isCompactLandscape = width > height && height <= 520;
  const cardWidth = isCompactLandscape ? 126 : CARD_W;
  const cardHeight = Math.round(cardWidth * (CARD_H / CARD_W));
  const cardThickness = isCompactLandscape ? 1.55 : CARD_THICKNESS;
  const stackDepth = TOTAL_CARDS * cardThickness;
  const splitGap = isCompactLandscape ? 42 : SPLIT_GAP;
  const shuffleTravel = isCompactLandscape ? 104 : SPLIT_TRAVEL;
  const deckStageHeight = cardHeight + stackDepth + splitGap * 2 + (isCompactLandscape ? 18 : 34);

  const [deckOrder, setDeckOrder] = useState<number[]>(
    flowState.deckOrder ?? makeDefaultDeckOrder(),
  );
  const [visualDeckOrder, setVisualDeckOrder] = useState<number[]>(deckOrder);
  const [splitIndex, setSplitIndex] = useState(39);
  const [isSplit, setIsSplit] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  const [hasShuffled, setHasShuffled] = useState(false);
  const [isMergedStack, setIsMergedStack] = useState(false);
  const [isRandomAnimating, setIsRandomAnimating] = useState(false);
  const [hasCrossedPiles, setHasCrossedPiles] = useState(false);

  const shuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffleCrossTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const randomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Y-axis rotation (horizontal drag)
  const rotY = useSharedValue(0);
  // Split deck vertical animation
  const upperY = useSharedValue(0);
  const lowerY = useSharedValue(0);
  // Deck container global motion during random shuffle
  const deckX = useSharedValue(0);
  const deckY = useSharedValue(0);
  const deckRotZ = useSharedValue(0);
  const randomProgress = useSharedValue(0);
  useEffect(() => {
    return () => {
      if (shuffleTimerRef.current) clearTimeout(shuffleTimerRef.current);
      if (shuffleCrossTimerRef.current) clearTimeout(shuffleCrossTimerRef.current);
      if (randomTimerRef.current) clearTimeout(randomTimerRef.current);
    };
  }, []);

  // ── Rotation drag gesture ──
  const lastTranslationX = useSharedValue(0);
  const panGesture = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onStart(() => { lastTranslationX.value = 0; })
    .onUpdate((e) => {
      const delta = e.translationX - lastTranslationX.value;
      lastTranslationX.value = e.translationX;
      const next = rotY.value + delta * 0.8;
      rotY.value = Math.max(-ROTATION_MAX, Math.min(ROTATION_MAX, next));
    })
    .onEnd(() => {
      rotY.value = withSpring(0, { stiffness: 200, damping: 20 });
    });

  // ── Handle tap on unified deck to split ──
  const handleDeckTap = useCallback(
    (tapY: number, sideHeight: number) => {
      if (isSplit || isShuffling || isRandomAnimating) return;
      const relativeY = Math.max(0, Math.min(1, tapY / sideHeight));
      const rawSplit = Math.round(relativeY * (TOTAL_CARDS - 2)) + 1;
      const clampedSplit = Math.max(5, Math.min(TOTAL_CARDS - 5, rawSplit));
      setSplitIndex(clampedSplit);
      setVisualDeckOrder(deckOrder);
      setIsMergedStack(false);
      setHasShuffled(false);
      setIsSplit(true);
    },
    [isSplit, isShuffling, isRandomAnimating, deckOrder],
  );

  const handleDeckCenterTap = useCallback(() => {
    handleDeckTap(stackDepth / 2, stackDepth);
  }, [handleDeckTap, stackDepth]);

  // ── Swap split halves (tap either half of split deck) ──
  const startShuffle = useCallback(() => {
    if (isShuffling) return;
    if (shuffleTimerRef.current) clearTimeout(shuffleTimerRef.current);
    if (shuffleCrossTimerRef.current) clearTimeout(shuffleCrossTimerRef.current);

    setIsShuffling(true);
    setHasCrossedPiles(false);
    rotY.value = 0;

    upperY.value = withSequence(
      withTiming(shuffleTravel, { duration: SHUFFLE_MS * 0.35, easing: Easing.out(Easing.cubic) }),
      withTiming(shuffleTravel, { duration: SHUFFLE_MS * 0.24, easing: Easing.linear }),
      withTiming(splitGap * 0.28, { duration: SHUFFLE_MS * 0.41, easing: Easing.inOut(Easing.cubic) }),
    );
    lowerY.value = withSequence(
      withTiming(-shuffleTravel, { duration: SHUFFLE_MS * 0.35, easing: Easing.out(Easing.cubic) }),
      withTiming(-shuffleTravel, { duration: SHUFFLE_MS * 0.24, easing: Easing.linear }),
      withTiming(-splitGap * 0.28, { duration: SHUFFLE_MS * 0.41, easing: Easing.inOut(Easing.cubic) }),
    );

    shuffleCrossTimerRef.current = setTimeout(() => {
      setHasCrossedPiles(true);
    }, SHUFFLE_MS * 0.52);

    shuffleTimerRef.current = setTimeout(() => {
      const next = getSinglePassInterleavedOrder(visualDeckOrder, splitIndex);
      setDeckOrder(next);
      setVisualDeckOrder(next);
      upperY.value = 0;
      lowerY.value = 0;
      setIsShuffling(false);
      setHasCrossedPiles(false);
      setIsSplit(false);
      setIsMergedStack(true);
      setHasShuffled(true);
    }, SHUFFLE_MS);
  }, [isShuffling, shuffleTravel, splitGap, splitIndex, visualDeckOrder, upperY, lowerY, rotY]);

  // ── Random shuffle ──
  const handleRandomShuffle = useCallback(() => {
    if (isShuffling) return;
    if (shuffleTimerRef.current) clearTimeout(shuffleTimerRef.current);
    if (randomTimerRef.current) clearTimeout(randomTimerRef.current);

    const next = shuffleDeck(deckOrder);
    setDeckOrder(next);
    setVisualDeckOrder(next);
    setHasShuffled(true);
    setIsMergedStack(false);
    setIsSplit(false);
    rotY.value = 0;
    randomProgress.value = 0;
    setIsRandomAnimating(true);
    randomProgress.value = withTiming(1, {
      duration: RANDOM_SHUFFLE_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });

    // Deck container subtle shake (mirrors web container animation)
    deckRotZ.value = withSequence(
      withTiming(-1.6, { duration: 150 }),
      withTiming(1.2, { duration: 150 }),
      withTiming(-0.7, { duration: 150 }),
      withTiming(0.2, { duration: 150 }),
      withTiming(0, { duration: 100 }),
    );
    deckX.value = withSequence(
      withTiming(-6, { duration: 200 }),
      withTiming(5, { duration: 200 }),
      withTiming(-2, { duration: 200 }),
      withTiming(0, { duration: 300 }),
    );
    deckY.value = withSequence(
      withTiming(-5, { duration: 200 }),
      withTiming(2, { duration: 200 }),
      withTiming(-1, { duration: 200 }),
      withTiming(0, { duration: 300 }),
    );

    randomTimerRef.current = setTimeout(() => {
      setIsRandomAnimating(false);
    }, RANDOM_SHUFFLE_MS);
  }, [isShuffling, deckOrder, deckX, deckY, deckRotZ, randomProgress, rotY]);

  // ── Confirm ──
  const handleConfirm = useCallback(() => {
    onConfirm(deckOrder, flowState.tarotDeckVersionId ?? DEFAULT_TAROT_DECK_ID);
  }, [deckOrder, flowState.tarotDeckVersionId, onConfirm]);

  // ── Animated styles ──
  const outerContainerStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${rotY.value}deg` }],
  }));
  const deckContainerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: deckX.value },
      { translateY: deckY.value },
      { rotateZ: `${deckRotZ.value}deg` },
    ],
  }));
  const upperDeckStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -splitGap + upperY.value },
      { translateX: isShuffling ? -12 : 0 },
      { rotateZ: isSplit ? '-0.8deg' : '0deg' },
    ],
  }));
  const lowerDeckStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: splitGap + lowerY.value },
      { translateX: isShuffling ? 12 : 0 },
      { rotateZ: isSplit ? '0.8deg' : '0deg' },
    ],
  }));

  const upperCards = visualDeckOrder.slice(0, splitIndex);
  const lowerCards = visualDeckOrder.slice(splitIndex);

  const canProceed = hasShuffled && !isShuffling;

  return (
    <LinearGradient
      colors={[T.ambientStart, T.ambientMid, T.ambientEnd]}
      start={{ x: 0.37, y: 0 }}
      end={{ x: 0.63, y: 1 }}
      style={styles.fill}
    >
      <SafeAreaView style={styles.fill}>
        {/* Stars background */}
        {STATIC_STARS.slice(0, 24).map((s) => (
          <View
            key={s.id}
            style={[
              styles.star,
              {
                left: `${s.left * 100}%` as any,
                top: `${s.top * 100}%` as any,
                opacity: s.opacity,
                backgroundColor: T.textMain,
              },
            ]}
          />
        ))}

        {/* Header */}
        <View style={[styles.header, isCompactLandscape && styles.headerCompact]}>
          <View style={styles.headerLeft}>
            <Pressable
              onPress={onBack}
              hitSlop={12}
              style={[styles.iconButton, { borderColor: T.surfaceBorder, backgroundColor: T.surfaceBg }]}
            >
              <Text style={[styles.iconButtonText, { color: T.textMuted }]}>←</Text>
            </Pressable>
            <View style={styles.headerTitles}>
              <Text style={[styles.title, { color: T.textMain }]}>카드 섞기</Text>
              {!isCompactLandscape && (
                <Text style={[styles.subtitle, { color: T.textMuted }]}>
                  측면을 눌러 덱을 가르고, 좌우로 천천히 돌려 오늘의 리듬을 정하세요.
                </Text>
              )}
            </View>
          </View>

          {/* Random shuffle button */}
          <Pressable
            onPress={handleRandomShuffle}
            disabled={isShuffling}
            style={[
              styles.iconButton,
              { borderColor: T.surfaceBorder, backgroundColor: T.surfaceBg },
              isShuffling && styles.disabled,
            ]}
          >
            <Text style={[styles.iconButtonText, { color: T.textMuted }]}>⇄</Text>
          </Pressable>
        </View>

        {/* 3D Deck area */}
        <View style={[styles.deckArea, isCompactLandscape && styles.deckAreaCompact]}>
          <GestureDetector gesture={panGesture}>
            <View style={styles.perspectiveWrapper}>
              <Animated.View style={outerContainerStyle}>
                <Animated.View style={[styles.tiltedWrapper, deckContainerStyle]}>
                  {!isSplit ? (
                    /* ── Unified deck ── */
                    <SideDeck
                      cardCount={TOTAL_CARDS}
                      theme={T}
                      onDeckPress={handleDeckCenterTap}
                      onSidePress={handleDeckTap}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      cardThickness={cardThickness}
                      isRandomAnimating={isRandomAnimating}
                      randomProgress={randomProgress}
                    />
                  ) : (
                    /* ── Split deck ── */
                    <View
                      style={[
                        styles.deckInner,
                        {
                          width: cardWidth,
                          height: deckStageHeight,
                          transform: [{ translateY: isCompactLandscape ? 12 : 34 }],
                        },
                      ]}
                    >
                      {/* Upper half */}
                      <Animated.View
                        style={[
                          styles.splitPile,
                          hasCrossedPiles ? styles.lowerPile : styles.upperPile,
                          upperDeckStyle,
                        ]}
                        pointerEvents={isMergedStack ? 'none' : 'auto'}
                      >
                        <SideDeck
                          cardCount={upperCards.length}
                          theme={T}
                          onDeckPress={startShuffle}
                          cardWidth={cardWidth}
                          cardHeight={cardHeight}
                          cardThickness={cardThickness}
                        />
                      </Animated.View>

                      {/* Lower half */}
                      <Animated.View
                        style={[
                          styles.splitPile,
                          hasCrossedPiles ? styles.upperPile : styles.lowerPile,
                          lowerDeckStyle,
                        ]}
                        pointerEvents={isMergedStack ? 'none' : 'auto'}
                      >
                        <SideDeck
                          cardCount={lowerCards.length}
                          theme={T}
                          onDeckPress={startShuffle}
                          cardWidth={cardWidth}
                          cardHeight={cardHeight}
                          cardThickness={cardThickness}
                        />
                      </Animated.View>
                    </View>
                  )}
                </Animated.View>
              </Animated.View>
            </View>
          </GestureDetector>

          {/* Hint text */}
          <Text style={[styles.hint, isCompactLandscape && styles.hintCompact, { color: T.textMuted }]}>
            {isSplit
              ? '한 번 더 탭하면 위아래 더미가 바뀌어요'
              : hasShuffled
              ? '측면을 눌러 다시 가르거나, 카드를 펼쳐보세요'
              : '측면을 탭해서 덱을 가르세요'}
          </Text>
        </View>

        {/* Confirm button */}
        <View style={[styles.footer, isCompactLandscape && styles.footerCompact, { minHeight: isCompactLandscape ? 48 : 68 }]}>
          {canProceed && (
            <Pressable onPress={handleConfirm} style={styles.ctaButton}>
              <LinearGradient
                colors={[T.ctaStart, T.ctaMid, T.ctaEnd]}
                start={{ x: 0.13, y: 0 }}
                end={{ x: 0.87, y: 1 }}
                style={[styles.ctaGradient, isCompactLandscape && styles.ctaGradientCompact, { borderColor: T.ctaBorder }]}
              >
                <Text style={[styles.ctaText, { color: T.textMain }]}>✦ 카드 펼치기</Text>
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
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  headerCompact: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 4,
    alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  headerTitles: { flex: 1 },
  title: { fontSize: 20, fontWeight: '500', marginBottom: 2 },
  subtitle: { fontSize: 12, lineHeight: 17 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconButtonText: { fontSize: 18 },
  disabled: { opacity: 0.4 },
  deckArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  deckAreaCompact: {
    gap: 6,
    justifyContent: 'center',
  },
  perspectiveWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiltedWrapper: {
    // receives deck shake animation
  },
  deckInner: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  sideDeck: {
    overflow: 'visible',
  },
  deckPerspectivePlane: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'visible',
    zIndex: 2,
  },
  deckCardLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  cardLayerEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    borderBottomWidth: 1,
    opacity: 0.72,
  },
  randomShuffleOverlay: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  sidePressTarget: {
    position: 'absolute',
    left: -28,
    right: -28,
    zIndex: 20,
  },
  randomShuffleCard: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
  },
  splitPile: {
    position: 'absolute',
    top: 0,
    elevation: 0,
  },
  upperPile: {
    zIndex: 2,
  },
  lowerPile: {
    zIndex: 1,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 18,
    marginTop: 12,
  },
  hintCompact: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerCompact: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  ctaButton: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  ctaGradient: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  ctaGradientCompact: {
    paddingVertical: 12,
  },
  ctaText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },
});
