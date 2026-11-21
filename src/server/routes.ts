import type { Database } from "bun:sqlite";
import { productsToCsv } from "../shared/csv";
import { backupStamp } from "../shared/time";
import type { HealthResponse } from "../shared/types";
import * as repo from "./db";
import { HttpError } from "./db";
import { checkForUpdate, installUpdate, VERSION } from "./update";

type Handler = (
  req: Request & { params: Record<string, string> },
  server: Bun.Server<undefined>,
) => Response | Promise<Response>;

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Turns thrown errors into a JSON error with a Turkish message, and logs them. */
function safe(handler: Handler): Handler {
  return async (req, server) => {
    try {
      return await handler(req, server);
    } catch (e) {
      const where = `${req.method} ${new URL(req.url).pathname}`;
      if (e instanceof HttpError) {
        if (e.status >= 500) console.error(`${where}: ${e.message}`);
        return json({ error: e.message }, e.status);
      }
      // Log the stack as text: printing the error object dumps minified source code.
      console.error(`${where} hata: ${(e as Error)?.stack ?? String(e)}`);
      return json({ error: `Sunucu hatası: ${(e as Error)?.message ?? String(e)}` }, 500);
    }
  };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "İstek gövdesi geçerli JSON değil.");
  }
}

function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Geçersiz numara.");
  return id;
}

const download = (body: BodyInit, type: string, filename: string) =>
  new Response(body, {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${filename}"` },
  });

export interface AppHooks {
  /** Stops the server and starts the newly installed executable. */
  restart(): void;
}

export function apiRoutes(db: Database, hooks: AppHooks) {
  return {
    "/api/health": {
      GET: safe(() => json({ app: "tezgah", ok: true, version: VERSION } satisfies HealthResponse)),
    },
    "/api/products": {
      GET: safe(() => json(repo.listProducts(db))),
      POST: safe(async (req) => json(repo.createProduct(db, repo.validateProductInput(await readJson(req))), 201)),
    },
    "/api/products/:id": {
      PUT: safe(async (req) =>
        json(repo.updateProduct(db, idParam(req.params.id), repo.validateProductInput(await readJson(req)))),
      ),
      DELETE: safe((req) => {
        repo.deleteProduct(db, idParam(req.params.id));
        return json({ ok: true });
      }),
    },
    "/api/products/by-barcode/:barcode": {
      GET: safe((req) => {
        const barcode = req.params.barcode ?? "";
        const product = repo.getProductByBarcode(db, barcode);
        if (!product) throw new HttpError(404, `Ürün bulunamadı: ${barcode}`);
        return json(product);
      }),
    },
    "/api/products/import": {
      POST: safe(async (req) => json(repo.importProductsCsv(db, await req.text()))),
    },
    "/api/products/export": {
      GET: safe(() => download(productsToCsv(repo.listProducts(db)), "text/csv; charset=utf-8", "urunler.csv")),
    },
    "/api/barcode/next": {
      GET: safe(() => json({ barcode: repo.nextBarcode(db) })),
    },
    "/api/orders": {
      GET: safe((req) => json(repo.listOrders(db, new URL(req.url).searchParams.get("day") ?? undefined))),
      POST: safe(async (req) => json(repo.createOrder(db, await readJson(req)), 201)),
    },
    "/api/orders/:id": {
      GET: safe((req) => json(repo.getOrder(db, idParam(req.params.id)))),
    },
    "/api/orders/:id/cancel": {
      POST: safe((req) => json(repo.cancelOrder(db, idParam(req.params.id)))),
    },
    "/api/settings": {
      GET: safe(() => json(repo.getSettings(db))),
      PUT: safe(async (req) => json(repo.saveSettings(db, await readJson(req)))),
    },
    "/api/backup": {
      GET: safe(() => download(new Uint8Array(db.serialize()), "application/octet-stream", `tezgah-${backupStamp()}.db`)),
    },
    "/api/update": {
      GET: safe(async () => json(await checkForUpdate())),
      POST: safe(async (req, server) => {
        // The download can take minutes; Bun closes idle requests after 10 s by default.
        server.timeout(req, 0);
        const version = await installUpdate();
        setTimeout(() => hooks.restart(), 300); // send the answer first
        return json({ ok: true, version });
      }),
    },
    "/api/*": safe(() => json({ error: "Bulunamadı." }, 404)),
  };
}
