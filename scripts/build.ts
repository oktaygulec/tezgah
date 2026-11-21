// Builds the Windows and macOS executables into dist/.
// The web app (HTML, JS, CSS) is bundled into each executable through the HTML import in main.ts.

import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const entry = path.join(root, "src/server/main.ts");
const targets = [
  { target: "bun-windows-x64", outfile: "dist/Tezgah.exe" },
  { target: "bun-darwin-arm64", outfile: "dist/tezgah-mac" },
];

rmSync(path.join(root, "dist"), { recursive: true, force: true });

for (const { target, outfile } of targets) {
  console.log(`\n== ${target} -> ${outfile}`);
  const proc = Bun.spawnSync(
    [process.execPath, "build", entry, "--compile", "--minify", `--target=${target}`, "--outfile", outfile],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) {
    console.error(`Build failed for ${target} (exit code ${proc.exitCode}).`);
    process.exit(1);
  }
}
console.log("\nDone.");
