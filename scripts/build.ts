// Builds the release files into dist/:
// - dist/Tezgah.exe: the Windows program. An Electron window (electron/) with the Bun server inside
//   as a helper (dist/helper/tezgah-server.exe). One portable file, built with electron-builder.
// - dist/tezgah-mac: the Bun server alone for macOS. It opens its page in Chrome or Edge.
// - dist/SHA256SUMS.txt: the in-app updater checks downloads against this file.
// The web app (HTML, JS, CSS) is bundled into the server through the HTML import in main.ts.

import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "../package.json";

const root = path.resolve(import.meta.dir, "..");
const entry = path.join(root, "src/server/main.ts");

function run(label: string, cmd: string[], cwd = root) {
  console.log(`\n== ${label}`);
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error(`${label}: failed (exit code ${proc.exitCode}).`);
    process.exit(1);
  }
}

function compileServer(target: string, outfile: string, extra: string[] = []) {
  run(`${target} -> ${outfile}`, [
    process.execPath, "build", entry, "--compile", "--minify", `--target=${target}`, "--outfile", outfile, ...extra,
  ]);
}

rmSync(path.join(root, "dist"), { recursive: true, force: true });

// No console window for the helper: the Electron window program starts it hidden.
compileServer("bun-windows-x64", "dist/helper/tezgah-server.exe", ["--windows-hide-console"]);
compileServer("bun-darwin-arm64", "dist/tezgah-mac");

run("electron/main.ts -> electron/out/main.js", [
  process.execPath, "build", "electron/main.ts", "--target=node", "--format=cjs", "--external=electron",
  "--outfile", "electron/out/main.js",
]);
run("electron-builder (Windows portable)", [
  "node", "node_modules/electron-builder/cli.js", "--win", "portable", "--x64", "--publish", "never",
  `-c.extraMetadata.version=${pkg.version}`,
], path.join(root, "electron"));
copyFileSync(path.join(root, "dist/electron/Tezgah.exe"), path.join(root, "dist/Tezgah.exe"));

// The in-app updater checks downloads against this file. Upload it with every release.
const files = ["dist/Tezgah.exe", "dist/tezgah-mac"];
const sums = files
  .map((file) => {
    const hash = new Bun.CryptoHasher("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    return `${hash}  ${path.basename(file)}`;
  })
  .join("\n");
writeFileSync(path.join(root, "dist/SHA256SUMS.txt"), sums + "\n");
console.log(`\n${sums}\nDone.`);
