import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./index.js";

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

void test("end is recognized but reports not-yet-implemented with a tracking link", async () => {
  const { code, text } = await captureWrite(process.stderr, () => run(["end", "file.html"]));
  assert.equal(code, 1);
  assert.match(text, /not implemented yet/);
  assert.match(text, /issues\/9/);
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
