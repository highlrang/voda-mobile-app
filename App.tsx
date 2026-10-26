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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { WEBVIEW_ORIGIN, WEBVIEW_URL } from './config';
import {
  captureAndSaveConsultationResultSnapshot,
  ConsultationResultSnapshotPermissionError,
  parseConsultationResultSnapshotRequest,
} from './src/lib/consultationResultSnapshot';
import { clearGuestId } from './src/lib/guestId';
import {
  getNativeContext,
  resetNativeContextCache,
  type NativeContext,
} from './src/lib/nativeContext';

const DEVICE_PLATFORM_HEADER = 'X-Device-Platform';
const DEVICE_ID_HEADER = 'X-Device-Id';
const GUEST_ID_HEADER = 'X-Guest-Id';

// Guest ID reset button: always in dev, and in release APKs built with
// EXPO_PUBLIC_ENABLE_QA_TOOLS=true (build:apk:dev). Never set for the store AAB.
const ENABLE_QA_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_QA_TOOLS === 'true';

const APP_USER_AGENT_SUFFIX = 'MY_APP';
const LOADING_TIMEOUT_MS = 12000;
// Android floor for the bottom offset. Android WebView mostly reports
// env(safe-area-inset-bottom) as 0, so under edge-to-edge (forced on Android 15+
// for targetSdk 35+) the real nav-bar inset from useSafeAreaInsets() has to be
// pushed in instead — a fixed 16px left the bottom CTA under the 3-button nav bar.
const ANDROID_MIN_BOTTOM_OFFSET = 16;
const APP_DEEP_LINK_SCHEME = 'voda';
// 운영 유니버설/앱링크 호스트 (iOS associatedDomains / Android autoVerify 대상).
// 개발 빌드는 커스텀 스킴(voda://)으로만 딥링크가 들어온다.
const UNIVERSAL_LINK_HOST = 'voda.ppiyakworld.com';
// 앱이 받아서 WebView로 넘겨주는 딥링크 경로. 여기서 시작하는 경로만 허용하고,
// 나머지(쿼리스트링·해시 포함)는 그대로 현재 WEBVIEW_ORIGIN 뒤에 붙여 전달한다.
//   voda://auth/verified?token=...             → ${WEBVIEW_ORIGIN}/auth/verified?token=...
//   voda://auth/password-reset?resetToken=...  → ${WEBVIEW_ORIGIN}/password-reset?resetToken=...
const DEEP_LINK_ALLOWED_PATH_PREFIXES = ['/auth/'];
// 딥링크 경로와 웹 경로가 다른 경우의 매핑. 여기 없는 경로는 그대로 전달한다.
// (웹의 비밀번호 재설정 페이지는 /auth 아래가 아니라 /password-reset 이다.)
const DEEP_LINK_WEB_PATH_MAP: Record<string, string> = {
  '/auth/password-reset': '/password-reset',
};

// ─── Injected scripts ─────────────────────────────────────────────────────────

