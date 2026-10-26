import { File, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import { WEBVIEW_ORIGIN } from '../../config';
import { getNativeContext, nativeContextHeaders } from './nativeContext';

// Reports native-shell errors to `POST /api/client-logs/app-error` (same origin
// as the web app). Errors from inside the WebView page are the web app's job —
// it already sends them with the native headers via `window.__VODA_NATIVE__`.
//
// Server contract (see the backend clientlog module):
// - always 204 except 429 (60 req/min per IP); message 1000, stack 8000 chars,
//   details dropped server-side above 4000 serialized chars.
// - reports are queued on disk first, so a fatal error (process about to die)
// or an offline error is sent on a later launch / once back online, with
// `recordedAt` still the time it actually happened.
// - a failed report is never itself reported (no loop): send failures just stay
//   in the queue.

export type AppErrorType =
  | 'JS_ERROR'
  | 'UNHANDLED_REJECTION'
  | 'RENDER_ERROR'
  | 'NETWORK_ERROR'
  | 'NATIVE_CRASH';

type AppErrorReport = {
  errorType: AppErrorType;
  errorName: string;
  message: string;
  stackTrace: string;
  fatal: boolean;
  appRoute: string | null;
  deviceModel: string;
  osVersion: string;
  details?: Record<string, unknown>;
  recordedAt: string;
};

const APP_ERROR_ENDPOINT = `${WEBVIEW_ORIGIN}/api/client-logs/app-error`;
const MAX_QUEUE_SIZE = 20;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 8000;
const MAX_DETAILS_LENGTH = 4000;
// Sent one at a time with a gap, well under the 60/min rate limit.
const SEND_INTERVAL_MS = 1000;
const SEND_TIMEOUT_MS = 10000;
// Same fingerprint within this window is dropped client-side.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

const queueFile = new File(Paths.document, 'app-error-queue.json');

let queue: AppErrorReport[] | null = null;
let isFlushing = false;
let currentRoute: string | null = null;
const lastReportedAt = new Map<string, number>();

// ─── Sanitizing ───────────────────────────────────────────────────────────────

// Query strings and fragments carry tokens (e.g. voda://auth/verified?token=…),
// so URLs are cut down to scheme + host + path; emails are masked.
function sanitize(text: string) {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#'"]*)[?#][^\s'"]*/gi, '$1')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Pathname only — never the query string.
export function getRouteFromUrl(url: string) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return null;
  }
}

// Same grouping rule as the server's fingerprint: digits → '#', first stack line.
function getFingerprint(report: AppErrorReport) {
  const firstStackLine = report.stackTrace.split('\n')[0] ?? '';
  return [report.errorType, report.errorName, report.message, firstStackLine]
    .join('|')
    .replace(/\d+/g, '#');
}

// ─── Device info ──────────────────────────────────────────────────────────────

function getDeviceModel() {
  if (Platform.OS === 'android') {
    return Platform.constants.Model || 'unknown';
  }
  if (Platform.OS === 'ios') {
    // RN core has no iOS machine id (e.g. iPhone15,2); add expo-device before an
    // iOS release if the exact model is needed.
    return `ios-${Platform.constants.interfaceIdiom ?? 'unknown'}`;
  }
  return 'unknown';
}

function getOsVersion() {
  if (Platform.OS === 'android') {
    return Platform.constants.Release || String(Platform.Version);
  }
  return String(Platform.Version);
}

// ─── Queue ────────────────────────────────────────────────────────────────────

function loadQueue(): AppErrorReport[] {
  if (queue) {
    return queue;
  }
  try {
    const parsed = queueFile.exists ? JSON.parse(queueFile.textSync()) : [];
    queue = Array.isArray(parsed) ? parsed : [];
  } catch {
    queue = [];
  }
  return queue;
}

