import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callWithRetryOn503,
  is503Error,
  GEMINI_503_RETRY_DELAYS_MS,
} from "@/lib/services/gemini-label-extraction.service";

describe("is503Error", () => {
  it("returns true for status=503", () => {
    expect(is503Error({ status: 503 })).toBe(true);
  });

  it("returns true when message contains 503 token", () => {
    expect(is503Error(new Error("Got 503 from upstream"))).toBe(true);
  });

  it("returns false for status=500", () => {
    expect(is503Error({ status: 500 })).toBe(false);
  });

  it("returns false for null/undefined/non-objects", () => {
    expect(is503Error(null)).toBe(false);
    expect(is503Error(undefined)).toBe(false);
    expect(is503Error("string")).toBe(false);
    expect(is503Error(42)).toBe(false);
  });
});

describe("callWithRetryOn503", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("succeeds_first_try — no retry, no waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await callWithRetryOn503(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds_after_1_retry — one 503 then resolve", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    const promise = callWithRetryOn503(fn);
    // Advance through the first retry delay.
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[0]);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("succeeds_after_2_retries — two 503s then resolve", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    const promise = callWithRetryOn503(fn);
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[0]);
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[1]);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails_after_exhaustion — three 503s throws the third", async () => {
    const lastError = { status: 503, message: "third 503" };
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce(lastError);
    const promise = callWithRetryOn503(fn).catch((e) => e);
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[0]);
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[1]);
    const caught = await promise;
    expect(caught).toBe(lastError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does_not_retry_non_503 — 500 throws immediately", async () => {
    const fiveHundred = { status: 500 };
    const fn = vi.fn().mockRejectedValueOnce(fiveHundred);
    const caught = await callWithRetryOn503(fn).catch((e) => e);
    expect(caught).toBe(fiveHundred);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("detects_503_in_message_text — Error message containing 503 retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Service Unavailable: 503"))
      .mockResolvedValueOnce("recovered");
    const promise = callWithRetryOn503(fn);
    await vi.advanceTimersByTimeAsync(GEMINI_503_RETRY_DELAYS_MS[0]);
    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
