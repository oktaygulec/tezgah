// Data folder location, browser opening and the "already running" check.

import path from "node:path";
import type { HealthResponse } from "../shared/types";

/** True when running as a `bun build --compile` executable, false under `bun run`. */
export const isCompiled = !/^bun(\.exe)?$/i.test(path.basename(process.execPath));

/** data/ beside the executable; in dev, data/ in the project folder. */
export function dataDirectory(): string {
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

export function isAddressInUse(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(err?.message ?? "");
}
