import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { IDLE_TIMEOUT_MS, useIdleDisconnect } from "./useIdleDisconnect";

describe("useIdleDisconnect", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onIdle after the timeout when enabled and not busy", () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleDisconnect({
        enabled: true,
        busy: false,
        onIdle,
        timeoutMs: 1000,
      }),
    );
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not arm while disabled", () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleDisconnect({
        enabled: false,
        busy: false,
        onIdle,
        timeoutMs: 1000,
      }),
    );
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("resets the timer on user activity", () => {
    const onIdle = vi.fn();
    renderHook(() =>
      useIdleDisconnect({
        enabled: true,
        busy: false,
        onIdle,
        timeoutMs: 1000,
      }),
    );
    vi.advanceTimersByTime(800);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(800); // 1600 total, but only 800 since activity
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("re-arms instead of firing while busy, then fires once idle clears", () => {
    const onIdle = vi.fn();
    let busy = true;
    const { rerender } = renderHook(
      ({ busy }) =>
        useIdleDisconnect({ enabled: true, busy, onIdle, timeoutMs: 1000 }),
      { initialProps: { busy } },
    );
    // First window elapses while busy → re-armed, no fire.
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
    // Download finishes; the busy ref is read at the next window's expiry.
    busy = false;
    rerender({ busy });
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("clears the timer on unmount", () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() =>
      useIdleDisconnect({
        enabled: true,
        busy: false,
        onIdle,
        timeoutMs: 1000,
      }),
    );
    unmount();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("defaults to a 15-minute window", () => {
    expect(IDLE_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
