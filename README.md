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

The first Windows build downloads the Bun Windows runtime, so the build machine needs internet once.
The executables need no internet and no files beside them. HTML, JS and CSS are embedded through the
HTML import in `src/server/main.ts`. The UI uses system fonts, so there are no font files.

## Runtime behaviour

- Data: `data/tezgah.db` beside the executable (in dev: the project folder). Created on first start.
- Backup: every start writes `data/backups/tezgah-YYYYMMDD-HHmmss.db` (Istanbul time) with `VACUUM INTO`. The newest 30 are kept.
- Port: 5757. If a Tezgah already answers `/api/health` there, the new copy opens the browser and exits. If another program uses the port, the next 10 ports are tried. The app connects to the port before it binds, because macOS accepted a second bind to the same port in testing.
- Money is integer kuruş. Timestamps are ISO 8601 UTC, shown in `Europe/Istanbul`.

## Project layout

```
src/server/      main.ts (start-up, port loop), routes.ts (JSON API), db.ts (SQLite schema + queries),
                 backup.ts, system.ts (data folder, browser open, port probes)
src/web/         index.html, app.ts (tabs), api.ts, ui.ts (DOM helpers, dialogs, scan focus),
                 label.ts (label drawing), productForm.ts, search.ts, state.ts,
                 screens/ (sale, price, products, labels, orders, settings), styles.css, print.css
src/shared/      barcode.ts, money.ts, order.ts, csv.ts, time.ts, types.ts
tests/           bun test files
scripts/build.ts builds both executables
```

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | `{ app: "tezgah", ok: true, version }` |
| `GET/POST /api/products` | list all / create |
| `PUT/DELETE /api/products/:id` | update / delete (409 when the product is on an order) |
| `GET /api/products/by-barcode/:barcode` | look up (404 when unknown) |
| `POST /api/products/import` | CSV text body `barkod;ad;fiyat`; known barcodes are updated |
| `GET /api/products/export` | CSV download (UTF-8 with BOM) |
| `GET /api/barcode/next` | next free in-store EAN-13 (`2` + 11-digit sequence + check digit) |
| `GET/POST /api/orders` | list (`?day=YYYY-MM-DD`, Istanbul day; no day = latest 200) / create |
| `GET /api/orders/:id` | order with lines |
| `GET/PUT /api/settings` | label and shop settings |
| `GET /api/backup` | download the current database |

Errors are JSON `{ "error": "<Turkish message>" }`. The server logs unexpected errors to the console.

## Labels

`src/web/label.ts` draws the barcode with JsBarcode as SVG, with 1 SVG unit = 1 module. It then
scales the SVG to a whole number of 203 dpi printer dots per module (2 to 4 dots, so the narrowest
bar is at least 0.25 mm). When the label is short of space, the text gets smaller; the bars never do.
EAN-13 and EAN-8 are used when the check digit is valid; every other code is printed as Code 128.