// `topOffset` needs the real status-bar-safe-area inset from
// useSafeAreaInsets(), not a hardcoded guess — a fixed 0 (assuming
// StatusBar translucent={false} always keeps native layout clear of the
// status bar) left page headers clipped under the status bar on devices/OS
// versions where Android's edge-to-edge behavior draws the app behind it
// regardless (mandatory on Android 15+ for apps targeting API 35+).
function buildWebViewSafeAreaScript(topOffset: number, bottomOffset: number) {
  return `
  (function () {
    // Kept on window (not closed over) so buildSafeAreaUpdateScript() can swap in
    // new insets after rotation without the resize listeners below restoring the
    // values from the initial load.
    window.__VODA_SAFE_AREA__ = { top: ${topOffset}, bottom: ${bottomOffset} };
    var topOffset = window.__VODA_SAFE_AREA__.top;
    var bottomOffset = window.__VODA_SAFE_AREA__.bottom;

    function setViewportVars() {
      var topOffset = window.__VODA_SAFE_AREA__.top;
      var bottomOffset = window.__VODA_SAFE_AREA__.bottom;
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
        '  padding-top: var(--native-webview-top-offset) !important;',
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
    window.__VODA_SET_VIEWPORT_VARS__ = setViewportVars;

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

// `injectedJavaScript` only runs on page load, so inset changes after that
// (rotation, nav-bar mode switch) are pushed into the already-loaded page here.
function buildSafeAreaUpdateScript(topOffset: number, bottomOffset: number) {
  return `
    (function () {
      window.__VODA_SAFE_AREA__ = { top: ${topOffset}, bottom: ${bottomOffset} };
      if (window.__VODA_SET_VIEWPORT_VARS__) {
        window.__VODA_SET_VIEWPORT_VARS__();
      }
    })();
    true;
  `;
}

// Exposes the native device-identity context as a global before any page script
// runs, so the web app's own request layer can read it and attach the identity
// headers itself — the WebView's `source.headers` only covers the initial
// document request, not the subsequent fetch/XHR/streaming calls the page makes
// for the consultation/trial APIs. See NATIVE_DEVICE_IDENTITY.md for the contract.
function buildNativeContextScript(nativeContext: NativeContext) {
  return `
    (function () {
      window.__VODA_NATIVE__ = ${JSON.stringify({
        platform: nativeContext.platform,
        deviceId: nativeContext.deviceId,
        guestId: nativeContext.guestId,
        appVersion: nativeContext.appVersion,
      })};
    })();
    true;
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// react-native-webview doesn't re-export its ShouldStartLoadRequest type from the
// package root; this is the subset we use.
type ShouldStartLoadRequest = WebViewNavigation & { isTopFrame?: boolean };

function getWebBottomOffset(bottomInset: number) {
  return Platform.OS === 'android' ? Math.max(bottomInset, ANDROID_MIN_BOTTOM_OFFSET) : 0;
}

// Schemes the WebView itself can render. Anything else (tel:, mailto:, intent:,
// kakaotalk:, market: …) has to be handed to the OS — left to the WebView it
// fails with ERR_UNKNOWN_URL_SCHEME, which onError turns into the full-screen
// error view.
const WEBVIEW_HANDLED_SCHEMES = ['http:', 'https:', 'about:', 'data:', 'blob:', 'javascript:'];

function getUrlScheme(url: string) {
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

// Android `intent://…#Intent;scheme=…;package=…;S.browser_fallback_url=…;end`
// can't go through Linking.openURL as-is (it isn't parsed with
// Intent.parseUri), so rebuild the target app URL from it, then fall back to
// the browser fallback URL, then to the app's Play Store page.
function getIntentUrlCandidates(url: string) {
  const [body, fragment = ''] = url.split('#Intent;');
  const params = new Map<string, string>();
  fragment
    .replace(/;?end;?$/, '')
    .split(';')
    .forEach((part) => {
      const separator = part.indexOf('=');
      if (separator > 0) {
        params.set(part.slice(0, separator), part.slice(separator + 1));
      }
    });

  const candidates: string[] = [];
  const scheme = params.get('scheme');
  if (scheme) {
    candidates.push(body.replace(/^intent:/i, `${scheme}:`));
  }
  const fallbackUrl = params.get('S.browser_fallback_url');
  if (fallbackUrl) {
    try {
      candidates.push(decodeURIComponent(fallbackUrl));
    } catch {
      // Malformed fallback URL — skip it.
    }
  }
  const packageName = params.get('package');
  if (packageName) {
    candidates.push(`market://details?id=${packageName}`);
  }
  return candidates;
}

async function openExternalUrl(url: string) {
  const candidates = getUrlScheme(url) === 'intent:' ? getIntentUrlCandidates(url) : [url];
  for (const candidate of candidates) {
    try {
      await Linking.openURL(candidate);
      return;
    } catch {
      // Target app not installed / scheme not handled — try the next candidate.
    }
  }
}

function normalizeDeepLinkPath(pathname: string) {
  const collapsed = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const normalized = collapsed === '' ? '/' : collapsed;
  const isAllowed = DEEP_LINK_ALLOWED_PATH_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
  if (!isAllowed) {
    return null;
  }
  return DEEP_LINK_WEB_PATH_MAP[normalized] ?? normalized;
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
    const normalizedPath = normalizeDeepLinkPath(customSchemePath);

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
  const [hasError, setHasError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewUrl, setWebViewUrl] = useState(WEBVIEW_URL);
  const lastHandledDeepLinkRef = useRef<string | null>(null);
  // null = not resolved yet. getNativeContext() always resolves (falls back to a
  // context with guestId: '' on failure) so the WebView is never permanently
  // blocked from loading.
  const [nativeContext, setNativeContext] = useState<NativeContext | null>(null);
  // Non-null while capturing a consultation-result snapshot: temporarily grows
  // `container` (and the WebView filling it) past screen bounds so the full
  // (unscrolled) content is captured, per webview-native-screenshot-request.md.
  const [snapshotCaptureHeight, setSnapshotCaptureHeight] = useState<number | null>(null);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  // True only for the instant react-native-view-shot is actually reading
  // pixels — hides the sibling overlays (which live inside `container`, the
  // capture target) so they don't get baked into the saved image.
  const [isCapturingPixels, setIsCapturingPixels] = useState(false);
  const webBottomOffset = getWebBottomOffset(insets.bottom);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(buildSafeAreaUpdateScript(insets.top, webBottomOffset));
  }, [insets.top, webBottomOffset]);

  useEffect(() => {
    let isMounted = true;
    getNativeContext()
      .then((context) => {
        if (isMounted) setNativeContext(context);
      })
      .catch(() => {
        if (isMounted) {
          setNativeContext({
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            deviceId: null,
            guestId: '',
            appVersion: null,
          });
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const resetWebView = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleResetGuestId = useCallback(() => {
    Alert.alert('Guest ID 초기화', '이 기기의 guest id를 새로 발급받고 웹뷰를 다시 로드합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: async () => {
          await clearGuestId();
          resetNativeContextCache();
          const nextContext = await getNativeContext();
          setNativeContext(nextContext);
          resetWebView();
          Alert.alert('완료', `새 guest id: ${nextContext.guestId || '(발급 실패)'}`);
        },
      },
    ]);
  }, [resetWebView]);

  const handleShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    const scheme = getUrlScheme(request.url);
    if (!scheme || WEBVIEW_HANDLED_SCHEMES.includes(scheme)) {
      return true;
    }
    // Only follow app-scheme navigations from the top frame, so an embedded
    // iframe can't bounce the user out to another app on its own.
    if (request.isTopFrame !== false) {
      openExternalUrl(request.url);
    }
    return false;
  }, []);

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
  }, []);

  // Only fires for the main document (react-native-webview checks isForMainFrame).
  // A 4xx is answered by the web app's own error page, which has its own
  // navigation, so let it render; a 5xx is usually a gateway/server page with no
  // way back, so show the native retry screen.
  const handleHttpError = useCallback(
    ({ nativeEvent }: { nativeEvent: { statusCode: number } }) => {
      if (nativeEvent.statusCode >= 500) {
        handleError();
      }
    },
    [handleError],
  );

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>페이지를 불러올 수 없습니다</Text>
      <Text style={styles.errorDescription}>네트워크 연결을 확인한 뒤 다시 시도해주세요.</Text>
      <Button title="새로고침" onPress={resetWebView} />
    </View>
  );

  return (
    <View style={styles.fill}>
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
          ) : nativeContext === null ? null : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              source={{
                uri: webViewUrl,
                // Secondary channel: covers only the initial document request.
                // The API calls are gated on the injected `window.__VODA_NATIVE__`
                // global instead (see buildNativeContextScript).
                headers: {
                  [DEVICE_PLATFORM_HEADER]: nativeContext.platform,
                  ...(nativeContext.deviceId
                    ? { [DEVICE_ID_HEADER]: nativeContext.deviceId }
                    : {}),
                  ...(nativeContext.guestId
                    ? { [GUEST_ID_HEADER]: nativeContext.guestId }
                    : {}),
                },
              }}
              style={styles.webView}
              applicationNameForUserAgent={APP_USER_AGENT_SUFFIX}
              injectedJavaScriptBeforeContentLoaded={buildNativeContextScript(nativeContext)}
              injectedJavaScript={buildWebViewSafeAreaScript(insets.top, webBottomOffset)}
              onLoadStart={handleLoadStart}
              onLoad={finishLoading}
              onLoadEnd={finishLoading}
              onLoadProgress={handleLoadProgress}
              onError={handleError}
              onHttpError={handleHttpError}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
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

          {isLoading && !isCapturingPixels && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
            </View>
          )}

          {isSavingSnapshot && !isCapturingPixels && (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#1f6feb" />
              <Text style={styles.refreshingText}>이미지 저장 중...</Text>
            </View>
          )}

          {ENABLE_QA_TOOLS && !isCapturingPixels && (
            <TouchableOpacity
              style={styles.debugResetButton}
              onPress={handleResetGuestId}
              accessibilityLabel="Guest ID 초기화 (QA 전용)"
            >
              <Text style={styles.debugResetButtonText}>ID 초기화</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </View>
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
