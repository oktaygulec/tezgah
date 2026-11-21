import type { Database } from "bun:sqlite";
import { productsToCsv } from "../shared/csv";
import { backupStamp, istanbulDay } from "../shared/time";
import type { HealthResponse } from "../shared/types";
import * as repo from "./db";
import { HttpError } from "./db";
import { buildTspl, bytesPerRow } from "../shared/tspl";
import type { PrintLabelInput } from "../shared/types";
import { listPrinters, sendRaw } from "./printer";
import * as stock from "./stock";
import { lowStock, salesReport } from "./reports";
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

const MAX_LABEL_DOTS = 2000; // 250 mm at 203 dpi

/** Checks the labels sent by the page and decodes their bitmaps. */
function readPrintLabels(input: unknown) {
  const labels = (input as { labels?: unknown })?.labels;
  if (!Array.isArray(labels) || labels.length === 0) throw new HttpError(400, "Yazdırılacak etiket yok.");
  if (labels.length > 500) throw new HttpError(400, "Bir seferde en fazla 500 farklı etiket yazdırılabilir.");
  return (labels as PrintLabelInput[]).map((l) => {
    const ok =
      Number.isInteger(l?.width) && Number.isInteger(l?.height) && l.width > 0 && l.height > 0 &&
      l.width <= MAX_LABEL_DOTS && l.height <= MAX_LABEL_DOTS &&
      Number.isInteger(l.copies) && l.copies >= 1 && l.copies <= 999 && typeof l.bitmap === "string";
    if (!ok) throw new HttpError(400, "Etiket verisi hatalı.");
    const bitmap = new Uint8Array(Buffer.from(l.bitmap, "base64"));
    if (bitmap.length !== bytesPerRow(l.width) * l.height) throw new HttpError(400, "Etiket görüntüsünün boyutu hatalı.");
    return { bitmap, width: l.width, height: l.height, copies: l.copies };
  });
}

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
      POST: safe(async (req) => {
        const body = await readJson(req);
        const initial = repo.validateInitialStock((body as { stock_qty?: unknown })?.stock_qty);
        return json(repo.createProduct(db, repo.validateProductInput(body), initial), 201);
      }),
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
    "/api/products/:id/favorite": {
      PUT: safe(async (req) => json(repo.setFavorite(db, idParam(req.params.id), (await readJson(req) as { favorite?: unknown })?.favorite))),
    },
    "/api/products/:id/image": {
      GET: safe((req) => {
        const image = repo.getProductImage(db, idParam(req.params.id));
        if (!image) throw new HttpError(404, "Bu ürünün fotoğrafı yok.");
        // The URL carries the photo time (?v=...), so the browser can keep the file.
        return new Response(new Uint8Array(image.data), { headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
      }),
      PUT: safe(async (req) => {
        const length = Number(req.headers.get("content-length") ?? 0);
        if (length > repo.MAX_IMAGE_BYTES) throw new HttpError(413, "Fotoğraf çok büyük (en fazla 2 MB).");
        return json(repo.setProductImage(db, idParam(req.params.id), new Uint8Array(await req.arrayBuffer())));
      }),
      DELETE: safe((req) => json(repo.deleteProductImage(db, idParam(req.params.id)))),
    },
    "/api/categories": {
      GET: safe(() => json(repo.listCategories(db))),
      POST: safe(async (req) => json(repo.createCategory(db, await readJson(req)), 201)),
    },
    "/api/categories/:id": {
      PUT: safe(async (req) => json(repo.updateCategory(db, idParam(req.params.id), await readJson(req)))),
      DELETE: safe((req) => {
        repo.deleteCategory(db, idParam(req.params.id));
        return json({ ok: true });
      }),
    },
    "/api/products/:id/stock": {
      GET: safe((req) => json(stock.listMovements(db, idParam(req.params.id)))),
      POST: safe(async (req) => json(stock.adjustStock(db, idParam(req.params.id), await readJson(req)))),
    },
    "/api/stock/low": {
      GET: safe(() => json(lowStock(db, repo.getSettings(db).low_stock_threshold))),
    },
    "/api/reports/sales": {
      GET: safe((req) => {
        const q = new URL(req.url).searchParams;
        return json(salesReport(db, q.get("period") ?? "month", q.get("date") ?? istanbulDay()));
      }),
    },
    "/api/stock/receive": {
      POST: safe(async (req) => json(stock.receiveStock(db, await readJson(req)))),
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
      DELETE: safe((req) => {
        repo.deleteOrder(db, idParam(req.params.id));
        return json({ ok: true });
      }),
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
    "/api/printers": {
      GET: safe(async () => {
        try {
          return json(await listPrinters());
        } catch (e) {
          throw new HttpError(500, `Yazıcı listesi alınamadı: ${(e as Error).message}`);
        }
      }),
    },
    "/api/print": {
      POST: safe(async (req, server) => {
        server.timeout(req, 120); // PowerShell start-up plus a large job can take a while
        const labels = readPrintLabels(await readJson(req));
        const s = repo.getSettings(db);
        if (!s.printer_name) throw new HttpError(400, "Önce Ayarlar ekranında bir yazıcı seçin.");
        const data = buildTspl(
          {
            widthMm: s.label_width_mm,
            heightMm: s.label_height_mm,
            gapMm: s.label_gap_mm,
            density: s.print_density,
            speed: s.print_speed,
            rotate180: s.print_rotate_180,
          },
          labels,
        );
        try {
          await sendRaw(s.printer_name, data);
        } catch (e) {
          throw new HttpError(500, `"${s.printer_name}" yazıcısına gönderilemedi: ${(e as Error).message}`);
        }
        return json({ ok: true, count: labels.reduce((n, l) => n + l.copies, 0) });
      }),
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
