import { test } from "node:test";
import assert from "node:assert/strict";
import { runStencilCommand } from "../../../src/cli/commands/stencil.js";

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

void test("with no id, lists all stencil ids and exits 0", () => {
  const { code, text } = captureWrite(process.stdout, () => runStencilCommand());
  assert.equal(code, 0);
  for (const id of ["plan", "comparison", "table", "report", "mockup", "diagram", "loopable"]) {
    assert.match(text, new RegExp(id));
  }
});

void test("with a known id, expands its sections and exits 0", () => {
  const { code, text } = captureWrite(process.stdout, () => runStencilCommand("diagram"));
  assert.equal(code, 0);
  assert.match(text, /## fit/);
  assert.match(text, /## layout/);
  assert.match(text, /## rules/);
  assert.match(text, /## snags/);
  assert.match(text, /## loop_notes/);
  assert.match(text, /Mermaid/);
});

void test("every stencil id's output includes design_baseline (issue #89)", () => {
  for (const id of ["plan", "comparison", "table", "report", "mockup", "diagram", "loopable"]) {
    const { code, text } = captureWrite(process.stdout, () => runStencilCommand(id));
    assert.equal(code, 0, id);
    assert.match(text, /## design_baseline/, id);
    assert.match(text, /font_stack:/, id);
    assert.match(text, /spacing_scale:/, id);
    assert.match(text, /priority:/, id);
  }
});

void test("with an unknown id, exits 1 and lists known stencils on stderr", () => {
  const { code, text } = captureWrite(process.stderr, () => runStencilCommand("nonexistent"));
  assert.equal(code, 1);
  assert.match(text, /unknown stencil "nonexistent"/);
  assert.match(text, /plan/);
});
