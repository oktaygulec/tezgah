import { describe, expect, test } from "bun:test";
import { buildTspl, bytesPerRow, packMonochrome } from "../src/shared/tspl";

/** RGBA pixels from rows of "#" (black) and "." (white). */
function image(rows: string[]): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = rows[0]!.length;
  const rgba = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const v = ch === "#" ? 0 : 255;
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }),
  );
  return { rgba, width, height: rows.length };
}

describe("packMonochrome", () => {
  test("black pixels are 0 bits, white pixels are 1 bits, MSB first", () => {
    const { rgba, width, height } = image(["#.......", "........", "#######."]);
    expect([...packMonochrome(rgba, width, height)]).toEqual([0b01111111, 0xff, 0b00000001]);
  });

  test("rows are padded to whole bytes with white", () => {
    const { rgba, width, height } = image(["##########", ".........#"]); // 10 dots wide
    expect(bytesPerRow(10)).toBe(2);
    expect([...packMonochrome(rgba, width, height)]).toEqual([0x00, 0b00111111, 0xff, 0b10111111]);
  });

  test("grey and transparent pixels", () => {
    const rgba = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 0]);
    // dark grey -> black; light grey -> white; transparent black -> white paper
    expect([...packMonochrome(rgba, 3, 1)]).toEqual([0b01111111]);
  });

  test("rejects a wrong buffer size", () => {
    expect(() => packMonochrome(new Uint8ClampedArray(8), 3, 1)).toThrow();
  });
});

describe("buildTspl", () => {
  const settings = { widthMm: 60, heightMm: 30, gapMm: 2, density: 8, speed: 4, rotate180: false };

  test("setup once, then CLS / BITMAP / PRINT for each label", () => {
    const a = { bitmap: new Uint8Array([1, 2]), width: 16, height: 1, copies: 3 };
    const b = { bitmap: new Uint8Array([9]), width: 8, height: 1, copies: 1 };
    const out = buildTspl(settings, [a, b]);
    const text = new TextDecoder("latin1").decode(out);
    expect(text).toBe(
      "SIZE 60 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\nSPEED 4\r\nDENSITY 8\r\nSET TEAR ON\r\n" +
        "CLS\r\nBITMAP 0,0,2,1,0,\x01\x02\r\nPRINT 1,3\r\n" +
        "CLS\r\nBITMAP 0,0,1,1,0,\x09\r\nPRINT 1,1\r\n",
    );
  });

  test("rotate180 flips the direction", () => {
    const text = new TextDecoder().decode(buildTspl({ ...settings, rotate180: true }, []));
    expect(text).toContain("DIRECTION 0,0");
  });

  test("rejects a bitmap of the wrong size", () => {
    expect(() => buildTspl(settings, [{ bitmap: new Uint8Array(3), width: 16, height: 1, copies: 1 }])).toThrow("hatalı");
  });
});
