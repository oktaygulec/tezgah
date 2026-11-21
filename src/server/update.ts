// Self-update from the latest GitHub release.
// Flow: check -> download the asset for this platform -> verify SHA-256 -> swap the executable
// (rename the running file to *.old, move the new file in) -> restart.

import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "../../package.json";
import type { UpdateInfo } from "../shared/types";
import { HttpError } from "./db";
import { isCompiled } from "./system";

export const VERSION: string = pkg.version;
export const REPO = "oktaygulec/tezgah";
/** TEZGAH_UPDATE_URL points the updater at another "latest release" JSON (used for testing). */
const LATEST_URL = process.env.TEZGAH_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECKSUMS_ASSET = "SHA256SUMS.txt";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** Compares "1.2.3" style versions (a leading "v" is ignored). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The release asset name for this platform, or null when there is none. */
export function assetNameFor(platform: string): string | null {
  if (platform === "win32") return "Tezgah.exe";
  if (platform === "darwin") return "tezgah-mac";
  return null;
}

/** Parses "<sha256>  <file name>" lines. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match) sums.set(match[2]!.trim(), match[1]!.toLowerCase());
  }
  return sums;
}

export function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function github(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Tezgah-Updater", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (e) {
    throw new HttpError(502, `GitHub'a bağlanılamadı. İnternet bağlantısını kontrol edin. (${(e as Error).message})`);
  }
  if (!res.ok) throw new HttpError(502, `GitHub yanıt vermedi (${res.status}).`);
  return res;
}

interface Release {
  tag_name: string;
  body: string | null;
  html_url: string;
  assets: ReleaseAsset[];
}

async function latestRelease(): Promise<Release> {
  return (await (await github(LATEST_URL)).json()) as Release;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const release = await latestRelease();
  const latest = release.tag_name.replace(/^v/, "");
  return {
    current: VERSION,
    latest,
    available: compareVersions(latest, VERSION) > 0,
    notes: release.body ?? "",
    url: release.html_url,
  };
}

/** Renames with a few retries: antivirus programs can lock a new .exe for a moment. */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      if (attempt >= 10) throw e;
      await Bun.sleep(500);
    }
  }
}

/** Downloads, verifies and installs the latest release. Returns the installed version. */
export async function installUpdate(): Promise<string> {
  if (!isCompiled) throw new HttpError(400, "Geliştirme modunda güncelleme yapılamaz. Derlenmiş programı kullanın.");
  const assetName = assetNameFor(process.platform);
  if (!assetName) throw new HttpError(400, `Bu işletim sistemi için güncelleme yok: ${process.platform}`);

  const release = await latestRelease();
  const latest = release.tag_name.replace(/^v/, "");
  if (compareVersions(latest, VERSION) <= 0) throw new HttpError(409, `Program zaten güncel (${VERSION}).`);

  const asset = release.assets.find((a) => a.name === assetName);
  const sumsAsset = release.assets.find((a) => a.name === CHECKSUMS_ASSET);
  if (!asset || !sumsAsset) throw new HttpError(502, `Sürüm ${latest} içinde ${assetName} veya ${CHECKSUMS_ASSET} yok.`);

  const expected = parseChecksums(await (await github(sumsAsset.browser_download_url)).text()).get(assetName);
  if (!expected) throw new HttpError(502, `${CHECKSUMS_ASSET} içinde ${assetName} için kayıt yok.`);
  const bytes = new Uint8Array(await (await github(asset.browser_download_url)).arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new HttpError(502, "İndirilen dosya doğrulanamadı (SHA-256 uyuşmuyor). Güncelleme yapılmadı.");
  }

  const exe = process.execPath;
  const incoming = `${exe}.new`;
  const old = `${exe}.old`;
  writeFileSync(incoming, bytes);
  if (process.platform !== "win32") chmodSync(incoming, 0o755);
  rmSync(old, { force: true });
  // Windows allows renaming a running .exe, but not overwriting it.
  await renameWithRetry(exe, old);
  try {
    await renameWithRetry(incoming, exe);
  } catch (e) {
    renameSync(old, exe); // put the working version back
    rmSync(incoming, { force: true });
    throw new HttpError(500, `Yeni sürüm yerine konamadı: ${(e as Error).message}`);
  }
  console.log(`Sürüm ${latest} indirildi ve doğrulandı. Program yeniden başlatılıyor.`);
  return latest;
}

/** Starts the (new) executable in a new process. The caller then exits. */
export function startNewProcess(oldPort: number) {
  const exe = process.execPath;
  const args = ["--updated", String(oldPort)];
  if (process.platform === "win32") {
    // Detached: the new process keeps running after this process exits.
    Bun.spawn([exe, ...args], { stdio: ["ignore", "ignore", "ignore"], detached: true });
  } else {
    Bun.spawn(["/bin/sh", "-c", '"$0" "$@" &', exe, ...args], { stdio: ["ignore", "inherit", "inherit"] });
  }
}

/** After an update the new process gets "--updated <port>": the port of the old process. */
export function updatedFromPort(argv: string[]): number | null {
  const i = argv.indexOf("--updated");
  if (i < 0) return null;
  const port = Number(argv[i + 1]);
  return Number.isInteger(port) ? port : null;
}

/** Removes the previous executable left by an update (the old process may still be closing). */
export async function cleanUpOldExecutable() {
  if (!isCompiled) return;
  const old = `${process.execPath}.old`;
  for (let attempt = 1; existsSync(old); attempt++) {
    try {
      rmSync(old, { force: true });
    } catch (e) {
      if (attempt >= 20) {
        console.error(`Eski sürüm dosyası silinemedi (${path.basename(old)}). Bir sonraki açılışta tekrar denenecek.`, e);
        return;
      }
      await Bun.sleep(500);
    }
  }
}
