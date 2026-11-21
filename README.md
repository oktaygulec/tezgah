# Tezgah

A small offline shop app: products, barcode labels on a thermal printer, price check, and sale orders.
It ships as one executable. The executable starts a local server on `127.0.0.1`, opens the default
browser, and keeps its data in a `data/` folder beside itself.

Shop users: see [KULLANIM.md](KULLANIM.md) (Turkish).

## Requirements

- [Bun](https://bun.sh) 1.4 or newer.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `bun install` |
| Run in dev (data goes to `./data/`) | `bun run dev` |
| Run tests | `bun test` |
| Type check | `bunx tsc --noEmit` |
| Build both executables | `bun run scripts/build.ts` |

`bun run dev` opens the browser. Set `TEZGAH_NO_BROWSER=1` to skip that (useful for scripts and tests).

The build writes:

- `dist/Tezgah.exe`: Windows x64 (console program; the console window must stay open).
- `dist/tezgah-mac`: macOS arm64, for testing on a Mac.
- `dist/SHA256SUMS.txt`: checksums for the in-app updater.

The first Windows build downloads the Bun Windows runtime, so the build machine needs internet once.
The executables need no internet and no files beside them. HTML, JS and CSS are embedded through the
HTML import in `src/server/main.ts`. The UI uses system fonts, so there are no font files.

## Runtime behaviour

- Data: `data/tezgah.db` beside the executable (in dev: the project folder). Created on first start.
- Backup: every start writes `data/backups/tezgah-YYYYMMDD-HHmmss.db` (Istanbul time) with `VACUUM INTO`. The newest 30 are kept.
- Port: 5757. If a Tezgah already answers `/api/health` there, the new copy opens the browser and exits. If another program uses the port, the next 10 ports are tried. The app connects to the port before it binds, because macOS accepted a second bind to the same port in testing.
- Stock: `products.stock_qty` (whole pieces) plus a `stock_movements` history with a reason per row
  (`initial`, `receive`, `remove`, `count`, `sale`, `sale_cancel`, `import`). A completed order lowers
  the stock, a cancel gives it back, and a delete of a cancelled order changes nothing. Stock may go
  below zero: a sale is never blocked.
- Order numbers never repeat: a counter table keeps the highest number, also after a delete.
- Money is integer kuruş. Timestamps are ISO 8601 UTC, shown in `Europe/Istanbul`.

## Label printing

`src/web/label.ts` draws each label on a canvas at 203 dpi (8 dots per mm) and makes it pure black and
white. That one image is used three ways:

1. **Preview:** shown at its real size in mm.
2. **Direct printing (default when a printer is chosen in Ayarlar):** the page packs the image into
   TSPL bitmap rows (`src/shared/tspl.ts`, 0 bit = black dot) and posts it to `POST /api/print`. The
   server wraps it in TSPL (`SIZE`, `GAP`, `DIRECTION`, `DENSITY`, `SPEED`, `BITMAP`, `PRINT`) and
   sends it as one RAW job (`src/server/printer.ts`). On Windows this uses the spooler with the "RAW"
   data type through a small PowerShell + C# helper, so the driver, paper size and orientation
   settings are skipped. On macOS/Linux it uses `lp -o raw`.
3. **Browser fallback:** one `<img>` per page with `@page { size: <w>mm <h>mm; margin: 0 }`.

The barcode uses a whole number of dots per module (2 to 4), so the narrowest bar is at least
0.25 mm. When space is short, the text gets smaller; the bars never do.

For tests, `TEZGAH_PRINT_TO_FILE=<path>` adds a printer named "Test dosyası (TEZGAH_PRINT_TO_FILE)"
whose jobs are appended to that file.

## Updates and releases

**Ayarlar → Güncelleme** checks `https://api.github.com/repos/oktaygulec/tezgah/releases/latest`.
When the release tag is newer than the running version (`package.json` `version`), the app does this:

1. It downloads `Tezgah.exe` (Windows) or `tezgah-mac` (macOS) and `SHA256SUMS.txt` from the release.
2. It checks the SHA-256 of the download. On a mismatch it stops and changes nothing.
3. It renames the running file to `<exe>.old`, then moves the new file into place. Windows allows a rename of a running `.exe`.
4. It stops the server and starts the new file with `--updated <old port>`. The new process waits until the old one has stopped. It does not open a new browser tab. The open page waits for the new version, then reloads.
5. The new process deletes `<exe>.old`.

The checksum file comes from the same release, so it only detects a broken download. It does not
protect against a changed release. Anyone with write access to the repository can ship code to every
installed copy. The executables are not code-signed.

To publish a new version:

1. Set the new `version` in `package.json` (for example `1.2.0`) and commit.
2. Run `bun run scripts/build.ts`. This also writes `dist/SHA256SUMS.txt`.
3. Tag and push: `git tag -a v1.2.0 -m "Tezgah 1.2.0" && git push origin main v1.2.0`.
4. Create the release with all three files:
   `gh release create v1.2.0 dist/Tezgah.exe dist/tezgah-mac dist/SHA256SUMS.txt --title "Tezgah 1.2.0" --notes "..."`

Do not mark a release as a draft or pre-release. The `latest` API ignores those.

For tests, `TEZGAH_UPDATE_URL` points the updater at another "latest release" JSON.

## Project layout

```
src/server/      main.ts (start-up, port loop), routes.ts (JSON API), db.ts (SQLite schema + queries),
                 backup.ts, system.ts (data folder, browser open, port probes), update.ts (self-update),
                 printer.ts (printer list, RAW print jobs), stock.ts (stock adjust, goods in, history)
src/web/         index.html, app.ts (tabs), api.ts, ui.ts (DOM helpers, dialogs, scan focus),
                 label.ts (label drawing), productForm.ts, stockDialog.ts, search.ts, state.ts, updater.ts,
                 screens/ (sale, price, products, stockIn, labels, orders, settings), styles.css, print.css
src/shared/      barcode.ts, money.ts, order.ts, csv.ts, stock.ts, time.ts, tspl.ts, types.ts, validate.ts
tests/           bun test files
scripts/build.ts builds both executables
```

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | `{ app: "tezgah", ok: true, version }` |
| `GET/POST /api/products` | list all / create (optional `stock_qty` = starting stock) |
| `PUT/DELETE /api/products/:id` | update / delete (409 when the product is on an order) |
| `GET /api/products/by-barcode/:barcode` | look up (404 when unknown) |
| `POST /api/products/import` | CSV text body `barkod;ad;fiyat[;stok]`; known barcodes are updated; a `stok` value sets the stock |
| `GET /api/products/export` | CSV download `barkod;ad;fiyat;stok` (UTF-8 with BOM) |
| `GET/POST /api/products/:id/stock` | stock history (newest first) / `{ mode: add\|remove\|set, quantity, note }` |
| `POST /api/stock/receive` | goods in: `{ lines: [{ product_id, quantity }], note }`, one transaction |
| `GET /api/barcode/next` | next free in-store EAN-13 (`2` + 11-digit sequence + check digit) |
| `GET/POST /api/orders` | list (`?day=YYYY-MM-DD`, Istanbul day; no day = latest 200) / create |
| `GET/DELETE /api/orders/:id` | order with lines / delete (only a cancelled order) |
| `POST /api/orders/:id/cancel` | cancel a saved order (kept, left out of totals) |
| `GET/PUT /api/settings` | label and shop settings |
| `GET /api/printers` | `{ printers, default }` installed printers |
| `POST /api/print` | `{ labels: [{ bitmap, width, height, copies }] }` → RAW TSPL job to the chosen printer |
| `GET /api/backup` | download the current database |
| `GET /api/update` | `{ current, latest, available, notes, url }` from the latest GitHub release |
| `POST /api/update` | download, verify and install the latest release, then restart |

Errors are JSON `{ "error": "<Turkish message>" }`. The server logs unexpected errors to the console.
