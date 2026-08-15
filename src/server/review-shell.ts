/**
 * Placeholder review-page shell. This exists only so issue #4's vertical slice (open a session,
 * serve the artifact, print a working URL) is real and testable end to end. The actual review UI
 * — annotation composer, queue panel, and the novel visual identity required by AGENTS.md — is
 * issue #6 and will replace this entirely.
 */
export function renderReviewShell(hash: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkloop review</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<iframe src="/session/${hash}/artifact" title="artifact preview"></iframe>
</body>
</html>
`;
}
