import { mkdirSync } from "node:fs";
import path from "node:path";
import index from "../web/index.html";
import { backupDatabase } from "./backup";
import { openDatabase } from "./db";
import { apiRoutes } from "./routes";
import { dataDirectory, isAddressInUse, isCompiled, isTezgahRunning, openBrowser } from "./system";

const FIRST_PORT = 5757;
const EXTRA_PORTS = 10;

async function main() {
  const dataDir = dataDirectory();
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, "tezgah.db"));

  for (let port = FIRST_PORT; port <= FIRST_PORT + EXTRA_PORTS; port++) {
    try {
      const server = Bun.serve({
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

      const backup = backupDatabase(db, dataDir);
      const url = `http://localhost:${server.port}`;
      console.log("Tezgah çalışıyor. Bu pencereyi kapatırsanız program durur.");
      console.log(`Adres: ${url}`);
      console.log(`Veri klasörü: ${dataDir}`);
      console.log(`Yedek: ${backup}`);
      openBrowser(url);
      return;
    } catch (e) {
      if (!isAddressInUse(e)) throw e;
      if (await isTezgahRunning(port)) {
        db.close();
        console.log(`Tezgah zaten çalışıyor (port ${port}). Tarayıcı açılıyor.`);
        openBrowser(`http://localhost:${port}`);
        process.exit(0);
      }
      console.log(`Port ${port} başka bir program tarafından kullanılıyor, sonraki deneniyor.`);
    }
  }
  throw new Error(`${FIRST_PORT}-${FIRST_PORT + EXTRA_PORTS} arasındaki tüm portlar dolu.`);
}

main().catch((e) => {
  console.error("Tezgah başlatılamadı:", e);
  // Keep the console window open on Windows so the user can read the error.
  if (process.stdin.isTTY) prompt("Kapatmak için Enter tuşuna basın.");
  process.exit(1);
});
