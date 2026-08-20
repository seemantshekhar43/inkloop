import { getStencil, listStencils } from "../../shared/stencils.js";

/**
 * Implements `inkloop stencil` / `inkloop stencil <id>` (issue #86, follow-up to #68): static,
 * built-in content-guidance for authoring inkloop artifacts well. Not a review-loop mechanic -
 * no server/session involvement, purely reads from shared/stencils.ts's data.
 *
 * Output is plain text (not JSON): this command's payload is prose meant to be read/absorbed as
 * guidance rather than parsed as structured status, unlike poll/end's stdout-is-structured-output
 * convention. The exact shape is deliberately left simple for now - issue #86's sequencing note
 * flags that the final agent-facing output format should be decided together with #15
 * (token-optimized agent-facing output), not locked in here.
 */
export function runStencilCommand(id?: string): number {
  if (id === undefined) {
    const lines = ["Available stencils:", ""];
    for (const stencil of listStencils()) {
      lines.push(`  ${stencil.id.padEnd(12)} ${stencil.title}`);
    }
    lines.push("", "Run `inkloop stencil <id>` to expand one.");
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  const stencil = getStencil(id);
  if (!stencil) {
    const known = listStencils()
      .map((s) => s.id)
      .join(", ");
    process.stderr.write(`inkloop: unknown stencil "${id}" - known stencils: ${known}\n`);
    return 1;
  }

  const lines = [
    `# ${stencil.title} (${stencil.id})`,
    "",
    "## fit",
    stencil.fit,
    "",
    "## layout",
    stencil.layout,
    "",
    "## rules",
    ...stencil.rules.map((r) => `- ${r}`),
    "",
    "## snags",
    ...stencil.snags.map((s) => `- ${s}`),
    "",
    "## loop_notes",
    ...stencil.loop_notes.map((n) => `- ${n}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
