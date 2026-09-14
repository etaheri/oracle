import { describe, it, expect } from "vitest";
import type { Reveal, CouncilEntry, EvidenceItem } from "@oracle/core";
import { councilFor, splitRows, readingFor, evidenceFor, memberName } from "../src/game/council";

const QID = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const entry = (over: Partial<CouncilEntry>): CouncilEntry => ({ question_id: QID, member: "sonnet", p_yes: 0.4, on_right_side: true, reasoning: "Because the forecast ran warm.", cited: [1, 3], lessons_received: 0, ...over });
const item = (rank: number): EvidenceItem => ({ question_id: QID, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", published_at: "2026-09-09T00:00:00.000Z", highlight: `H${rank}.` });
const reveal = (council: CouncilEntry[], evidence: EvidenceItem[] = []): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
  delta: 0, return: 0, fortune_after: 1000, house_delta: 0, council, evidence,
  questions: [{ id: QID, slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 30, market_prob: 0.4, line_p_yes: 0.35, my: null, source_name: "Kalshi", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: 0.35 }],
  ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null },
});

describe("the Council split (spec §15.2)", () => {
  it("orders the entries and prints one row per member then the house line", () => {
    const d = reveal([entry({ member: "market", p_yes: 0.4, on_right_side: false, reasoning: null, cited: [] }), entry({ member: "haiku", p_yes: 0.44 }), entry({ member: "sonnet", p_yes: 0.40, on_right_side: false })]);
    const rows = splitRows(councilFor(d, QID), 0.35);
    expect(rows.map((r) => r.label)).toEqual(["SONNET 40", "HAIKU 44", "MARKET 40", "THE ORACLE'S LINE 35"]);
    expect(rows.map((r) => r.tone)).toEqual(["loss", "win", "loss", "mute"]);
  });
  it("is empty with no entries, so the slot keeps no height", () => {
    expect(splitRows([], 0.35)).toEqual([]);
    expect(splitRows(councilFor(reveal([]), QID), 0.35)).toEqual([]);
  });
  it("mutes an undecided or 0.5 member and omits the house line row when there is none", () => {
    const rows = splitRows([entry({ on_right_side: null })], null);
    expect(rows).toEqual([{ member: "sonnet", label: "SONNET 40", tone: "mute" }]);
  });
});

describe("the reading (spec §15.3)", () => {
  it("pairs the paragraph with cited items in rank order and lists the rest under also read", () => {
    const pack = [item(1), item(2), item(3)];
    const r = readingFor(entry({ cited: [3, 1] }), pack)!;
    expect(r.paragraph).toBe("Because the forecast ran warm.");
    expect(r.cited.map((i) => i.rank)).toEqual([1, 3]);
    expect(r.alsoRead.map((i) => i.rank)).toEqual([2]);
  });
  it("is null for the market member and for an empty paragraph", () => {
    expect(readingFor(entry({ member: "market", reasoning: null }), [])).toBeNull();
    expect(readingFor(entry({ reasoning: "  " }), [])).toBeNull();
  });
  it("finds a question's pack in rank order", () => {
    const d = reveal([], [item(2), item(1)]);
    expect(evidenceFor(d, QID).map((i) => i.rank)).toEqual([1, 2]);
  });
  it("names the members for the surface", () => {
    expect(["sonnet", "opus", "haiku", "market"].map((m) => memberName(m as CouncilEntry["member"]))).toEqual(["Sonnet", "Opus", "Haiku", "the market"]);
  });
});
