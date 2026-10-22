# Option Pricing Under Stochastic Volatility

Using the Heston model and machine learning to make option pricing faster
and more honest about its own uncertainty.

**Authors:** Rikhil Modalavalasa (25BCE2884), Vishwanathan (25BCE2885)

## The problem

An option gives the right to buy/sell a stock later at a price fixed
today. The core question in finance: what's a fair price for that right,
right now?

Black-Scholes (1973) solves this exactly, but assumes volatility is
constant. Real markets don't behave that way — volatility spikes and
clusters, especially during crashes. The Heston model fixes this by
letting volatility itself be a random process, but it's slower to price
and notoriously hard to calibrate — different parameter sets can explain
the same market prices almost equally well (non-identifiability), yet
most tools report calibration as a single confident number anyway.

## What's here

| Step | File | What it does |
|---|---|---|
| 1. Foundation | `src/black_scholes.py` | Closed-form Black-Scholes pricer, verified via put-call parity |
| 2. Simulation | `src/gbm_mc.py` | Monte Carlo pricing under GBM, with antithetic variates for variance reduction |
| 3. Realism | `src/heston.py` | Heston stochastic-volatility simulation (full-truncation Euler scheme) |
| — | `src/implied_vol.py` | Black-Scholes implied-vol inversion, used to plot the volatility smile/skew |
| — | `src/run_experiments.py` | Regenerates the convergence and smile plots in `results/` |
| 5a. Calibration (baseline) | `src/calibration.py` | Slow numerical (Nelder-Mead) Heston calibration from a price surface |
| 4. Data | `src/generate_dataset.py` | Builds a 6,000-sample (parameters → price surface) training set |
| 5b–6. ML calibration + confidence | `src/ml_calibration.py` | Random Forest calibrator: prices → parameters in ~8ms, with a 90% confidence range from tree-to-tree spread, carried through to a final option price range |
| 7. Validation (started) | `src/market_validation.py` | Pulls a **live** SPY options chain via `yfinance` and compares real market implied vol against our synthetic Heston skew |
| 7. Validation (stretch, blocked) | `src/nse_option_chain.py` | Attempted live NIFTY option chain from NSE India; blocked by NSE's bot detection — kept as a documented fallback |

## Key results

- **Antithetic variates** cut Monte Carlo standard error by ~27–30% for
  the same number of random draws (`results/mc_convergence.png`).
- **Heston correctly collapses** to Black-Scholes when vol-of-vol → 0
  (verified within 3 standard errors), and produces a genuine
  **volatility skew** (23.6% → 16.2% implied vol across strikes 75–130)
  that Black-Scholes structurally cannot produce (`results/vol_smile.png`).
- The ML calibrator is **~250x faster** than the numerical baseline
  (~8ms vs ~2s), and its honest uncertainty — carried through from
  parameters to final price — gives results like:
  *"fair price ≈ ₹10.40, likely between ₹8.89 and ₹11.88."*
- A **live** SPY options chain (pulled via `yfinance`) shows the same
  downward-sloping volatility skew our Heston simulation produces —
  real markets are not flat-volatility (`results/real_vs_synthetic_skew.png`).

See [`PROGRESS.md`](PROGRESS.md) for the full write-up, including what's
still open (validation against real market option data).

## Running it

```bash
pip install numpy scipy matplotlib pandas scikit-learn yfinance requests

cd src
python3 black_scholes.py       # sanity check + put-call parity
python3 gbm_mc.py              # plain vs antithetic MC
python3 heston.py              # Heston collapse check + strike sweep
python3 run_experiments.py     # regenerates plots in results/
python3 calibration.py         # baseline (slow) optimizer calibration
python3 generate_dataset.py    # builds results/heston_dataset.csv (~90s)
python3 ml_calibration.py      # trains ML calibrator, runs the full demo
python3 market_validation.py   # pulls a LIVE SPY options chain, compares real vs synthetic skew
python3 nse_option_chain.py    # attempts a live NIFTY chain from NSE (often blocked)
```
