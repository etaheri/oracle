import { describe, expect, it } from "vitest";
import { gatherForecasts } from "../src/pipeline/gauntlet/forecast";
import type { Candidate } from "../src/pipeline/candidate";

const weather = (o: Partial<Candidate> = {}): Candidate => ({
  category: "weather", text: "Will Central Park reach 80F Thursday?", resolution_criteria: "NWS daily climate report",
  source_name: "NWS", source_url: "https://www.weather.gov/", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-11T00:00:00Z", topic_key: "nyc-high", forecast_point: { lat: 40.78, lon: -73.97 }, ...o,
});
const news = (): Candidate => ({ ...weather(), category: "news", forecast_point: null, topic_key: "news-1" });

const points = { properties: { forecast: "https://api.weather.gov/gridpoints/OKX/33,37/forecast" } };
const forecast = { properties: { periods: [
  { name: "Thursday", temperature: 86, temperatureUnit: "F", shortForecast: "Partly sunny", probabilityOfPrecipitation: { value: 20 } },
  { name: "Thursday Night", temperature: 70, temperatureUnit: "F", shortForecast: "Clear", probabilityOfPrecipitation: { value: null } },
] } };

function fakeFetch(map: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(map).find(([k]) => url.startsWith(k));
    if (!hit) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("gatherForecasts (design 2026-09-09 §1.3)", () => {
  it("fetches points then forecast for a weather candidate and returns compact text keyed by index", async () => {
    const calls: string[] = [];
    const f = fakeFetch({ "https://api.weather.gov/points/40.78,-73.97": points, "https://api.weather.gov/gridpoints/OKX/33,37/forecast": forecast }, calls);
    const out = await gatherForecasts(f, [news(), weather()]);
    expect(Object.keys(out)).toEqual(["1"]);
    expect(out["1"]).toContain("Thursday: 86F, Partly sunny, precip 20%");
    expect(out["1"]).toContain("Thursday Night: 70F, Clear");
    expect(calls[0]).toContain("/points/40.78,-73.97");
  });
  it("sends a User-Agent, which api.weather.gov requires", async () => {
    let ua: string | null = null;
    const f = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify(points), { status: 200 });
    }) as typeof fetch;
    await gatherForecasts(f, [weather()]).catch(() => {});
    expect(ua).toContain("oracle");
  });
  it("leaves the index absent when the fetch fails, and never throws", async () => {
    const out = await gatherForecasts(fakeFetch({}), [weather()]);
    expect(out).toEqual({});
  });
  it("skips non-weather candidates entirely", async () => {
    const calls: string[] = [];
    await gatherForecasts(fakeFetch({}, calls), [news()]);
    expect(calls).toHaveLength(0);
  });
});
