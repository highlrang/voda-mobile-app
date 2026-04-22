import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { WEBVIEW_ORIGIN, WEBVIEW_URL } from './config';

const APP_USER_AGENT_SUFFIX = 'MY_APP';
const ANDROID_PULL_DISTANCE = 90;
const LOADING_TIMEOUT_MS = 12000;
const WEB_TOP_OFFSET = Platform.OS === 'android' ? 56 : 0;
const APP_DEEP_LINK_SCHEME = 'voda';

function getWebViewUrlFromDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== `${APP_DEEP_LINK_SCHEME}:`) {
      return null;
    }

    const hostPath = parsedUrl.hostname ? `/${parsedUrl.hostname}` : '';
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname;

    return `${WEBVIEW_ORIGIN}${hostPath}${path}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return null;
  }
}

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
  }, []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; scrollY?: number };

      if (data.type === 'scroll') {
        isAtTopRef.current = (data.scrollY ?? 0) <= 2;
      }
    } catch {
      // Ignore non-JSON messages sent by the page.
    }
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
      const nextWebViewUrl = getWebViewUrlFromDeepLink(url);

      if (!nextWebViewUrl) {
        return;
      }

      setHasError(false);
      setIsLoading(true);
      setIsRefreshing(false);
      setWebViewUrl(nextWebViewUrl);
      setWebViewKey((key) => key + 1);
    }

    Linking.getInitialURL().then((url) => {
      if (url) {
        openDeepLink(url);
      }
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
    <>
      <StatusBar translucent={false} backgroundColor="#ffffff" barStyle="dark-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container} {...androidPullToRefreshResponder.panHandlers}>
          {hasError ? (
            renderError()
          ) : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              style={styles.webView}
              applicationNameForUserAgent={APP_USER_AGENT_SUFFIX}
              injectedJavaScript={scrollWatcher}
              onMessage={handleMessage}
              onLoadStart={handleLoadStart}
              onLoad={finishLoading}
              onLoadEnd={finishLoading}
              onLoadProgress={handleLoadProgress}
              onError={handleError}
              onHttpError={handleError}
              onNavigationStateChange={handleNavigationStateChange}
              pullToRefreshEnabled
              startInLoadingState
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
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
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
