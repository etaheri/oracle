import { CONSTANTS as C } from "./constants";

export interface ForecastInput { pYes: number; oracleScore: number | null; }

export function extremize(p: number, d: number): number {
  const num = p ** d;
  return num / (num + (1 - p) ** d);
}

export function oracleForecast(predictions: ForecastInput[], ratedPlayerCount: number): number | null {
  if (predictions.length === 0) return null;
  if (ratedPlayerCount < C.FORECAST_MIN_RATED) {
    return predictions.reduce((a, x) => a + x.pYes, 0) / predictions.length;
  }
  let wSum = 0;
  let wpSum = 0;
  for (const { pYes, oracleScore } of predictions) {
    const w = oracleScore === null
      ? 1
      : Math.exp((oracleScore - C.FORECAST_WEIGHT_PIVOT) / C.FORECAST_WEIGHT_SCALE);
    wSum += w;
    wpSum += w * pYes;
  }
  return extremize(wpSum / wSum, C.FORECAST_EXTREMIZE_D);
}
