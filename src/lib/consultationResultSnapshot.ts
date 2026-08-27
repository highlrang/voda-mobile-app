import type { RefObject } from 'react';
import type { View } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import type WebView from 'react-native-webview';

// Web asks the native side to snapshot the WebView itself instead of
// re-rendering the page with html2canvas (which hangs indefinitely inside
// this app's embedded WebView) — see webview-native-screenshot-request.md.
export const CONSULTATION_RESULT_SNAPSHOT_REQUEST_TYPE = 'CONSULTATION_RESULT_SNAPSHOT_REQUEST';
const CONSULTATION_RESULT_SNAPSHOT_ALBUM = 'Voda';

export type ConsultationResultSnapshotRequest = {
  requestId: string;
  filename: string;
  contentHeight: number;
};

export function parseConsultationResultSnapshotRequest(
  raw: string,
): ConsultationResultSnapshotRequest | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const message = data as Record<string, unknown>;
  if (message.type !== CONSULTATION_RESULT_SNAPSHOT_REQUEST_TYPE) {
    return null;
  }

  const { requestId, filename, contentHeight } = message;
  if (
    typeof requestId !== 'string' ||
    typeof filename !== 'string' ||
    typeof contentHeight !== 'number' ||
    !Number.isFinite(contentHeight) ||
    contentHeight <= 0
  ) {
    return null;
  }

  return { requestId, filename, contentHeight };
}

// Strips any directory components and unsafe characters from the web-supplied
// filename before it's used to build a local file path — the value crosses
// the WebView bridge, so it can't be trusted as a bare path segment.
function toSafeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || '';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.toLowerCase().endsWith('.png') ? safe : `${safe || 'voda-consultation-result'}.png`;
}

// The WebView runs its own JS engine/event loop on a different thread (and
// process, on Android) from React Native, so RN's own requestAnimationFrame
// doesn't correlate with when the page has actually reflowed and repainted
// after we resize the WebView and reset its scroll position. A short fixed
// delay is the reliable way to wait across that boundary.
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PRE_SCROLL_RESET_SETTLE_MS = 200;
const POST_SCROLL_RESET_SETTLE_MS = 200;
const OVERLAY_HIDE_SETTLE_MS = 100;

// The save button sits at the bottom of the result screen, so the page is
// always scrolled down when this request fires. `window.scrollTo(0, 0)`
// alone turned out to be a no-op here — the page scrolls via an inner
// container div rather than the window/document, so we don't know (and
// shouldn't need to know) its selector. Instead, brute-force every element
// that currently has a non-zero scrollTop, which resets whichever container
// is actually responsible without any coordination with the web side.
const SCROLL_TO_TOP_SCRIPT = `
  (function () {
    function resetScrollTop(el) {
      if (el && el.scrollTop > 0) {
        el.scrollTop = 0;
      }
    }
    resetScrollTop(document.scrollingElement);
    resetScrollTop(document.documentElement);
    resetScrollTop(document.body);
    var elements = document.querySelectorAll('*');
    for (var i = 0; i < elements.length; i++) {
      resetScrollTop(elements[i]);
    }
    window.scrollTo(0, 0);
  })();
  true;
`;

// After restoring the WebView's native height, the page needs to recompute
// its viewport-driven CSS (the injected safe-area script's
// `--native-webview-height` etc.) to match. Programmatically *shrinking* an
// Android WebView doesn't reliably fire a resize/visualViewport event the
// way growing it does — Chromium can lag in recognizing the smaller size —
// so a single dispatch shortly after restoring the height isn't reliable
// (this was tried and still left the page thinking it was still
// `contentHeight` tall, i.e. nothing left to scroll to). Instead, re-read
// the actual viewport size and re-dispatch repeatedly over ~1.2s so
// whenever Chromium does catch up, the page picks it up.
const FORCE_REFLOW_SCRIPT = `
  (function () {
    function setViewportVars() {
      var viewport = window.visualViewport;
      var height = viewport && viewport.height ? viewport.height : window.innerHeight;
      var width = viewport && viewport.width ? viewport.width : window.innerWidth;
      document.documentElement.style.setProperty('--native-webview-height', height + 'px');
      document.documentElement.style.setProperty('--native-webview-width', width + 'px');
    }
    var attempts = 0;
    var maxAttempts = 8;
    var intervalId = setInterval(function () {
      setViewportVars();
      window.dispatchEvent(new Event('resize'));
      attempts += 1;
      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
      }
    }, 150);
  })();
  true;
`;

