// The public forecast (design 2026-09-09 §1.3). A weather line the forecast
// already clears by six degrees is not contested however the sentence reads,
// and a critic that has not seen the forecast cannot know that. One keyless
// GET pair per weather candidate against api.weather.gov, fetched here and
// shown to the critic beside the candidate. Fetch is injected so tests never
// touch the network; a failure leaves the index absent and the critic puts
// the candidate down rather than judging it blind.
import type { Candidate } from "../candidate";

export const FORECAST_TIMEOUT_MS = 5000;
export type ForecastsByIndex = Record<string, string>;

const HEADERS = { "user-agent": "oracle-pipeline (outseen)", accept: "application/geo+json" };

interface Period {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  probabilityOfPrecipitation?: { value: number | null };
}

function compact(periods: Period[]): string {
  return periods
    .slice(0, 6)
    .map((p) => {
      const pop = p.probabilityOfPrecipitation?.value;
      return `${p.name}: ${p.temperature}${p.temperatureUnit}, ${p.shortForecast}${typeof pop === "number" ? `, precip ${pop}%` : ""}`;
    })
    .join(" · ");
}

async function fetchForecast(fetchFn: typeof fetch, lat: number, lon: number): Promise<string> {
  const pointsRes = await fetchFn(`https://api.weather.gov/points/${lat},${lon}`, { headers: HEADERS, signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!pointsRes.ok) throw new Error(`points ${pointsRes.status}`);
  const points = (await pointsRes.json()) as { properties?: { forecast?: string } };
  const url = points.properties?.forecast;
  if (!url) throw new Error("no forecast url");
  // The points response names its own forecast URL; a compromised or
  // misbehaving upstream could point that field anywhere. Never fetch
  // off-host — the whole point of naming api.weather.gov as the source is
  // that it is the only place this data is allowed to come from.
  if (!url.startsWith("https://api.weather.gov/")) throw new Error("forecast url is not on api.weather.gov");
  const fRes = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!fRes.ok) throw new Error(`forecast ${fRes.status}`);
  const f = (await fRes.json()) as { properties?: { periods?: Period[] } };
  const periods = f.properties?.periods ?? [];
  if (periods.length === 0) throw new Error("no periods");
  return compact(periods);
}

export async function gatherForecasts(fetchFn: typeof fetch, candidates: Candidate[]): Promise<ForecastsByIndex> {
  const out: ForecastsByIndex = {};
  await Promise.all(
    candidates.map(async (c, i) => {
      if (c.category !== "weather" || !c.forecast_point) return;
      try {
        out[String(i)] = await fetchForecast(fetchFn, c.forecast_point.lat, c.forecast_point.lon);
      } catch {
        // Absent index = the critic rejects it. Never throw: one dead
        // forecast must not abort the night.
      }
    }),
  );
  return out;
}
