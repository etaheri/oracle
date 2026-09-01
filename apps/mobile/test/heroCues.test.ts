import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBTITLE_CUE_MS, TITLE_CUE_MS, scheduleHeroCues } from "../src/game/heroCues";

describe("scheduleHeroCues", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cues the title, then the subtitle, at the spec offsets", () => {
    const title = vi.fn();
    const subtitle = vi.fn();
    scheduleHeroCues(title, subtitle);
    vi.advanceTimersByTime(TITLE_CUE_MS - 1);
    expect(title).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(title).toHaveBeenCalledTimes(1);
    expect(subtitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SUBTITLE_CUE_MS - TITLE_CUE_MS);
    expect(subtitle).toHaveBeenCalledTimes(1);
  });

  it("orders title before subtitle", () => {
    expect(TITLE_CUE_MS).toBeLessThan(SUBTITLE_CUE_MS);
  });

  it("cancel stops both pending cues", () => {
    const title = vi.fn();
    const subtitle = vi.fn();
    const cancel = scheduleHeroCues(title, subtitle);
    cancel();
    vi.advanceTimersByTime(SUBTITLE_CUE_MS + 100);
    expect(title).not.toHaveBeenCalled();
    expect(subtitle).not.toHaveBeenCalled();
  });

  it("accepts injected timers", () => {
    const set = vi.fn(() => 42);
    const clear = vi.fn();
    const cancel = scheduleHeroCues(() => {}, () => {}, { set, clear });
    expect(set).toHaveBeenCalledTimes(2);
    expect((set.mock.calls as unknown as Array<[() => void, number]>).map((c) => c[1])).toEqual([TITLE_CUE_MS, SUBTITLE_CUE_MS]);
    cancel();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
