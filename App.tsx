import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  ActivityIndicator,
  BackHandler,
  Button,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { WEBVIEW_ORIGIN, WEBVIEW_URL } from './config';

const APP_USER_AGENT_SUFFIX = 'MY_APP';
const LOADING_TIMEOUT_MS = 12000;
const WEB_TOP_OFFSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
const WEB_BOTTOM_OFFSET = Platform.OS === 'android' ? 16 : 0;
const APP_DEEP_LINK_SCHEME = 'voda';
const UNIVERSAL_LINK_HOST = 'voda.ppiyakworld.com';
const AUTH_VERIFIED_PATH = '/auth/verified';

// ─── Injected scripts ─────────────────────────────────────────────────────────

const webViewSafeArea = `
  (function () {
    var topOffset = ${WEB_TOP_OFFSET};
    var bottomOffset = ${WEB_BOTTOM_OFFSET};

    function setViewportVars() {
      var viewport = window.visualViewport;
      var viewportHeight = viewport && viewport.height ? viewport.height : window.innerHeight;
      var viewportWidth = viewport && viewport.width ? viewport.width : window.innerWidth;

      document.documentElement.style.setProperty('--native-webview-height', viewportHeight + 'px');
      document.documentElement.style.setProperty('--native-webview-width', viewportWidth + 'px');
      document.documentElement.style.setProperty('--native-webview-top-offset', topOffset + 'px');
      document.documentElement.style.setProperty('--native-webview-bottom-offset', bottomOffset + 'px');
    }

    function installViewportMeta() {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'viewport');
        document.head.appendChild(meta);
      }

      var content = meta.getAttribute('content') || 'width=device-width, initial-scale=1';
      if (content.indexOf('viewport-fit=cover') === -1) {
        meta.setAttribute('content', content + ', viewport-fit=cover');
      }
    }

    function installStyle() {
      if (document.getElementById('native-webview-safe-area')) {
        return;
      }

      var style = document.createElement('style');
      style.id = 'native-webview-safe-area';
      style.textContent = [
        ':root {',
        '  --native-webview-height: 100vh;',
        '  --native-webview-width: 100vw;',
        '  --native-webview-top-offset: ' + topOffset + 'px;',
        '  --native-webview-bottom-offset: ' + bottomOffset + 'px;',
        '}',
        'html { background: inherit; min-height: var(--native-webview-height); }',
        'body {',
        '  min-height: var(--native-webview-height);',
        '  padding-top: ' + topOffset + 'px !important;',
        '  padding-bottom: max(env(safe-area-inset-bottom), var(--native-webview-bottom-offset)) !important;',
        '  overscroll-behavior-y: none;',
        '}',
        '#root, #__next { min-height: var(--native-webview-height); }',
        '[class*="tarot" i], [id*="tarot" i], [class*="card" i], [class*="deck" i] {',
        '  -webkit-backface-visibility: hidden;',
        '  backface-visibility: hidden;',
        '  -webkit-transform-style: preserve-3d;',
        '  transform-style: preserve-3d;',
        '}',
        '[class*="tarot" i] button, [id*="tarot" i] button, button[class*="card" i], button[class*="spread" i] {',
        '  will-change: transform, opacity;',
        '}',
        '[class*="shuffle" i], [class*="deck" i], [class*="card" i][style*="transform"] {',
        '  contain: layout paint style;',
        '  will-change: transform;',
        '}',
        '[class*="bottom" i], [class*="footer" i], [class*="cta" i] {',
        '  scroll-margin-bottom: max(24px, env(safe-area-inset-bottom), var(--native-webview-bottom-offset));',
        '}',
        '[class*="tarot" i] [class*="footer" i], [id*="tarot" i] [class*="footer" i],',
        '[class*="tarot" i] [class*="bottom" i], [id*="tarot" i] [class*="bottom" i] {',
        '  padding-bottom: max(env(safe-area-inset-bottom), var(--native-webview-bottom-offset)) !important;',
        '}'
      ].join('\\n');
      document.head.appendChild(style);
    }

    installViewportMeta();
    installStyle();
    setViewportVars();

    window.addEventListener('resize', setViewportVars);
    window.addEventListener('orientationchange', function () {
      window.setTimeout(setViewportVars, 60);
      window.setTimeout(setViewportVars, 260);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportVars);
      window.visualViewport.addEventListener('scroll', setViewportVars);
    }
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

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canGoBackRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewUrl, setWebViewUrl] = useState(WEBVIEW_URL);
  const lastHandledDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  const resetWebView = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setIsRefreshing(false);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

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
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, []);

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

  return (
    <GestureHandlerRootView style={styles.fill}>
      <StatusBar translucent={false} backgroundColor="#ffffff" barStyle="dark-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* WebView stays mounted to preserve page state across reloads and navigation. */}
        <View style={styles.container}>
          {hasError ? (
            renderError()
          ) : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              style={styles.webView}
              applicationNameForUserAgent={APP_USER_AGENT_SUFFIX}
              injectedJavaScript={webViewSafeArea}
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
              cacheEnabled
              androidLayerType="hardware"
            />
          )}

          {(isLoading || isRefreshing) && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
              {isRefreshing && <Text style={styles.refreshingText}>새로고침 중...</Text>}
            </View>
          )}
        </View>
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
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
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
