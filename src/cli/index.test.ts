import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./index.js";

type WriteFn = typeof process.stdout.write;

function captureWrite(
  stream: NodeJS.WriteStream,
  fn: () => number,
): { code: number; text: string } {
  const original: WriteFn = stream.write.bind(stream);
  let text = "";
  stream.write = (chunk: Uint8Array | string) => {
    text += chunk.toString();
    return true;
  };
  try {
    const code = fn();
    return { code, text };
  } finally {
    stream.write = original;
  }
}

void test("--version prints the package version and exits 0", () => {
  const { code, text } = captureWrite(process.stdout, () => run(["--version"]));
  assert.equal(code, 0);
  assert.match(text.trim(), /^\d+\.\d+\.\d+$/);
});

void test("--help prints usage and exits 0", () => {
  const { code, text } = captureWrite(process.stdout, () => run(["--help"]));
  assert.equal(code, 0);
  assert.match(text, /Usage:/);
});

void test("no arguments prints usage and exits 1", () => {
  const { code, text } = captureWrite(process.stdout, () => run([]));
  assert.equal(code, 1);
  assert.match(text, /Usage:/);
});

void test("unrecognized command exits 1 and explains on stderr", () => {
  const { code, text } = captureWrite(process.stderr, () => run(["bogus"]));
  assert.equal(code, 1);
  assert.match(text, /unrecognized command/);
});
