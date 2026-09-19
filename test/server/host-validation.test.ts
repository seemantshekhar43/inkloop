import { test } from "node:test";
import assert from "node:assert/strict";
import { isHostAllowed } from "../../src/server/host-validation.js";

const baseConfig = { host: "127.0.0.1", allowedHosts: [] as string[] };

void test("accepts loopback names with and without a port", () => {
  assert.equal(isHostAllowed("127.0.0.1", baseConfig), true);
  assert.equal(isHostAllowed("127.0.0.1:4879", baseConfig), true);
  assert.equal(isHostAllowed("localhost:4879", baseConfig), true);
  assert.equal(isHostAllowed("[::1]:4879", baseConfig), true);
});

void test("accepts the configured bind address", () => {
  assert.equal(isHostAllowed("192.168.1.5:4879", { host: "192.168.1.5", allowedHosts: [] }), true);
});

void test("accepts explicitly allowed hosts, case-insensitively", () => {
  const config = { host: "127.0.0.1", allowedHosts: ["review.example.com"] };
  assert.equal(isHostAllowed("review.example.com:4879", config), true);
  assert.equal(isHostAllowed("REVIEW.EXAMPLE.COM", config), true);
});

void test("'*' allowed-hosts disables validation entirely", () => {
  const config = { host: "127.0.0.1", allowedHosts: "*" as const };
  assert.equal(isHostAllowed("anything.attacker.example", config), true);
});

void test("rejects a missing or empty Host header", () => {
  assert.equal(isHostAllowed(undefined, baseConfig), false);
  assert.equal(isHostAllowed("", baseConfig), false);
  assert.equal(isHostAllowed("   ", baseConfig), false);
});

void test("rejects an attacker-controlled hostname (DNS rebinding)", () => {
  assert.equal(isHostAllowed("attacker.example:4879", baseConfig), false);
  assert.equal(isHostAllowed("127.0.0.1.attacker.example", baseConfig), false);
});

void test("rejects a hostname not in the explicit allow list", () => {
  const config = { host: "127.0.0.1", allowedHosts: ["review.example.com"] };
  assert.equal(isHostAllowed("other.example.com", config), false);
});

void test("does not mis-truncate a bare (unbracketed) non-loopback IPv6 literal as if it had a port", () => {
  // Multiple colons with no brackets is ambiguous/malformed as a Host header; treat the whole
  // value as the hostname rather than guessing where a port might be. A naive last-colon split
  // would truncate "2001:db8::1" to "2001:db8::" and could accidentally match something in the
  // allow list; keeping it intact means it correctly matches nothing and is rejected.
  const config = { host: "127.0.0.1", allowedHosts: [] as string[] };
  assert.equal(isHostAllowed("2001:db8::1", config), false);
});

void test("accepts a bare (unbracketed) loopback IPv6 literal", () => {
  assert.equal(isHostAllowed("::1", baseConfig), true);
});
