import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPIGRAPH_CUE_MS, TITLE_CUE_MS, scheduleHeroCues } from "../src/game/heroCues";

describe("scheduleHeroCues", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cues the title, then the epigraph, at the spec offsets", () => {
    const title = vi.fn();
    const epigraph = vi.fn();
    scheduleHeroCues(title, epigraph);
    vi.advanceTimersByTime(TITLE_CUE_MS - 1);
    expect(title).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(title).toHaveBeenCalledTimes(1);
    expect(epigraph).not.toHaveBeenCalled();
    vi.advanceTimersByTime(EPIGRAPH_CUE_MS - TITLE_CUE_MS);
    expect(epigraph).toHaveBeenCalledTimes(1);
  });

  it("orders title before epigraph", () => {
    expect(TITLE_CUE_MS).toBeLessThan(EPIGRAPH_CUE_MS);
  });

  it("cancel stops both pending cues", () => {
    const title = vi.fn();
    const epigraph = vi.fn();
    const cancel = scheduleHeroCues(title, epigraph);
    cancel();
    vi.advanceTimersByTime(EPIGRAPH_CUE_MS + 100);
    expect(title).not.toHaveBeenCalled();
    expect(epigraph).not.toHaveBeenCalled();
  });

  it("accepts injected timers", () => {
    const set = vi.fn(() => 42);
    const clear = vi.fn();
    const cancel = scheduleHeroCues(() => {}, () => {}, { set, clear });
    expect(set).toHaveBeenCalledTimes(2);
    expect((set.mock.calls as unknown as Array<[() => void, number]>).map((c) => c[1])).toEqual([TITLE_CUE_MS, EPIGRAPH_CUE_MS]);
    cancel();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
