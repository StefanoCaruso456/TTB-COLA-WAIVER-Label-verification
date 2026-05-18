import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callWithRetryOn503,
  isRetryableError,
  is503Error,
  GEMINI_RETRY_BASE_DELAYS_MS,
  GEMINI_503_RETRY_DELAYS_MS,
} from "@/lib/services/gemini-label-extraction.service";

// Jitter is ±20%, so we advance by base * 1.2 (with a 1ms slack) to guarantee
// the setTimeout fires regardless of Math.random()'s outcome.
const MAX_JITTER_FACTOR = 1.2;
function maxDelayFor(baseMs: number): number {
  return Math.ceil(baseMs * MAX_JITTER_FACTOR) + 1;
}

describe("isRetryableError", () => {
  it("returns true for status=503", () => {
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it("returns true for status=429 (rate limit)", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it("returns true when message mentions 503", () => {
    expect(isRetryableError(new Error("Got 503 from upstream"))).toBe(true);
  });

  it("returns true when message mentions 429", () => {
    expect(isRetryableError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });

  it("returns true when message mentions RESOURCE_EXHAUSTED", () => {
    expect(
      isRetryableError(new Error("[google] RESOURCE_EXHAUSTED quota")),
    ).toBe(true);
  });

  it("returns true when message mentions 'rate limit'", () => {
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("returns false for status=500", () => {
    expect(isRetryableError({ status: 500 })).toBe(false);
  });

  it("returns false for null/undefined/non-objects", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });

  it("is503Error is a back-compat alias for isRetryableError", () => {
    expect(is503Error({ status: 503 })).toBe(true);
    expect(is503Error({ status: 429 })).toBe(true);
    expect(is503Error({ status: 500 })).toBe(false);
  });
});

describe("GEMINI_RETRY_BASE_DELAYS_MS", () => {
  it("schedule is exponential with the documented bases", () => {
    expect([...GEMINI_RETRY_BASE_DELAYS_MS]).toEqual([1000, 2000, 4000, 8000]);
  });

  it("legacy GEMINI_503_RETRY_DELAYS_MS export still points at the same array", () => {
    expect(GEMINI_503_RETRY_DELAYS_MS).toBe(GEMINI_RETRY_BASE_DELAYS_MS);
  });
});

describe("callWithRetryOn503 (exponential backoff with jitter)", () => {
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
    await vi.advanceTimersByTimeAsync(maxDelayFor(GEMINI_RETRY_BASE_DELAYS_MS[0]));
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries_429_same_as_503 — 429 also triggers backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: "Too Many Requests" })
      .mockResolvedValueOnce("recovered");
    const promise = callWithRetryOn503(fn);
    await vi.advanceTimersByTimeAsync(maxDelayFor(GEMINI_RETRY_BASE_DELAYS_MS[0]));
    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("succeeds_after_2_retries — two 503s then resolve", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    const promise = callWithRetryOn503(fn);
    await vi.advanceTimersByTimeAsync(maxDelayFor(GEMINI_RETRY_BASE_DELAYS_MS[0]));
    await vi.advanceTimersByTimeAsync(maxDelayFor(GEMINI_RETRY_BASE_DELAYS_MS[1]));
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails_after_exhaustion — five 503s throws the fifth (4 retries)", async () => {
    const lastError = { status: 503, message: "fifth 503" };
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce(lastError);
    const promise = callWithRetryOn503(fn).catch((e) => e);
    for (const base of GEMINI_RETRY_BASE_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(maxDelayFor(base));
    }
    const caught = await promise;
    expect(caught).toBe(lastError);
    expect(fn).toHaveBeenCalledTimes(GEMINI_RETRY_BASE_DELAYS_MS.length + 1);
  });

  it("does_not_retry_non_retryable — 500 throws immediately", async () => {
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
    await vi.advanceTimersByTimeAsync(maxDelayFor(GEMINI_RETRY_BASE_DELAYS_MS[0]));
    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("jitter_stays_within_bounds — pinning Math.random doesn't drop delay below base*0.8", async () => {
    // Math.random()=0 → offset = (0*2-1)*spread = -spread, so delay = base*0.8.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ok");
    const promise = callWithRetryOn503(fn);
    // Advancing by exactly base*0.8 should be enough to trip the timer.
    await vi.advanceTimersByTimeAsync(
      Math.ceil(GEMINI_RETRY_BASE_DELAYS_MS[0] * 0.8) + 1,
    );
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    randomSpy.mockRestore();
  });
});
