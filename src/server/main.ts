import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import index from "../web/index.html";
import { backupDatabase } from "./backup";
import { openDatabase } from "./db";
import { apiRoutes } from "./routes";
import { dataDirectory, isAddressInUse, isCompiled, isPortTaken, isTezgahRunning, openBrowser } from "./system";

const FIRST_PORT = 5757;
const EXTRA_PORTS = 10;

async function main() {
  const dataDir = dataDirectory();
  let db: Database | undefined;

  for (let port = FIRST_PORT; port <= FIRST_PORT + EXTRA_PORTS; port++) {
    if (await isTezgahRunning(port)) {
      console.log(`Tezgah zaten çalışıyor (port ${port}). Tarayıcı açılıyor.`);
      openBrowser(`http://localhost:${port}`);
      process.exit(0);
    }
    if (await isPortTaken(port)) {
      console.log(`Port ${port} başka bir program tarafından kullanılıyor, sonraki deneniyor.`);
      continue;
    }

    // Open the database only when this copy will really run.
    mkdirSync(dataDir, { recursive: true });
    db ??= openDatabase(path.join(dataDir, "tezgah.db"));

    let server: ReturnType<typeof Bun.serve>;
    try {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        development: !isCompiled,
        routes: { "/": index, ...apiRoutes(db) },
        fetch: () => new Response("Bulunamadı", { status: 404 }),
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
    console.log("Tezgah çalışıyor. Bu pencereyi kapatırsanız program durur.");
    console.log(`Adres: ${url}`);
    console.log(`Veri klasörü: ${dataDir}`);
    console.log(`Yedek: ${backup}`);
    openBrowser(url);
    return;
  }
  throw new Error(`${FIRST_PORT}-${FIRST_PORT + EXTRA_PORTS} arasındaki tüm portlar dolu.`);
}

main().catch((e) => {
  console.error("Tezgah başlatılamadı:", e);
  // Keep the console window open on Windows so the user can read the error.
  if (process.stdin.isTTY) prompt("Kapatmak için Enter tuşuna basın.");
  process.exit(1);
});
