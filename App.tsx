import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  ActivityIndicator,
  BackHandler,
  Button,
  Linking,
  PanResponder,
  Platform,
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { WEBVIEW_ORIGIN, WEBVIEW_URL } from './config';
import TarotPickerScreen from './src/tarot/TarotPickerScreen';
import TarotSpreadScreen from './src/tarot/TarotSpreadScreen';
import type { TarotNativeState } from './src/tarot/types';

const APP_USER_AGENT_SUFFIX = 'MY_APP';
const ANDROID_PULL_DISTANCE = 90;
const LOADING_TIMEOUT_MS = 12000;
const WEB_TOP_OFFSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
const APP_DEEP_LINK_SCHEME = 'voda';
const UNIVERSAL_LINK_HOST = 'voda.ppiyakworld.com';
const AUTH_VERIFIED_PATH = '/auth/verified';

// ─── Injected scripts ─────────────────────────────────────────────────────────

const scrollWatcher = `
  (function () {
    var topOffset = ${WEB_TOP_OFFSET};

    if (topOffset > 0) {
      var style = document.createElement('style');
      style.id = 'native-webview-safe-area';
      style.textContent = [
        'html { background: inherit; }',
        'body { padding-top: ' + topOffset + 'px !important; }'
      ].join('\\n');
      document.head.appendChild(style);
    }

    function postScrollPosition() {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'scroll',
        scrollY: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
      }));
    }

    window.addEventListener('scroll', postScrollPosition, { passive: true });
    postScrollPosition();
  })();
  true;
`;

/**
 * Patches history.pushState to intercept tarot routes before React Router
 * commits the navigation. State is extracted from the React Router v6 format
 * { usr: flowState, key, idx } and posted to native.
 */
const tarotBridge = `
  (function () {
    if (window.__fortuneTarotBridgeInstalled__) return;
    window.__fortuneTarotBridgeInstalled__ = true;

    function getThemePreference() {
      var root = document.documentElement;
      var stored = null;
      try { stored = window.localStorage.getItem('fortune-index-theme'); } catch (e) {}
      if (stored === 'dark' || stored === 'light') return stored;
      if (root.dataset && (root.dataset.theme === 'dark' || root.dataset.theme === 'light')) {
        return root.dataset.theme;
      }
      return root.classList.contains('dark') ? 'dark' : 'light';
    }

    window.__fortunePostNativeTheme__ = function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'THEME_STATE',
        theme: getThemePreference()
      }));
    };

    var origPushState = window.history.pushState.bind(window.history);
    var origReplaceState = window.history.replaceState.bind(window.history);
    window.__fortuneOrigPushState__ = origPushState;
    window.__fortuneOrigReplaceState__ = origReplaceState;

    function interceptTarotRoute(state, url) {
      if (typeof url === 'string') {
        var path = url.split('?')[0];
        if (path === '/tarot-picker' || path === '/tarot-spread') {
          var flowState = (state && state.usr) ? state.usr : (state || {});
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'TAROT_NATIVE_START',
            path: path,
            flowState: flowState,
            theme: getThemePreference()
          }));
          return true;
        }
      }
      return false;
    }

    window.history.pushState = function (state, title, url) {
      if (interceptTarotRoute(state, url)) {
        return;
      }
      return origPushState(state, title, url);
    };

    window.history.replaceState = function (state, title, url) {
      if (interceptTarotRoute(state, url)) {
        return;
      }
      return origReplaceState(state, title, url);
    };

    window.addEventListener('popstate', function (event) {
      var path = window.location.pathname;
      if (path === '/tarot-picker' || path === '/tarot-spread') {
        interceptTarotRoute(event.state, path);
      }
    });

    window.__fortunePostNativeTheme__();

    var observer = new MutationObserver(function () {
      window.__fortunePostNativeTheme__();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style']
    });
  })();
  true;
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeVerificationPath(pathname: string) {
  if (pathname === AUTH_VERIFIED_PATH || pathname === `${AUTH_VERIFIED_PATH}/`) {
    return AUTH_VERIFIED_PATH;
  }
  return null;
}

function getWebViewUrlFromDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);
    const isCustomScheme = parsedUrl.protocol === `${APP_DEEP_LINK_SCHEME}:`;
    const isUniversalLink =
      parsedUrl.protocol === 'https:' && parsedUrl.hostname === UNIVERSAL_LINK_HOST;

    if (!isCustomScheme && !isUniversalLink) {
      return null;
    }

    const customSchemePath = isCustomScheme
      ? `${parsedUrl.hostname ? `/${parsedUrl.hostname}` : ''}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`
      : parsedUrl.pathname;
    const normalizedPath = normalizeVerificationPath(customSchemePath);

    if (!normalizedPath) {
      return null;
    }

    return `${WEBVIEW_ORIGIN}${normalizedPath}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return null;
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

