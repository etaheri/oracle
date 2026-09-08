import { describe, expect, it } from "vitest";
import { crowdAnticipation } from "../src/game/crowdAnticipation";

describe("crowdAnticipation", () => {
  it("counts only sealed calls with a readable crowd leaning the other way", () => {
    const calls = [
      { questionId: "a", answer: true, sealed: true },
      { questionId: "b", answer: false, sealed: true },
      { questionId: "c", answer: true, sealed: false },
      { questionId: "d", answer: true, sealed: true },
    ];
    const crowd = [
      { id: "a", crowd_yes_pct: 40, player_count: 8 },
      { id: "b", crowd_yes_pct: 60, player_count: 12 },
      { id: "c", crowd_yes_pct: 10, player_count: 30 },
    ];
    expect(crowdAnticipation(calls, crowd)).toBe("The crowd currently leans the other way on 2 of your calls.");
  });

  it("keeps exact splits, tiny crowds, and missing data neutral", () => {
    const calls = [{ questionId: "a", answer: true, sealed: true }];
    expect(crowdAnticipation(calls, [{ id: "a", crowd_yes_pct: 50, player_count: 50 }])).toBeNull();
    expect(crowdAnticipation(calls, [{ id: "a", crowd_yes_pct: 0, player_count: 4 }])).toBeNull();
    expect(crowdAnticipation(calls, [])).toBeNull();
  });

  it("does not require the contrarian-bounty floor to report disagreement", () => {
    expect(crowdAnticipation(
      [{ questionId: "a", answer: true, sealed: true }],
      [{ id: "a", crowd_yes_pct: 40, player_count: 5 }],
    )).toBe("The crowd currently leans the other way on 1 of your calls.");
  });
});
