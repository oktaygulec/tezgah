// Window and lifetime of the bare server (tezgah-mac, or the helper started by hand). The Windows
// release does not use this window: there the Electron program (electron/main.ts) shows the page.
//
// The bare server opens its page in Chrome or Edge in "app" mode (no address bar, no tabs) with its
// own profile folder, and stops when its last page closes. If no such browser is found, the default
// browser opens the page.
//
// Environment variables (for tests): TEZGAH_NO_BROWSER=1 opens no window; TEZGAH_KEEP_RUNNING=1
// keeps the program running when no window is open.

import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { format } from "node:util";
import { inElectron, isCompiled, openBrowser } from "./system";

/** Edge first: it is on every Windows 10/11 computer. Then Chrome. */
function findAppBrowser(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
    for (const exe of ["Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe"]) {
      for (const root of roots) candidates.push(path.join(root, exe));
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The browser profile of the Tezgah window: kept apart from the user's own browser profile. */
function windowProfileDir(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Tezgah", "Pencere");
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Application Support", "Tezgah", "Pencere");
  return path.join(homedir(), ".config", "tezgah", "pencere");
}

/** Opens the Tezgah window. If there is already one, Edge opens a second window of the same program. */
export function openAppWindow(url: string): void {
  if (process.env.TEZGAH_NO_BROWSER === "1") return;
  const browser = findAppBrowser();
  if (!browser) {
    console.log("Edge veya Chrome bulunamadı. Sayfa varsayılan tarayıcıda açılıyor.");
    openBrowser(url);
    return;
  }
  try {
    Bun.spawn(
      [
        browser,
        `--app=${url}`,
        `--user-data-dir=${windowProfileDir()}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
        "--disable-features=Translate",
      ],
      // Detached: the window stays open while Tezgah restarts after an update.
      { stdio: ["ignore", "ignore", "ignore"], detached: true },
    );
  } catch (e) {
    console.error("Tezgah penceresi açılamadı. Varsayılan tarayıcı deneniyor.", e);
    openBrowser(url);
  }
}

export const LIVE_PATH = "/api/live";

/**
 * Counts the open Tezgah windows. Each window keeps a WebSocket to LIVE_PATH open.
 * When the last window closes, the program stops after a short wait (a page reload reconnects
 * in less than a second). If no window connects at all, the program stops after a longer wait.
 */
export function createLifetime(
  stop: () => void,
  {
    firstWindowMs = 120_000,
    lastWindowMs = 10_000,
    // Under Electron the window program decides when the server stops (see main.ts).
    enabled = isCompiled && !inElectron && process.env.TEZGAH_KEEP_RUNNING !== "1",
  }: { firstWindowMs?: number; lastWindowMs?: number; enabled?: boolean } = {},
) {
  let windows = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stopAfter(ms: number) {
    clearTimeout(timer);
    if (!enabled) return;
    timer = setTimeout(() => {
      if (windows > 0) return;
      console.log("Açık Tezgah penceresi yok. Program duruyor.");
      stop();
    }, ms);
  }
  stopAfter(firstWindowMs);

  return {
    get windows() {
      return windows;
    },
    /** Stops at once (used when the Electron window program closes). */
    stopNow() {
      clearTimeout(timer);
      console.log("Tezgah penceresi kapandı. Program duruyor.");
      stop();
    },
    /** Another copy of Tezgah found this one and opens a window now: wait for that window. */
    expectWindow() {
      if (windows === 0) stopAfter(Math.max(lastWindowMs, 30_000));
    },
    websocket: {
      open() {
        windows++;
        clearTimeout(timer);
      },
      close() {
        windows = Math.max(0, windows - 1);
        if (windows === 0) stopAfter(lastWindowMs);
      },
      message() {
        // the page sends nothing; the open connection is the signal
      },
    },
  };
}

const MAX_LOG_BYTES = 1_000_000;

/**
 * Copies console output to a log file. The Windows program has no console window,
 * so this file is the only place to read messages and errors.
 */
export function logToFile(file: string): void {
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.old`);
  } catch {
    // no log file yet
  }
  for (const level of ["log", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        appendFileSync(file, `${new Date().toLocaleString("tr-TR")} ${format(...args)}\n`);
      } catch {
        // a full disk must not stop the program
      }
      original(...args);
    };
  }
}

/** Shows an error in a Windows message box. The program has no console window for it. */
export function showErrorBox(message: string): void {
  if (process.platform !== "win32" || !isCompiled) return;
  const script =
    "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:TEZGAH_MESSAGE, 'Tezgah', 'OK', 'Error') | Out-Null";
  try {
    // Not windowsHide: that flag can also hide the message box itself.
    Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
      env: { ...process.env, TEZGAH_MESSAGE: message },
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // nothing more we can do
  }
}
