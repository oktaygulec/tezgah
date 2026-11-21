import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import index from "../web/index.html";
import { backupDatabase } from "./backup";
import { openDatabase } from "./db";
import { createLifetime, LIVE_PATH, logToFile, openAppWindow, showErrorBox } from "./desktop";
import { apiRoutes, type AppHooks } from "./routes";
import { cleanUpOldExecutable, startNewProcess, updatedFromPort, VERSION } from "./update";
import { dataDirectory, inElectron, isAddressInUse, isCompiled, isPortTaken, isTezgahRunning } from "./system";

const FIRST_PORT = 5757;
const EXTRA_PORTS = 10;
/** After an update the open page reloads itself. If no window connects in this time, open one. */
const UPDATE_WINDOW_WAIT_MS = 20_000;

// Messages to the Electron window program (electron/main.ts), one line each on stdout.
const READY = "TEZGAH_READY"; // followed by the page address
/** Exit code that asks the Electron window program to start the newly installed Tezgah.exe. */
const RESTART_EXIT_CODE = 75;

async function main() {
  const dataDir = dataDirectory();
  mkdirSync(dataDir, { recursive: true });
  if (isCompiled) logToFile(path.join(dataDir, "tezgah.log"));

  let db: Database | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;

  // After an update, wait until the old process has stopped.
  const oldPort = updatedFromPort(process.argv);
  if (oldPort !== null) {
    for (let i = 0; i < 30 && (await isTezgahRunning(oldPort)); i++) await Bun.sleep(500);
  }

  function stopServer() {
    server?.stop(true);
    db?.close();
  }

  const lifetime = createLifetime(() => {
    stopServer();
    process.exit(0);
  });

  const hooks: AppHooks = {
    restart() {
      const port = server?.port ?? FIRST_PORT;
      stopServer();
      if (inElectron) process.exit(RESTART_EXIT_CODE);
      startNewProcess(port);
      process.exit(0);
    },
    healthChecked: () => lifetime.expectWindow(),
  };

  for (let port = FIRST_PORT; port <= FIRST_PORT + EXTRA_PORTS; port++) {
    if (await isTezgahRunning(port)) {
      if (inElectron) {
        // Another server already runs (for example an older copy): the window uses it.
        console.log(`${READY} http://localhost:${port}`);
        process.exit(0);
      }
      console.log(`Tezgah zaten çalışıyor (port ${port}). Yeni pencere açılıyor.`);
      openAppWindow(`http://localhost:${port}`);
      process.exit(0);
    }
    if (await isPortTaken(port)) {
      console.log(`Port ${port} başka bir program tarafından kullanılıyor, sonraki deneniyor.`);
      continue;
    }

    // Open the database only when this copy will really run.
    db ??= openDatabase(path.join(dataDir, "tezgah.db"));

    try {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        development: !isCompiled,
        routes: {
          "/": index,
          // Each open Tezgah window keeps this WebSocket open (see desktop.ts).
          [LIVE_PATH]: (req, srv) => (srv.upgrade(req) ? undefined : new Response("WebSocket gerekli", { status: 400 })),
          ...apiRoutes(db, hooks),
        },
        fetch: () => new Response("Bulunamadı", { status: 404 }),
        websocket: lifetime.websocket,
        error(e) {
          console.error("Sunucu hatası:", e);
          return Response.json({ error: `Sunucu hatası: ${e.message}` }, { status: 500 });
        },
      });
    } catch (e) {
      if (!isAddressInUse(e)) throw e;
      console.log(`Port ${port} kullanımda, sonraki deneniyor.`);
      continue;
    }

    const backup = backupDatabase(db, dataDir);
    const url = `http://localhost:${server.port}`;
    console.log(`Tezgah ${VERSION} çalışıyor. Son Tezgah penceresi kapanınca program durur.`);
    console.log(`Adres: ${url}`);
    console.log(`Veri klasörü: ${dataDir}`);
    console.log(`Yedek: ${backup}`);
    if (inElectron) {
      console.log(`${READY} ${url}`);
      // The window program closes this pipe when it closes (or crashes): then stop cleanly.
      process.stdin.on("close", () => lifetime.stopNow());
      process.stdin.on("end", () => lifetime.stopNow());
      process.stdin.resume();
    } else if (oldPort === null) {
      openAppWindow(url);
    } else {
      // After an update the open page reloads itself. Open a window only if it does not come back.
      setTimeout(() => {
        if (lifetime.windows === 0) openAppWindow(url);
      }, UPDATE_WINDOW_WAIT_MS);
    }
    void cleanUpOldExecutable();
    return;
  }
  throw new Error(`${FIRST_PORT}-${FIRST_PORT + EXTRA_PORTS} arasındaki tüm portlar dolu.`);
}

main().catch((e) => {
  console.error("Tezgah başlatılamadı:", e);
  if (!inElectron) showErrorBox(`Tezgah başlatılamadı.\n\n${(e as Error)?.message ?? e}\n\nAyrıntılar: data\\tezgah.log`);
  process.exit(1);
});
