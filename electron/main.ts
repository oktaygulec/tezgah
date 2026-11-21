// Tezgah window program (Electron). It starts the Tezgah server (the "helper", a Bun program in
// resources/helper) and shows its page in a window. Electron brings its own Chromium, so the
// window does not use Edge or any installed browser.
//
// Flow: start the helper -> wait for "TEZGAH_READY <address>" on its stdout -> load the page.
// When the window closes, close the helper's stdin: the helper then stops cleanly. When the helper
// exits with RESTART_EXIT_CODE, an update replaced Tezgah.exe: start the new file and exit.
//
// Release build: electron-builder "portable" target, one Tezgah.exe. The launcher unpacks the app to
// a new temporary folder on each start and sets PORTABLE_EXECUTABLE_FILE / PORTABLE_EXECUTABLE_DIR.

import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const READY = "TEZGAH_READY ";
const RESTART_EXIT_CODE = 75;
const STOP_WAIT_MS = 5000;
const START_TIMEOUT_MS = 60_000;

/** The Tezgah.exe that the user started; an update replaces this file. Not set in development. */
const programFile = process.env.PORTABLE_EXECUTABLE_FILE || null;

function dataDirectory(): string {
  if (process.env.TEZGAH_DATA_DIR) return process.env.TEZGAH_DATA_DIR;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, "data");
  return path.join(app.getPath("userData"), "data");
}
const dataDir = dataDirectory();

function helperFile(): string {
  if (process.env.TEZGAH_HELPER) return process.env.TEZGAH_HELPER;
  return path.join(process.resourcesPath, "helper", process.platform === "win32" ? "tezgah-server.exe" : "tezgah-server");
}

/** Writes to the same log file as the helper (data/tezgah.log). */
function log(message: string) {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(path.join(dataDir, "tezgah.log"), `${new Date().toLocaleString("tr-TR")} [pencere] ${message}\n`);
  } catch {
    // logging must never stop the program
  }
}

let helper: ChildProcessWithoutNullStreams | null = null;
let pageUrl: string | null = null;
let window: BrowserWindow | null = null;
let quitting = false;

/** Starts the helper. Resolves with the page address when the server is ready. */
function startHelper(): Promise<string> {
  const args: string[] = [];
  const updated = process.argv.indexOf("--updated");
  if (updated >= 0 && process.argv[updated + 1]) args.push("--updated", process.argv[updated + 1]!);

  const child = spawn(helperFile(), args, {
    env: {
      ...process.env,
      TEZGAH_SHELL: "electron",
      TEZGAH_DATA_DIR: dataDir,
      TEZGAH_NO_BROWSER: "1",
      ...(programFile ? { TEZGAH_EXE_PATH: programFile } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  helper = child;

  return new Promise((resolve, reject) => {
    let ready = false;
    let stderr = "";
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Sunucu zamanında başlamadı.")), START_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!ready && line.startsWith(READY)) {
          ready = true;
          clearTimeout(timer);
          resolve(line.slice(READY.length).trim());
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      helper = null;
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(stderr.trim() || `Sunucu durdu (çıkış kodu ${code}).`));
        return;
      }
      onHelperExit(code);
    });
  });
}

function onHelperExit(code: number | null) {
  if (quitting) return;
  if (code === RESTART_EXIT_CODE) {
    log("Güncelleme kuruldu. Yeni sürüm başlatılıyor.");
    const port = pageUrl ? new URL(pageUrl).port : "";
    // relaunch starts the new Tezgah.exe after this process has exited.
    if (programFile) app.relaunch({ execPath: programFile, args: port ? ["--updated", port] : [] });
    else app.relaunch();
    quitting = true;
    app.exit(0);
    return;
  }
  if (code === 0) return; // the helper found an already running server and left it to the window
  log(`Sunucu beklenmedik şekilde durdu (çıkış kodu ${code}).`);
  dialog.showErrorBox("Tezgah", "Tezgah sunucusu beklenmedik şekilde durdu. Tezgah'ı yeniden açın.\n\nAyrıntılar: data\\tezgah.log");
  quitting = true;
  app.exit(1);
}

/** Closes the helper's stdin and waits for it to stop. */
function stopHelper(): Promise<void> {
  const child = helper;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log("Sunucu zamanında durmadı; kapatılıyor.");
      child.kill();
      resolve();
    }, STOP_WAIT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.stdin.end();
  });
}

async function quit() {
  if (quitting) return;
  quitting = true;
  await stopHelper();
  app.exit(0);
}

const LOADING_PAGE = `<!doctype html><html lang="tr"><meta charset="utf-8"><title>Tezgah</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:24px system-ui,sans-serif;color:#1d4ed8;background:#fff">
Tezgah açılıyor…</body></html>`;

function isAppPage(target: string) {
  return pageUrl !== null && target.startsWith(new URL(pageUrl).origin + "/");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "Tezgah",
    backgroundColor: "#ffffff",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  // Links to other sites open in the user's browser, never inside the Tezgah window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isAppPage(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppPage(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // The window has no menu, so the useful keys are added here: reload and zoom.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const contents = win.webContents;
    if (input.key === "F5" || (ctrl && input.key.toLowerCase() === "r")) contents.reload();
    else if (ctrl && (input.key === "+" || input.key === "=")) contents.setZoomLevel(contents.getZoomLevel() + 0.5);
    else if (ctrl && input.key === "-") contents.setZoomLevel(contents.getZoomLevel() - 0.5);
    else if (ctrl && input.key === "0") contents.setZoomLevel(0);
    else return;
    event.preventDefault();
  });
  win.on("closed", () => {
    if (window === win) window = null;
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_PAGE)}`);
  return win;
}

async function start() {
  log(`Tezgah penceresi açılıyor (Electron ${process.versions.electron}).`);
  window = createWindow();
  try {
    pageUrl = await startHelper();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Tezgah başlatılamadı: ${message}`);
    dialog.showErrorBox("Tezgah başlatılamadı", `${message}\n\nAyrıntılar: data\\tezgah.log`);
    quitting = true;
    helper?.kill();
    app.exit(1);
    return;
  }
  log(`Sayfa: ${pageUrl}`);
  await window?.loadURL(pageUrl);
}

// One Tezgah window program at a time. A second start shows the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => void quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void quit();
  });
  void app.whenReady().then(start);
}