// Synchronous on purpose: on a fatal error this has to land on disk before the
// default handler takes the process down.
function saveQueue() {
  try {
    queueFile.write(JSON.stringify(queue ?? []));
  } catch {
    // Disk write failed — the in-memory queue is still flushed this session.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendReport(report: AppErrorReport) {
  const nativeContext = await getNativeContext();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(APP_ERROR_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...nativeContextHeaders(nativeContext),
      },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

// Sends queued reports oldest-first, one at a time. Stops (keeping the rest) on a
// network failure, 429 or 5xx, to be retried on the next trigger: app start,
// return to foreground, a new report, or a successful WebView load.
export async function flushAppErrors() {
  if (isFlushing) {
    return;
  }
  isFlushing = true;
  try {
    const pending = loadQueue();
    while (pending.length > 0) {
      let status: number;
      try {
        status = await sendReport(pending[0]);
      } catch {
        return;
      }
      if (status === 429 || status >= 500) {
        return;
      }
      // 2xx, or a 4xx that will never succeed on retry — either way, drop it.
      pending.shift();
      saveQueue();
      if (pending.length > 0) {
        await sleep(SEND_INTERVAL_MS);
      }
    }
  } finally {
    isFlushing = false;
  }
}

// ─── Reporting ────────────────────────────────────────────────────────────────

type ReportInput = {
  errorType: AppErrorType;
  error: unknown;
  fatal?: boolean;
  route?: string | null;
  details?: Record<string, unknown>;
};

function describeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message, stack: error.stack ?? '' };
  }
  return { name: typeof error, message: String(error), stack: '' };
}

function sanitizeDetails(details: Record<string, unknown> | undefined) {
  if (!details) {
    return undefined;
  }
  try {
    const serialized = sanitize(JSON.stringify(details));
    return serialized.length > MAX_DETAILS_LENGTH ? undefined : JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

// Never throws — error reporting must not break the app or itself.
export function reportAppError({ errorType, error, fatal = false, route, details }: ReportInput) {
  try {
    const { name, message, stack } = describeError(error);
    const report: AppErrorReport = {
      errorType,
      errorName: truncate(sanitize(name), 200),
      message: truncate(sanitize(message), MAX_MESSAGE_LENGTH),
      stackTrace: truncate(sanitize(stack), MAX_STACK_LENGTH),
      fatal,
      appRoute: route !== undefined ? route : currentRoute,
      deviceModel: getDeviceModel(),
      osVersion: getOsVersion(),
      details: sanitizeDetails(details),
      recordedAt: new Date().toISOString(),
    };

    const fingerprint = getFingerprint(report);
    const now = Date.now();
    const previous = lastReportedAt.get(fingerprint);
    if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
      return;
    }
    lastReportedAt.set(fingerprint, now);

    const pending = loadQueue();
    if (pending.some((queued) => getFingerprint(queued) === fingerprint)) {
      return;
    }
    pending.push(report);
    // Keep the most recent ones.
    pending.splice(0, Math.max(0, pending.length - MAX_QUEUE_SIZE));
    saveQueue();

    if (!fatal) {
      flushAppErrors();
    }
  } catch {
    // Swallow — see above.
  }
}

// The WebView's current page path, attached to every report as `appRoute`.
export function setAppErrorRoute(url: string) {
  currentRoute = getRouteFromUrl(url);
}

// ─── Install ──────────────────────────────────────────────────────────────────

type HermesRuntime = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
  }) => void;
};

let isInstalled = false;

// Call once from index.js, before the root component registers.
export function installAppErrorReporter() {
  if (isInstalled) {
    return;
  }
  isInstalled = true;

  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportAppError({ errorType: 'JS_ERROR', error, fatal: Boolean(isFatal) });
    defaultHandler(error, isFatal);
  });

  // RN only turns Hermes' rejection tracker on in dev (for its LogBox warning);
  // in release nothing watches unhandled rejections, so take it over there.
  if (!__DEV__) {
    const hermes = (globalThis as { HermesInternal?: HermesRuntime }).HermesInternal;
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        reportAppError({ errorType: 'UNHANDLED_REJECTION', error: rejection });
      },
    });
  }

  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      flushAppErrors();
    }
  });

  // Whatever an earlier session left behind (fatal errors, offline reports).
  flushAppErrors();
}