type TarotScreen = 'picker' | 'spread' | null;
type NativeThemePreference = 'dark' | 'light';

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canGoBackRef = useRef(false);
  const isAtTopRef = useRef(true);
  const isLoadingRef = useRef(true);
  const isRefreshingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewUrl, setWebViewUrl] = useState(WEBVIEW_URL);
  const lastHandledDeepLinkRef = useRef<string | null>(null);

  // Tarot native screen state
  const [tarotScreen, setTarotScreen] = useState<TarotScreen>(null);
  const [tarotFlowState, setTarotFlowState] = useState<TarotNativeState>({});
  const [tarotDeckOrder, setTarotDeckOrder] = useState<number[]>([]);
  const [nativeTheme, setNativeTheme] = useState<NativeThemePreference>('dark');

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    setHasError(false);
    setIsRefreshing(true);
    webViewRef.current?.reload();
  }, []);

  const resetWebView = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setIsRefreshing(false);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;

    try {
      const path = new URL(navState.url).pathname;
      if (path === '/tarot-picker') {
        setTarotScreen('picker');
      } else if (path === '/tarot-spread') {
        setTarotScreen(tarotDeckOrder.length > 0 ? 'spread' : 'picker');
      }
    } catch {
      // Ignore malformed navigation URLs from the WebView.
    }
  }, [tarotDeckOrder.length]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          scrollY?: number;
          path?: string;
          flowState?: TarotNativeState;
          theme?: NativeThemePreference;
        };

        if (data.type === 'THEME_STATE') {
          if (data.theme === 'dark' || data.theme === 'light') {
            setNativeTheme(data.theme);
          }
          return;
        }

        if (data.type === 'scroll') {
          isAtTopRef.current = (data.scrollY ?? 0) <= 2;
          return;
        }

        if (data.type === 'TAROT_NATIVE_START') {
          const flow: TarotNativeState = data.flowState ?? {};
          if (data.theme === 'dark' || data.theme === 'light') {
            setNativeTheme(data.theme);
          }
          setTarotFlowState(flow);

          if (data.path === '/tarot-spread' && flow.deckOrder) {
            setTarotDeckOrder(flow.deckOrder);
            setTarotScreen('spread');
          } else {
            setTarotScreen('picker');
          }
        }
      } catch {
        // Ignore non-JSON messages.
      }
    },
    [],
  );

  // Called when user finishes picking cards
  const handleTarotComplete = useCallback(
    (selectedCards: number[], deckOrder: number[], tarotDeckVersionId: string) => {
      const fullState: TarotNativeState = {
        ...tarotFlowState,
        selectedCards,
        deckOrder,
        tarotDeckVersionId,
      };

      const payloadJson = JSON.stringify(fullState);
      const script = `
        (function () {
          var payload = ${payloadJson};
          if (typeof window.__FORTUNE_NATIVE_TAROT_COMPLETE__ === 'function') {
            window.__FORTUNE_NATIVE_TAROT_COMPLETE__(payload);
          } else {
            // Fallback: try to navigate by pushing state and firing popstate
            var key = Math.random().toString(36).slice(2, 7);
            var state = { usr: payload, key: key, idx: window.history.length };
            var push = window.__fortuneOrigPushState__ || window.history.pushState.bind(window.history);
            push(state, '', '/tarot-result');
            window.dispatchEvent(new PopStateEvent('popstate', { state: state }));
          }
        })();
        true;
      `;

      setTarotScreen(null);

      // Give WebView a frame to become visible before injecting
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(script);
      }, 80);
    },
    [tarotFlowState],
  );

  // Picker confirmed → move to spread screen
  const handlePickerConfirm = useCallback(
    (deckOrder: number[], tarotDeckVersionId: string) => {
      setTarotDeckOrder(deckOrder);
      setTarotFlowState((prev) => ({ ...prev, tarotDeckVersionId }));
      setTarotScreen('spread');
    },
    [],
  );

  // Spread back → return to picker
  const handleSpreadBack = useCallback(() => {
    setTarotScreen('picker');
  }, []);

  const handlePickerBack = useCallback(() => {
    setTarotScreen(null);
  }, []);

  const androidPullToRefreshResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Platform.OS === 'android' &&
        isAtTopRef.current &&
        !isLoadingRef.current &&
        !isRefreshingRef.current &&
        gestureState.dy > 16 &&
        Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy >= ANDROID_PULL_DISTANCE) {
          refresh();
        }
      },
    }),
  ).current;

  useEffect(() => {
    isLoadingRef.current = isLoading;
    isRefreshingRef.current = isRefreshing;
  }, [isLoading, isRefreshing]);

  useEffect(
    () => () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tarotScreen === 'spread') {
        handleSpreadBack();
        return true;
      }
      if (tarotScreen === 'picker') {
        handlePickerBack();
        return true;
      }
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [tarotScreen, handleSpreadBack, handlePickerBack]);

  useEffect(() => {
    function openDeepLink(url: string) {
      if (lastHandledDeepLinkRef.current === url) {
        return;
      }

      const nextWebViewUrl = getWebViewUrlFromDeepLink(url);
      if (!nextWebViewUrl) {
        return;
      }

      lastHandledDeepLinkRef.current = url;
      setHasError(false);
      setIsLoading(true);
      setIsRefreshing(false);
      setWebViewUrl(nextWebViewUrl);
      setWebViewKey((key) => key + 1);
    }

    Linking.getInitialURL().then((url) => {
      if (url) openDeepLink(url);
    });

    const subscription = Linking.addEventListener('url', (event) => {
      openDeepLink(event.url);
    });

    return () => subscription.remove();
  }, []);

  const finishLoading = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  const handleLoadStart = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    setIsLoading(true);
    setHasError(false);
    loadingTimeoutRef.current = setTimeout(finishLoading, LOADING_TIMEOUT_MS);
  }, [finishLoading]);

  const handleLoadProgress = useCallback(
    ({ nativeEvent }: { nativeEvent: { progress: number } }) => {
      if (nativeEvent.progress >= 1) {
        finishLoading();
      }
    },
    [finishLoading],
  );

  const handleError = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setHasError(true);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>페이지를 불러올 수 없습니다</Text>
      <Text style={styles.errorDescription}>네트워크 연결을 확인한 뒤 다시 시도해주세요.</Text>
      <Button title="새로고침" onPress={resetWebView} />
    </View>
  );

  const injectedJS = `${scrollWatcher}\n${tarotBridge}`;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <StatusBar translucent={false} backgroundColor="#ffffff" barStyle="dark-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* WebView is always mounted to preserve page state; hidden when native screens are shown */}
        <View
          style={[
            styles.container,
            tarotScreen !== null && styles.hidden,
          ]}
          {...(tarotScreen === null ? androidPullToRefreshResponder.panHandlers : {})}
        >
          {hasError ? (
            renderError()
          ) : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              style={styles.webView}
              applicationNameForUserAgent={APP_USER_AGENT_SUFFIX}
              injectedJavaScript={injectedJS}
              onMessage={handleMessage}
              onLoadStart={handleLoadStart}
              onLoad={finishLoading}
              onLoadEnd={finishLoading}
              onLoadProgress={handleLoadProgress}
              onError={handleError}
              onHttpError={handleError}
              onNavigationStateChange={handleNavigationStateChange}
              pullToRefreshEnabled
              javaScriptEnabled
              domStorageEnabled
            />
          )}

          {(isLoading || isRefreshing) && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
              {isRefreshing && <Text style={styles.refreshingText}>새로고침 중...</Text>}
            </View>
          )}
        </View>

        {/* Native tarot screens */}
        {tarotScreen === 'picker' && (
          <View style={styles.nativeScreen}>
            <TarotPickerScreen
              flowState={tarotFlowState}
              themePreference={nativeTheme}
              onConfirm={handlePickerConfirm}
              onBack={handlePickerBack}
            />
          </View>
        )}

        {tarotScreen === 'spread' && (
          <View style={styles.nativeScreen}>
            <TarotSpreadScreen
              flowState={tarotFlowState}
              deckOrder={tarotDeckOrder}
              themePreference={nativeTheme}
              onConfirm={handleTarotComplete}
              onBack={handleSpreadBack}
            />
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  nativeScreen: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  refreshingText: {
    marginTop: 12,
    color: '#333333',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  errorTitle: {
    marginBottom: 8,
    color: '#111111',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorDescription: {
    marginBottom: 20,
    color: '#555555',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
