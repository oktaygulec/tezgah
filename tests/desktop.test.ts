import { expect, test } from "bun:test";
import { createLifetime } from "../src/server/desktop";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("stops when no window connects", async () => {
  let stopped = 0;
  createLifetime(() => stopped++, { firstWindowMs: 20, lastWindowMs: 10, enabled: true });
  await wait(40);
  expect(stopped).toBe(1);
});

test("a reload does not stop the program; closing the last window does", async () => {
  let stopped = 0;
  const life = createLifetime(() => stopped++, { firstWindowMs: 20, lastWindowMs: 30, enabled: true });
  life.websocket.open();
  life.websocket.open(); // second window
  await wait(40);
  life.websocket.close();
  expect(life.windows).toBe(1);
  await wait(40);
  expect(stopped).toBe(0);
  life.websocket.close(); // reload: close, then open again at once
  life.websocket.open();
  await wait(40);
  expect(stopped).toBe(0);
  life.websocket.close();
  await wait(50);
  expect(stopped).toBe(1);
});

test("keeps running when turned off", async () => {
  let stopped = 0;
  const life = createLifetime(() => stopped++, { firstWindowMs: 10, lastWindowMs: 10, enabled: false });
  life.websocket.open();
  life.websocket.close();
  await wait(30);
  expect(stopped).toBe(0);
});
