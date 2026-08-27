import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Button,
  Linking,
  Platform,
  StyleSheet,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { WEBVIEW_ORIGIN, WEBVIEW_URL } from './config';
import {
  captureAndSaveConsultationResultSnapshot,
  ConsultationResultSnapshotPermissionError,
  parseConsultationResultSnapshotRequest,
} from './src/lib/consultationResultSnapshot';
import { clearInstallDeviceId, getInstallDeviceId } from './src/lib/installDeviceId';

const INSTALL_DEVICE_ID_HEADER = 'X-Install-Device-Id';

const APP_USER_AGENT_SUFFIX = 'MY_APP';
const LOADING_TIMEOUT_MS = 12000;
const WEB_BOTTOM_OFFSET = Platform.OS === 'android' ? 16 : 0;
const APP_DEEP_LINK_SCHEME = 'voda';
const UNIVERSAL_LINK_HOST = 'voda.ppiyakworld.com';
const AUTH_VERIFIED_PATH = '/auth/verified';

// ─── Injected scripts ─────────────────────────────────────────────────────────

// `topOffset` needs the real status-bar-safe-area inset from
// useSafeAreaInsets(), not a hardcoded guess — a fixed 0 (assuming
// StatusBar translucent={false} always keeps native layout clear of the
// status bar) left page headers clipped under the status bar on devices/OS
// versions where Android's edge-to-edge behavior draws the app behind it
// regardless (mandatory on Android 15+ for apps targeting API 35+).
function buildWebViewSafeAreaScript(topOffset: number) {
  return `
  (function () {
    var topOffset = ${topOffset};
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
}

// Exposes the native install-device id as a global before any page script runs, so
// the web app's own request layer can read it and attach it as a header itself —
// the WebView's `source.headers` only covers the initial document request, not
// subsequent fetch/XHR calls the page makes.
function buildInstallDeviceIdScript(installDeviceId: string) {
  return `
    (function () {
      window.__VODA_INSTALL_DEVICE_ID__ = ${JSON.stringify(installDeviceId)};
    })();
    true;
  `;
}

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
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const containerRef = useRef<View>(null);
  const isSavingSnapshotRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canGoBackRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewUrl, setWebViewUrl] = useState(WEBVIEW_URL);
  const lastHandledDeepLinkRef = useRef<string | null>(null);
  // null = not resolved yet, '' = resolution failed (proceed without the header).
  const [installDeviceId, setInstallDeviceId] = useState<string | null>(null);
  // Non-null while capturing a consultation-result snapshot: temporarily grows
  // `container` (and the WebView filling it) past screen bounds so the full
  // (unscrolled) content is captured, per webview-native-screenshot-request.md.
  const [snapshotCaptureHeight, setSnapshotCaptureHeight] = useState<number | null>(null);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  // True only for the instant react-native-view-shot is actually reading
  // pixels — hides the sibling overlays (which live inside `container`, the
  // capture target) so they don't get baked into the saved image.
  const [isCapturingPixels, setIsCapturingPixels] = useState(false);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    getInstallDeviceId()
      .then((id) => {
        if (isMounted) setInstallDeviceId(id);
      })
      .catch(() => {
        if (isMounted) setInstallDeviceId('');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const resetWebView = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setIsRefreshing(false);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleResetInstallDeviceId = useCallback(() => {
    Alert.alert('Device ID 초기화', '이 기기의 install device id를 새로 발급받고 웹뷰를 다시 로드합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: async () => {
          await clearInstallDeviceId();
          const nextId = await getInstallDeviceId();
          setInstallDeviceId(nextId);
          resetWebView();
          Alert.alert('완료', `새 device id: ${nextId}`);
        },
      },
    ]);
  }, [resetWebView]);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    const request = parseConsultationResultSnapshotRequest(event.nativeEvent.data);
    if (!request || isSavingSnapshotRef.current) {
      return;
    }

    isSavingSnapshotRef.current = true;
    setIsSavingSnapshot(true);

    captureAndSaveConsultationResultSnapshot({
      viewRef: containerRef,
      webViewRef,
      contentHeight: request.contentHeight,
      filename: request.filename,
      setCaptureHeight: setSnapshotCaptureHeight,
      setIsCapturingPixels,
    })
      .then(() => {
        Alert.alert('저장 완료', '상담 결과 이미지를 사진첩에 저장했습니다.');
      })
      .catch((error) => {
        const isPermissionDenied = error instanceof ConsultationResultSnapshotPermissionError;
        Alert.alert(
          '저장 실패',
          isPermissionDenied
            ? '사진첩 접근 권한이 필요합니다. 설정에서 권한을 허용해주세요.'
            : '이미지를 저장하는 중 문제가 발생했습니다. 다시 시도해주세요.',
        );
      })
      .finally(() => {
        isSavingSnapshotRef.current = false;
        setIsSavingSnapshot(false);
      });
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
      {/* edges={[]}: no native inset padding here — the top/bottom safe-area insets are
          handled inside the WebView itself via injected CSS (see buildWebViewSafeAreaScript),
          this stays purely a decorative background container like it always was. */}
      <SafeAreaView edges={[]} style={styles.safeArea}>
        {/* WebView stays mounted to preserve page state across reloads and navigation.
            `container` (not a wrapper around just the WebView) is the capture target for
            the snapshot feature below — a *dedicated* wrapper view around the WebView was
            found to permanently break its `position: fixed` compositing (the bottom nav
            stopped staying pinned) the moment it was ever forced into a real native node,
            even after trying to let it collapse away again. Reusing this already-real,
            always-present container avoids introducing any such node in the first place. */}
        <View
          ref={containerRef}
          collapsable={false}
          style={
            snapshotCaptureHeight != null
              ? [styles.container, { height: snapshotCaptureHeight }]
              : styles.container
          }
        >
          {hasError ? (
            renderError()
          ) : installDeviceId === null ? null : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{
                uri: webViewUrl,
                headers: installDeviceId
                  ? { [INSTALL_DEVICE_ID_HEADER]: installDeviceId }
                  : undefined,
              }}
              style={styles.webView}
              applicationNameForUserAgent={APP_USER_AGENT_SUFFIX}
              injectedJavaScriptBeforeContentLoaded={buildInstallDeviceIdScript(installDeviceId)}
              injectedJavaScript={buildWebViewSafeAreaScript(insets.top)}
              onLoadStart={handleLoadStart}
              onLoad={finishLoading}
              onLoadEnd={finishLoading}
              onLoadProgress={handleLoadProgress}
              onError={handleError}
              onHttpError={handleError}
              onNavigationStateChange={handleNavigationStateChange}
              onMessage={handleWebViewMessage}
              pullToRefreshEnabled
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              // Android's hardware layer captures a WebView via PixelCopy off the
              // GPU-composited surface, which can miss/stale content that was
              // off-screen (scrolled away, or beyond the pre-resize viewport) and
              // hasn't been re-rasterized yet. Switch to the software (CPU canvas)
              // path while we resize + capture so the whole expanded page is
              // actually drawn, not just what the GPU tile cache still has.
              androidLayerType={isSavingSnapshot ? 'software' : 'hardware'}
            />
          )}

          {(isLoading || isRefreshing) && !isCapturingPixels && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
              {isRefreshing && <Text style={styles.refreshingText}>새로고침 중...</Text>}
            </View>
          )}

          {isSavingSnapshot && !isCapturingPixels && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
              <Text style={styles.refreshingText}>이미지 저장 중...</Text>
            </View>
          )}

          {__DEV__ && !isCapturingPixels && (
            <TouchableOpacity
              style={styles.debugResetButton}
              onPress={handleResetInstallDeviceId}
              accessibilityLabel="Device ID 초기화 (QA 전용)"
            >
              <Text style={styles.debugResetButtonText}>ID 초기화</Text>
            </TouchableOpacity>
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
  debugResetButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  debugResetButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
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
