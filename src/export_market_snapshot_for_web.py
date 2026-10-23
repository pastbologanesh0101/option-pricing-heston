"""
Exports a real SPY options-chain snapshot (via the same fetch_option_chain
used in market_validation.py) to JSON for the web app.

Why a snapshot and not a live fetch on every page load: Yahoo's options-
chain endpoint requires a rotating "crumb" token that is rate-limited and
occasionally blocks entirely -- too fragile to depend on live, in front of
an audience, from a serverless function's IP. The spot PRICE (shown
separately on the site) is still fetched live on every load via Yahoo's
simpler chart endpoint, which doesn't need a crumb.

Re-run this manually before a demo to refresh the snapshot:
    python3 export_market_snapshot_for_web.py
"""

import os
import json
import datetime as dt

from market_validation import fetch_option_chain

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "src", "data", "market_snapshot.json")


def main():
    print("Fetching live SPY options chain...")
    data = fetch_option_chain("SPY", target_days=30, option_type="calls")
    chain = data["chain"]

    payload = {
        "ticker": data["ticker"],
        "spot": data["spot"],
        "expiry": data["expiry"],
        "T": data["T"],
        "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "chain": [
            {
                "strike": float(row.strike),
                "impliedVolatility": float(row.impliedVolatility),
                "bid": float(row.bid),
                "ask": float(row.ask),
                "lastPrice": float(row.lastPrice),
            }
            for row in chain.itertuples()
        ],
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {OUT_PATH} ({len(payload['chain'])} strikes, spot={payload['spot']:.2f}, "
          f"expiry={payload['expiry']})")


if __name__ == "__main__":
    main()
