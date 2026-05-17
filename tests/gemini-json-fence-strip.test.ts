import { describe, it, expect } from "vitest";

import { stripJsonFences } from "@/lib/services/gemini-label-extraction.service";

describe("stripJsonFences", () => {
  it("returns plain JSON unchanged", () => {
    const input = '{"a":1}';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it("trims surrounding whitespace on plain JSON", () => {
    expect(stripJsonFences('\n  {"a":1}\n  ')).toBe('{"a":1}');
  });

  it("strips ```json ... ``` fences", () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it("strips bare ``` ... ``` fences", () => {
    const input = '```\n{"a":1}\n```';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it("preserves a top-level array body when fenced", () => {
    const input = '```json\n[{"a":1}]\n```';
    expect(stripJsonFences(input)).toBe('[{"a":1}]');
  });

  it("does not strip when fences are unbalanced", () => {
    const input = '```json\n{"a":1}';
    expect(stripJsonFences(input)).toBe('```json\n{"a":1}');
  });
});
