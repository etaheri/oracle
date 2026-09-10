#!/usr/bin/env python3
"""Re-record the exchange list fixtures from the live APIs.

Run it, do not hand-edit the JSON:

    python3 apps/api/test/fixtures/exchanges/record.py

It rewrites four files in this directory:

  kalshi-markets-page1.json   40 priced non-exotic rows + 3 exotic rows, cursor "PAGE2"
  kalshi-markets-page2.json   5 rows repeated from page 1, empty cursor
  polymarket-markets-page1.json  40 events, each trimmed to the keys the feed reads
  polymarket-markets-page2.json  []

The single-market fixtures (kalshi-market-*.json, polymarket-market-*.json,
kalshi-event.json) are settlement cases chosen by hand and are NOT touched.

The recorded pages must still deal a round: exchanges-fixture-round.test.ts
runs both through the real feeds and asserts selectFive finds five markets
across four categories. If a re-record breaks that test, the fixtures are the
problem — widen the window below rather than weakening the assertion.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (oracle-pipeline)", "Accept": "application/json"}

# The recording window, matching the pipeline's own: a round locks at noon and
# its markets close between two and thirty hours later. Recording out to +48h
# leaves the fixture-round test room to place its lock.
NOW = datetime.now(timezone.utc)
FROM = NOW + timedelta(hours=2)
TO = NOW + timedelta(hours=48)

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
POLY = "https://gamma-api.polymarket.com"

KALSHI_KEYS = [
    "ticker", "event_ticker", "status", "result", "close_time", "expiration_time",
    "settlement_ts", "title", "yes_sub_title", "rules_primary", "yes_bid_dollars",
    "yes_ask_dollars", "last_price_dollars", "liquidity_dollars", "volume_fp",
    "market_type", "mve_collection_ticker",
]
# GET /events gives the event its tags; GET /markets does not. That is the
# whole reason the Polymarket feed lists events.
POLY_EVENT_KEYS = ["id", "slug", "title", "tags", "endDate", "volume", "markets"]
POLY_MARKET_KEYS = [
    "id", "question", "description", "outcomes", "outcomePrices", "endDate",
    "volumeNum", "volume", "closed", "slug",
]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def trim(row, keys):
    return {k: row[k] for k in keys if k in row}


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def priced(m):
    """The same guard toCandidate applies: binary, two-sided, not an exotic."""
    if m.get("mve_collection_ticker") or m.get("ticker", "").startswith("KXMVE"):
        return False
    if m.get("market_type") and m["market_type"] != "binary":
        return False
    try:
        return float(m.get("yes_bid_dollars") or 0) > 0 and float(m.get("yes_ask_dollars") or 0) > 0
    except (TypeError, ValueError):
        return False


def exotic(m):
    return bool(m.get("mve_collection_ticker")) or m.get("ticker", "").startswith("KXMVE")


def volume(m):
    try:
        return float(m.get("volume_fp") or 0)
    except (TypeError, ValueError):
        return 0.0


def record_kalshi():
    min_ts = int(FROM.timestamp())
    max_ts = int(TO.timestamp())
    rows, cursor = [], ""
    for _ in range(15):
        url = (f"{KALSHI}/markets?status=open&limit=1000"
               f"&min_close_ts={min_ts}&max_close_ts={max_ts}"
               + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
        body = get(url)
        rows.extend(body.get("markets") or [])
        cursor = body.get("cursor") or ""
        if not cursor:
            break
        time.sleep(0.2)

    keep = sorted([m for m in rows if priced(m)], key=volume, reverse=True)[:40]
    exotics = [m for m in rows if exotic(m)][:3]
    page1 = {"markets": [trim(m, KALSHI_KEYS) for m in keep + exotics], "cursor": "PAGE2"}
    page2 = {"markets": [trim(m, KALSHI_KEYS) for m in keep[:5]], "cursor": ""}
    write("kalshi-markets-page1.json", page1)
    write("kalshi-markets-page2.json", page2)
    print(f"kalshi: {len(rows)} rows fetched, {len(keep)} priced kept, {len(exotics)} exotic, "
          f"page2 repeats {len(page2['markets'])}")
    return keep


def record_polymarket():
    url = (f"{POLY}/events?closed=false&active=true&volume_min=5000"
           f"&end_date_min={iso(FROM)}&end_date_max={iso(TO)}&limit=100&offset=0")
    events = get(url)
    page1 = []
    for ev in events[:40]:
        e = trim(ev, POLY_EVENT_KEYS)
        e["tags"] = [{"slug": t.get("slug"), "label": t.get("label")} for t in (ev.get("tags") or [])]
        e["markets"] = [trim(m, POLY_MARKET_KEYS) for m in (ev.get("markets") or [])]
        page1.append(e)
    write("polymarket-markets-page1.json", page1)
    write("polymarket-markets-page2.json", [])
    nested = sum(len(e["markets"]) for e in page1)
    print(f"polymarket: {len(events)} events fetched, {len(page1)} kept, {nested} nested markets")
    return page1


def write(name, body):
    with open(os.path.join(HERE, name), "w") as f:
        json.dump(body, f, indent=1)
        f.write("\n")


def report(kalshi_rows, poly_events):
    """The count that matters: how many categories the pooled pages can span."""
    counts = {}
    for ev in poly_events:
        slugs = [t.get("slug") or "" for t in ev.get("tags") or []]
        counts[slugs[0] if slugs else "(untagged)"] = counts.get(slugs[0] if slugs else "(untagged)", 0) + 1
    print("polymarket first-tag counts:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
    series = {}
    for m in kalshi_rows:
        s = m["event_ticker"].split("-")[0]
        series[s] = series.get(s, 0) + 1
    print("kalshi series counts:", dict(sorted(series.items(), key=lambda kv: -kv[1])[:12]))


if __name__ == "__main__":
    print(f"window {iso(FROM)} .. {iso(TO)}")
    k = record_kalshi()
    p = record_polymarket()
    report(k, p)
