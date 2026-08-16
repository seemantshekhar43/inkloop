import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveArtifactPath } from "../../src/shared/paths.js";

void test("resolves a relative path against the given cwd", () => {
  const result = resolveArtifactPath("artifact.html", "/home/user/project");
  assert.equal(result, path.resolve("/home/user/project", "artifact.html"));
});

void test("leaves an already-absolute path untouched", () => {
  const result = resolveArtifactPath("/tmp/artifact.html", "/home/user/project");
  assert.equal(result, path.resolve("/tmp/artifact.html"));
});

void test("normalizes '..' segments", () => {
  const result = resolveArtifactPath("../sibling/artifact.html", "/home/user/project");
  assert.equal(result, path.resolve("/home/user/sibling/artifact.html"));
});
