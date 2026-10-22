"""
Step 7 (stretch): real option chain from NSE India (NIFTY index options).

NSE publishes its live option chain as JSON at a public endpoint that its
own website's frontend calls -- there's no official API or key, so this
is more fragile than the yfinance path in market_validation.py: NSE
actively rate-limits/blocks requests that don't look like a real browser
(no proper headers, no warm-up request for cookies). If this fails on
the day, fall back to market_validation.py (yfinance/SPY), which is the
more reliable of the two.

Approach: hit the NSE homepage first to pick up session cookies, then
call the option-chain-indices API with those cookies attached, mimicking
what a real browser tab does.
"""

import time
import requests
import pandas as pd

BASE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "application/json, text/plain, */*",
}


def fetch_nifty_option_chain(symbol="NIFTY", retries=3):
    session = requests.Session()
    session.headers.update(BASE_HEADERS)

    # warm-up request: lets NSE set session cookies, same as a real page load
    session.get("https://www.nseindia.com/option-chain", timeout=10)
    time.sleep(1)

    url = f"https://www.nseindia.com/api/option-chain-indices?symbol={symbol}"

    last_err = None
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            return data
        except Exception as e:
            last_err = e
            time.sleep(2)

    raise RuntimeError(f"Could not fetch NSE option chain after {retries} attempts: {last_err}")


def parse_option_chain(data, option_type="CE"):
    records = data["records"]["data"]
    spot = data["records"]["underlyingValue"]
    expiry = data["records"]["expiryDates"][0]

    rows = []
    for rec in records:
        if rec.get("expiryDate") != expiry:
            continue
        leg = rec.get(option_type)
        if leg is None:
            continue
        rows.append({
            "strike": rec["strikePrice"],
            "lastPrice": leg.get("lastPrice"),
            "bid": leg.get("bidprice"),
            "ask": leg.get("askPrice"),
            "openInterest": leg.get("openInterest"),
            "impliedVolatility": leg.get("impliedVolatility"),
        })

    df = pd.DataFrame(rows).sort_values("strike").reset_index(drop=True)
    return {"spot": spot, "expiry": expiry, "chain": df}


if __name__ == "__main__":
    print("Fetching live NIFTY option chain from NSE India...")
    try:
        raw = fetch_nifty_option_chain("NIFTY")
        result = parse_option_chain(raw, option_type="CE")
        print(f"  spot: {result['spot']}")
        print(f"  expiry: {result['expiry']}")
        print(result["chain"].head(20).to_string(index=False))
    except Exception as e:
        print(f"FAILED: {e}")
        print("\nThis is a known risk with NSE's endpoint (bot detection / rate limiting).")
        print("Fallback: use market_validation.py (yfinance/SPY) instead -- more reliable.")
