import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, readFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ArtifactWatcher,
  createArtifactWatcher,
  extractLocalSiblingAssets,
  waitForChange,
} from "../../src/server/watch-artifact.js";

async function tempArtifactDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "inkloop-watch-artifact-test-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void test("extractLocalSiblingAssets finds relative src/href references that exist on disk", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  await writeFile(path.join(dir, "style.css"), "body{}", "utf8");
  await writeFile(path.join(dir, "app.js"), "", "utf8");
  await writeFile(
    artifactPath,
    `<link rel="stylesheet" href="style.css"><script src="./app.js"></script>` +
      `<img src="missing.png">` +
      `<a href="https://example.com/x.css">external</a>` +
      `<script src="//example.com/y.js"></script>` +
      `<a href="#section">anchor</a>`,
    "utf8",
  );

  const html = await readFile(artifactPath, "utf8");
  const siblings = extractLocalSiblingAssets(html, artifactPath);
  assert.deepEqual(
    siblings.map((p) => path.basename(p)).sort(),
    ["app.js", "style.css"],
  );
});

void test("extractLocalSiblingAssets refuses to resolve outside the artifact's own directory", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "sub", "artifact.html");
  const html = `<script src="../../outside.js"></script>`;
  const siblings = extractLocalSiblingAssets(html, artifactPath);
  assert.deepEqual(siblings, []);
});

void test("ArtifactWatcher coalesces rapid successive writes into a single change event", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");

  const watcher = new ArtifactWatcher(artifactPath, []);
  try {
    let changeCount = 0;
    let lastVersion = 0;
    watcher.on("change", (version: number) => {
      changeCount += 1;
      lastVersion = version;
    });

    await writeFile(artifactPath, "<p>v2</p>", "utf8");
    await appendFile(artifactPath, "<p>v3</p>", "utf8");
    await appendFile(artifactPath, "<p>v4</p>", "utf8");

    await sleep(500);
    assert.equal(changeCount, 1);
    assert.equal(lastVersion, 1);
    assert.equal(watcher.getVersion(), 1);
  } finally {
    watcher.close();
  }
});

void test("waitForChange resolves immediately when already past sinceVersion, and on timeout otherwise", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");
  const watcher = new ArtifactWatcher(artifactPath, []);
  try {
    const start = Date.now();
    const timedOut = await waitForChange(watcher, 0, 150);
    assert.equal(timedOut, 0);
    assert.ok(Date.now() - start >= 150);

    await writeFile(artifactPath, "<p>v2</p>", "utf8");
    await sleep(300); // let the debounce fire so getVersion() is already 1
    const immediate = await waitForChange(watcher, 0, 1000);
    assert.equal(immediate, 1);
  } finally {
    watcher.close();
  }
});

void test("waitForChange resolves as soon as a change event fires, well before the timeout", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");
  const watcher = new ArtifactWatcher(artifactPath, []);
  try {
    setTimeout(() => {
      void writeFile(artifactPath, "<p>v2</p>", "utf8");
    }, 100);

    const start = Date.now();
    const version = await waitForChange(watcher, 0, 5000);
    assert.equal(version, 1);
    assert.ok(Date.now() - start < 5000);
  } finally {
    watcher.close();
  }
});

void test("ArtifactWatcher detects an atomic rename-over-replace, not just an in-place write", async () => {
  // Mirrors what many editors, formatters, and `sed -i` on macOS actually do for a "safe" save:
  // write to a temp file, then rename it over the target — which changes the inode rather than
  // writing through the original file handle. A watch tied to the original path/inode (rather
  // than its parent directory) can silently miss this. Regression test for that gap.
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  await writeFile(artifactPath, "<p>v1</p>", "utf8");

  const watcher = new ArtifactWatcher(artifactPath, []);
  try {
    const tmpPath = path.join(dir, "artifact.html.tmp");
    await writeFile(tmpPath, "<p>v2</p>", "utf8");
    await rename(tmpPath, artifactPath);

    // Event-driven wait (mirrors the in-place-write test above), not a fixed sleep-then-check —
    // a flat 500ms was flaky under load (a slow CI runner or, locally, other test files/builds
    // competing for CPU could all push the fs event past that fixed window). waitForChange
    // resolves the moment the 'change' event fires instead of racing the wall clock.
    const version = await waitForChange(watcher, 0, 5000);
    assert.equal(version, 1);
    assert.equal(await readFile(artifactPath, "utf8"), "<p>v2</p>");
  } finally {
    watcher.close();
  }
});

void test("createArtifactWatcher discovers and watches declared sibling assets", async () => {
  const dir = await tempArtifactDir();
  const artifactPath = path.join(dir, "artifact.html");
  const cssPath = path.join(dir, "style.css");
  await writeFile(cssPath, "body{}", "utf8");
  await writeFile(artifactPath, `<link rel="stylesheet" href="style.css">`, "utf8");

  const watcher = await createArtifactWatcher(artifactPath);
  try {
    let fired = false;
    watcher.on("change", () => {
      fired = true;
    });
    await writeFile(cssPath, "body{color:red}", "utf8");
    await sleep(500);
    assert.equal(fired, true);
  } finally {
    watcher.close();
  }
});
