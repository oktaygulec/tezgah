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
- Money is integer kuruş. Timestamps are ISO 8601 UTC, shown in `Europe/Istanbul`.

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
                 backup.ts, system.ts (data folder, browser open, port probes), update.ts (self-update)
src/web/         index.html, app.ts (tabs), api.ts, ui.ts (DOM helpers, dialogs, scan focus),
                 label.ts (label drawing), productForm.ts, search.ts, state.ts, updater.ts,
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
| `GET /api/update` | `{ current, latest, available, notes, url }` from the latest GitHub release |
| `POST /api/update` | download, verify and install the latest release, then restart |

Errors are JSON `{ "error": "<Turkish message>" }`. The server logs unexpected errors to the console.

## Labels

`src/web/label.ts` draws the barcode with JsBarcode as SVG, with 1 SVG unit = 1 module. It then
scales the SVG to a whole number of 203 dpi printer dots per module (2 to 4 dots, so the narrowest
bar is at least 0.25 mm). When the label is short of space, the text gets smaller; the bars never do.
EAN-13 and EAN-8 are used when the check digit is valid; every other code is printed as Code 128.