async function addAssetToAlbum(asset: MediaLibrary.Asset, albumName: string): Promise<void> {
  const existingAlbum = await MediaLibrary.getAlbumAsync(albumName);
  if (existingAlbum) {
    await MediaLibrary.addAssetsToAlbumAsync([asset], existingAlbum, false);
    return;
  }
  await MediaLibrary.createAlbumAsync(albumName, asset, false);
}

export class ConsultationResultSnapshotPermissionError extends Error {
  constructor() {
    super('Media library permission was not granted.');
    this.name = 'ConsultationResultSnapshotPermissionError';
  }
}

export async function captureAndSaveConsultationResultSnapshot({
  viewRef,
  webViewRef,
  contentHeight,
  filename,
  setCaptureHeight,
  setIsCapturingPixels,
}: {
  // The view react-native-view-shot actually captures. `WebView`'s public ref
  // (react-native-webview forwards it via useImperativeHandle) only exposes
  // methods like injectJavaScript/goBack — it isn't a real native node
  // reference, so captureRef can't target it directly. This should be a ref
  // to an *already permanently real* native View that's always been the
  // WebView's direct parent (e.g. one styled with a backgroundColor) —
  // introducing a brand new wrapper view around the WebView, even one that's
  // only conditionally forced non-collapsable, was found to permanently
  // break `position: fixed` compositing inside the WebView (the bottom nav
  // stopped staying pinned) — apparently for good, once React Native had
  // materialized it as a real native node even once.
  viewRef: RefObject<View | null>;
  webViewRef: RefObject<WebView | null>;
  contentHeight: number;
  filename: string;
  setCaptureHeight: (height: number | null) => void;
  // Since `viewRef` now points at a view that also contains sibling overlays
  // (loading/saving spinners, a dev-only button), this hides them for the
  // instant pixels are actually being read so they don't get baked into the
  // saved image.
  setIsCapturingPixels: (isCapturing: boolean) => void;
}): Promise<void> {
  // Request add-only access: this feature only ever writes new photos, so it
  // never needs (and shouldn't prompt for) full photo library read access.
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new ConsultationResultSnapshotPermissionError();
  }

  setCaptureHeight(contentHeight);
  try {
    // Let the resize actually reach the WebView before resetting scroll —
    // otherwise a resize-driven layout change (e.g. a scroll container's
    // height reacting to the injected viewport CSS vars) could re-apply a
    // scroll offset after our reset runs.
    await wait(PRE_SCROLL_RESET_SETTLE_MS);
    webViewRef.current?.injectJavaScript(SCROLL_TO_TOP_SCRIPT);
    await wait(POST_SCROLL_RESET_SETTLE_MS);

    setIsCapturingPixels(true);
    let base64: string;
    try {
      // Let the overlay-hiding re-render actually commit before reading pixels.
      await wait(OVERLAY_HIDE_SETTLE_MS);
      base64 = await captureRef(viewRef, { format: 'png', quality: 1, result: 'base64' });
    } finally {
      setIsCapturingPixels(false);
    }

    const file = new File(Paths.cache, toSafeFilename(filename));
    if (file.exists) {
      file.delete();
    }
    file.write(base64, { encoding: 'base64' });

    const asset = await MediaLibrary.createAssetAsync(file.uri);
    try {
      await addAssetToAlbum(asset, CONSULTATION_RESULT_SNAPSHOT_ALBUM);
    } catch {
      // Best-effort only — the asset is already saved to the library at this
      // point, so a failure to file it under the "Voda" album isn't fatal.
    }

    if (file.exists) {
      file.delete();
    }
  } finally {
    setCaptureHeight(null);
    // FORCE_REFLOW_SCRIPT retries on its own timer, so it can be fired
    // immediately — no need to guess a single upfront delay here too.
    webViewRef.current?.injectJavaScript(FORCE_REFLOW_SCRIPT);
  }
}
