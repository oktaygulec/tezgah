// Data folder location, browser opening and the "already running" check.

import path from "node:path";
import type { HealthResponse } from "../shared/types";

/** True when running as a `bun build --compile` executable, false under `bun run`. */
export const isCompiled = !/^bun(\.exe)?$/i.test(path.basename(process.execPath));

/**
 * True when the Electron window program (electron/main.ts) runs this server as its helper.
 * The window program then owns the window, the data folder and the restart after an update.
 */
export const inElectron = process.env.TEZGAH_SHELL === "electron";

/** data/ beside the executable; in dev, data/ in the project folder. TEZGAH_DATA_DIR overrides both. */
export function dataDirectory(): string {
  if (process.env.TEZGAH_DATA_DIR) return process.env.TEZGAH_DATA_DIR;
  const base = isCompiled ? path.dirname(process.execPath) : path.resolve(import.meta.dir, "../..");
  return path.join(base, "data");
}

export function openBrowser(url: string): void {
  if (process.env.TEZGAH_NO_BROWSER === "1") return;
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] });
  } catch (e) {
    console.error(`Tarayıcı açılamadı. Adresi elle açın: ${url}`, e);
  }
}

/** True when a Tezgah server answers /api/health on this port. */
export async function isTezgahRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as Partial<HealthResponse>;
    return res.ok && body.app === "tezgah";
  } catch {
    return false; // anything else on that port is "not Tezgah"
  }
}

/**
 * True when some program accepts connections on this port (IPv4 or IPv6 loopback).
 * We check this before binding because the operating system does not always refuse
 * a second bind to the same port (macOS accepted it in testing).
 */
export async function isPortTaken(port: number): Promise<boolean> {
  for (const hostname of ["127.0.0.1", "::1"]) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: { data() {}, error() {} } });
      socket.end();
      return true;
    } catch {
      // connection refused: nothing listens on this address
    }
  }
  return false;
}

export function isAddressInUse(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(err?.message ?? "");
}
