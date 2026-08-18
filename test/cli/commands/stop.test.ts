import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runStopCommand } from "../../../src/cli/commands/stop.js";
import { loadServerConfig } from "../../../src/server/config.js";
import { createInkloopServer, type InkloopServer } from "../../../src/server/create-server.js";

type WriteFn = typeof process.stdout.write;

async function captureWrite(
  stream: NodeJS.WriteStream,
  fn: () => Promise<number>,
): Promise<{ code: number; text: string }> {
  const original: WriteFn = stream.write.bind(stream);
  let text = "";
  stream.write = (chunk: Uint8Array | string) => {
    text += chunk.toString();
    return true;
  };
  try {
    const code = await fn();
    return { code, text };
  } finally {
    stream.write = original;
  }
}

/** Points loadServerConfig() at a scratch port for the duration of one test, restoring env after. */
async function withPort<T>(port: number, fn: () => Promise<T>): Promise<T> {
  const originalEnv = { ...process.env };
  process.env["INKLOOP_HOST"] = "127.0.0.1";
  process.env["INKLOOP_PORT"] = String(port);
  process.env["INKLOOP_IDLE_TIMEOUT_MS"] = "0";
  try {
    return await fn();
  } finally {
    process.env = originalEnv;
  }
}

void test("stop: reports no server running when nothing is listening", async () => {
  const port = 44500 + Math.floor(Math.random() * 400);
  await withPort(port, async () => {
    const { code, text } = await captureWrite(process.stdout, () => runStopCommand());
    assert.equal(code, 0);
    assert.match(text, /no server running/);
  });
});

void test("stop: shuts down a running server and reports success", async () => {
  const port = 44900 + Math.floor(Math.random() * 400);
  await withPort(port, async () => {
    const config = loadServerConfig();
    const instance: InkloopServer = createInkloopServer(config);
    await instance.listening;

    const { code, text } = await captureWrite(process.stdout, () => runStopCommand());
    assert.equal(code, 0);
    assert.match(text, /server stopped/);

    // Poll for the server actually going away rather than the http.Server "close" event
    // directly: that only fires once every open connection ends, and the socket that just
    // carried the stop request/response may still be lingering in Node's keep-alive pool.
    const deadline = Date.now() + 5000;
    for (;;) {
      const stillUp = await new Promise<boolean>((resolve) => {
        http.get(`http://127.0.0.1:${port}/health`, (res) => {
          res.resume();
          resolve(true);
        }).on("error", () => resolve(false));
      });
      if (!stillUp) break;
      if (Date.now() > deadline) throw new Error("server still accepting connections after 5s");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
});
