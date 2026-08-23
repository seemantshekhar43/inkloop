import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainModuleEntry, run } from "../../src/cli/index.js";

// realpathSync the tmp dir itself first: on macOS, tmpdir() returns a path (/var/folders/...)
// that's itself a symlink to /private/var/folders/..., so a raw join() under it never
// string-equals its own realpath - mirroring how import.meta.url is already fully resolved in
// production, the "moduleRealPath" side of every case below must be a realpath too.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "inkloop-main-module-")));

void test("isMainModuleEntry: true when invoked directly by its own real path", () => {
  const real = join(dir, "direct.js");
  writeFileSync(real, "");
  assert.equal(isMainModuleEntry(real, real), true);
});

void test("isMainModuleEntry: true when invoked via a symlink to the real path", () => {
  const real = join(dir, "index.js");
  const link = join(dir, "inkloop");
  writeFileSync(real, "");
  symlinkSync(real, link);
  assert.equal(isMainModuleEntry(link, real), true);
});

void test("isMainModuleEntry: false for an unrelated file", () => {
  const real = join(dir, "index2.js");
  const other = join(dir, "other.js");
  writeFileSync(real, "");
  writeFileSync(other, "");
  assert.equal(isMainModuleEntry(other, real), false);
});

void test("isMainModuleEntry: falls back to string equality when the invoked path doesn't exist", () => {
  assert.equal(isMainModuleEntry("/no/such/path.js", "/no/such/path.js"), true);
  assert.equal(isMainModuleEntry("/no/such/path.js", "/other/path.js"), false);
});

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

void test("--version prints the package version and exits 0", async () => {
  const { code, text } = await captureWrite(process.stdout, () => run(["--version"]));
  assert.equal(code, 0);
  assert.match(text.trim(), /^\d+\.\d+\.\d+$/);
});

void test("--help prints usage and exits 0", async () => {
  const { code, text } = await captureWrite(process.stdout, () => run(["--help"]));
  assert.equal(code, 0);
  assert.match(text, /Usage:/);
});

void test("help prints usage and exits 0", async () => {
  const { code, text } = await captureWrite(process.stdout, () => run(["help"]));
  assert.equal(code, 0);
  assert.match(text, /Usage:/);
});

void test("no arguments prints usage and exits 1", async () => {
  const { code, text } = await captureWrite(process.stdout, () => run([]));
  assert.equal(code, 1);
  assert.match(text, /Usage:/);
});

void test("an unrecognized flag exits 1 and explains on stderr", async () => {
  const { code, text } = await captureWrite(process.stderr, () => run(["--bogus"]));
  assert.equal(code, 1);
  assert.match(text, /unrecognized flag/);
});

void test("poll without a file argument exits 1 and prints usage", async () => {
  const { code, text } = await captureWrite(process.stderr, () => run(["poll"]));
  assert.equal(code, 1);
  assert.match(text, /requires a file argument/);
});

void test("poll --agent-reply without a message exits 1", async () => {
  const { code, text } = await captureWrite(process.stderr, () =>
    run(["poll", "file.html", "--agent-reply"]),
  );
  assert.equal(code, 1);
  assert.match(text, /--agent-reply requires a message/);
});

void test("poll with no session for the file exits 1 (routing is covered end to end in commands/poll.test.ts)", async () => {
  const { code, text } = await captureWrite(process.stderr, () =>
    run(["poll", "/nonexistent/artifact.html"]),
  );
  assert.equal(code, 1);
  assert.match(text, /no session found/);
});

void test("end without a file argument exits 1 and prints usage", async () => {
  const { code, text } = await captureWrite(process.stderr, () => run(["end"]));
  assert.equal(code, 1);
  assert.match(text, /requires a file argument/);
});

void test("end with no session for the file exits 1 (routing is covered end to end in commands/end.test.ts)", async () => {
  const { code, text } = await captureWrite(process.stderr, () =>
    run(["end", "/nonexistent/artifact.html"]),
  );
  assert.equal(code, 1);
  assert.match(text, /no session found/);
});

void test("stop is routed to the stop command (routing is covered end to end in commands/stop.test.ts)", async () => {
  // A scratch port, not the real default — this only proves routing happens (the stop command's
  // own success/failure paths are unit-tested separately in commands/stop.test.ts), not that a
  // real server actually stops. Using a fixed port instead of the default avoids any flakiness
  // from a real inkloop server happening to already be up on this machine.
  const originalPort = process.env["INKLOOP_PORT"];
  process.env["INKLOOP_PORT"] = "44499";
  try {
    const { code, text } = await captureWrite(process.stdout, () => run(["stop"]));
    assert.equal(code, 0);
    assert.match(text, /no server running/);
  } finally {
    process.env["INKLOOP_PORT"] = originalPort;
  }
});

void test("stencil with no id is routed to the stencil command and lists ids", async () => {
  const { code, text } = await captureWrite(process.stdout, () => run(["stencil"]));
  assert.equal(code, 0);
  assert.match(text, /Available stencils/);
});

void test("stencil with an unknown id is routed to the stencil command and exits 1", async () => {
  const { code, text } = await captureWrite(process.stderr, () => run(["stencil", "nonexistent"]));
  assert.equal(code, 1);
  assert.match(text, /unknown stencil/);
});

void test("a bare non-flag argument is routed to the open command", async () => {
  // No such file exists — proves routing happens (open command's own errors are unit-tested
  // separately in commands/open.test.ts), not that opening succeeds.
  const { code, text } = await captureWrite(process.stderr, () =>
    run(["/nonexistent/artifact.html"]),
  );
  assert.equal(code, 1);
  assert.match(text, /file not found/);
});
