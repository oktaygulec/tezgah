import { describe, expect, test } from "bun:test";
import { assetNameFor, compareVersions, parseChecksums, sha256, updatedFromPort, VERSION } from "../src/server/update";
import pkg from "../package.json";

describe("updater helpers", () => {
  test("version comes from package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  test("compareVersions", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareVersions("2.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  test("asset per platform", () => {
    expect(assetNameFor("win32")).toBe("Tezgah.exe");
    expect(assetNameFor("darwin")).toBe("tezgah-mac");
    expect(assetNameFor("linux")).toBeNull();
  });

  test("parseChecksums reads shasum output", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    const sums = parseChecksums(`${a}  Tezgah.exe\r\n${b} *tezgah-mac\n\nnot a line\n`);
    expect(sums.get("Tezgah.exe")).toBe(a);
    expect(sums.get("tezgah-mac")).toBe("b".repeat(64));
    expect(sums.size).toBe(2);
  });

  test("sha256", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("--updated <port> argument", () => {
    expect(updatedFromPort(["exe", "--updated", "5758"])).toBe(5758);
    expect(updatedFromPort(["exe"])).toBeNull();
  });
});
