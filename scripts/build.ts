// Builds the Windows and macOS executables into dist/.
// The web app (HTML, JS, CSS) is bundled into each executable through the HTML import in main.ts.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const entry = path.join(root, "src/server/main.ts");
const targets = [
  // No console window on Windows: Tezgah opens its own app window (see src/server/desktop.ts).
  { target: "bun-windows-x64", outfile: "dist/Tezgah.exe", extra: ["--windows-hide-console"] },
  { target: "bun-darwin-arm64", outfile: "dist/tezgah-mac", extra: [] },
];

rmSync(path.join(root, "dist"), { recursive: true, force: true });

for (const { target, outfile, extra } of targets) {
  console.log(`\n== ${target} -> ${outfile}`);
  const proc = Bun.spawnSync(
    [process.execPath, "build", entry, "--compile", "--minify", `--target=${target}`, "--outfile", outfile, ...extra],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`Build failed for ${target} (exit code ${proc.exitCode}).`);
    process.exit(1);
  }
}
// The in-app updater checks downloads against this file. Upload it with every release.
const sums = targets
  .map(({ outfile }) => {
    const hash = new Bun.CryptoHasher("sha256").update(readFileSync(path.join(root, outfile))).digest("hex");
    return `${hash}  ${path.basename(outfile)}`;
  })
  .join("\n");
writeFileSync(path.join(root, "dist/SHA256SUMS.txt"), sums + "\n");
console.log(`\n${sums}\nDone.`);
