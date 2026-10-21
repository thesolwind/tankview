// Cost estimate: list prices per model, cache pricing, Haiku's long-prompt tier.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, cachedShare, fmtCost } from "../dist/model.js";

function agent(model, ...usages) {
  const a = new Agent("x");
  a.model = model;
  usages.forEach((u, i) => a.usage.set(`m${i}`, u));
  return a;
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("input, output and cache reads use each model's list price", () => {
  close(agent("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }).cost(), 4 + 20);
  close(agent("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 }).cost(), 0.2);
  close(agent("claude-opus-5", { cache_read_input_tokens: 1e6 }).cost(), 0.5); // default 0.1 × input
  close(agent("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 1e6 }).cost(), 0.005 + 0.5);
});

test("cache writes: 1.25x input for 5-minute entries, 2x for 1-hour entries", () => {
  close(agent("claude-opus-5-5", { cache_creation_input_tokens: 1e6 }).cost(), 5);
  close(agent("claude-opus-5-5", {
    cache_creation_input_tokens: 1e6,
    cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 },
  }).cost(), 8);
});

test("Haiku 5.5 prompts over 100k tokens use the higher tier", () => {
  close(agent("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 1e6 }).cost(), 0.1 + 2.5);
});

test("each message is priced with the model that produced it; unknown models give null", () => {
  const a = agent("claude-haiku-5-5", { input_tokens: 1e6 });
  a.usageModel.set("m0", "claude-opus-5-5");
  close(a.cost(), 4);
  assert.equal(agent("some-local-model", { input_tokens: 1e6 }).cost(), null);
  assert.equal(fmtCost(null), "≈ $?");
  assert.equal(fmtCost(0.004), "< $0.01");
  assert.equal(fmtCost(1.234), "≈ $1.23");
});

test("cached share", () => {
  assert.equal(cachedShare({ fresh: 10, cacheWrite: 10, cacheRead: 80, output: 5 }), 0.8);
  assert.equal(cachedShare({ fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0 }), 0);
});
