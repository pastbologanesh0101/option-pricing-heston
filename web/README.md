# Option Pricing — Web Demo

Live deployment: https://web-sepia-seven-68.vercel.app

A Next.js app built on top of the research in `../src` — the Heston model,
Monte Carlo pricing, and the Random Forest calibrator from the Python
pipeline, reimplemented in TypeScript so it runs as Vercel serverless
functions with no Python runtime needed at request time.

## What's here

- `src/lib/blackScholes.ts`, `src/lib/heston.ts` — ports of
  `../src/black_scholes.py` / `../src/heston.py` (closed-form BS, Heston
  full-truncation Euler Monte Carlo with antithetic variates).
- `src/lib/rfCalibrator.ts` — walks a Random Forest exported to JSON by
  `../src/export_rf_for_web.py`, reproducing `ml_calibration.py`'s
  tree-spread confidence intervals without needing scikit-learn at runtime.
- `src/app/api/spot` — live spot price via Yahoo's chart endpoint (no auth
  needed, safe to call live on every page load).
- `src/app/api/price` — runs the full calibration demo server-side.
- `src/app/api/assistant` — a scoped Gemini-powered "explain this result"
  chat widget (needs `GEMINI_API_KEY`, free from
  [Google AI Studio](https://aistudio.google.com/apikey)).
- `src/data/market_snapshot.json` — a real SPY options-chain snapshot,
  refreshed by re-running `../src/export_market_snapshot_for_web.py` before
  a demo (the options-chain endpoint needs a rotating auth token too
  fragile to call live on stage; spot price above is still fetched live).

## Running locally

```bash
npm install
cp .env.example .env.local   # add your GEMINI_API_KEY
npm run dev
```

## Deploying

```bash
npx vercel --prod
```

Set `GEMINI_API_KEY` in the Vercel project's environment variables for the
assistant widget to work in production.
