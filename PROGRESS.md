# Option Pricing Under Stochastic Volatility — Progress Notes

Status as of 2026-10-22, for review 2 (target: 70%).

## What's built and verified (code in `src/`, plots in `results/`)

**1. Foundation — `black_scholes.py`**
Closed-form Black-Scholes pricer. Verified against put-call parity.

**2. Simulation — `gbm_mc.py`**
Monte Carlo pricer under Geometric Brownian Motion, with antithetic
variates as the variance-reduction technique. Verified:
- Converges to the Black-Scholes price as path count grows (`results/mc_convergence.png`).
- Antithetic variates cut the standard error by **~27–30%** for the same
  number of random draws, at no extra simulation cost — the measurable
  "fewer simulations, same accuracy" result the proposal promised.

**3. Realism — `heston.py`**
Heston stochastic-volatility model, simulated with a full-truncation
Euler scheme (keeps the variance process numerically stable). Verified:
- Collapses back to the Black-Scholes price when vol-of-vol `xi=0`
  (within 3 standard errors — correctness check passed).
- With realistic equity-like parameters (`rho=-0.7`, i.e. prices drop ⇒
  vol spikes), produces a volatility **skew**: implied vol runs from
  ~23.6% (deep ITM calls / OTM puts) down to ~16.2% (OTM calls) across
  strikes 75–130, vs. a flat 20% that Black-Scholes is structurally
  forced to produce (`results/vol_smile.png`). This is the direct,
  visual evidence for why a constant-volatility model misprices real
  option markets.

**5. Calibration baseline — `calibration.py`**
Given a synthetic "market" price surface generated from known Heston
parameters, recovers parameters via numerical optimization
(Nelder-Mead on squared pricing error). Working, but:
- Takes ~2 seconds and ~55 re-simulations for a *single* calibration —
  this is the slow baseline the ML calibrator (below) needs to beat.
- The recovered parameters don't exactly match the true ones even
  though the fitted prices are close — this is Heston's well-documented
  **parameter non-identifiability**: several different parameter
  combinations can price the same strikes almost equally well. This is
  concrete evidence *for* the project's core pitch — a single calibrated
  number is misleading; reporting a confidence range is the honest
  answer, not an afterthought.

**4. Data — `generate_dataset.py`**
Generates a training set by sampling 6,000 random, plausible Heston
parameter combinations and pricing a 7-strike grid for each with our
Monte Carlo engine. Saved to `results/heston_dataset.csv`. Took ~90
seconds to build.

**5–6. ML calibration + uncertainty — `ml_calibration.py`**
Trains a Random Forest to map a price surface directly to Heston
parameters (prices → parameters, in one shot). Uncertainty comes "for
free" from the forest: each of the 200 trees gives its own prediction,
and the spread across trees becomes a 90% confidence interval per
parameter — no separate Bayesian or quantile-regression machinery
needed. Verified end-to-end on a held-out target price surface:
- **Calibration time: ~8 ms**, vs ~2 s for the Nelder-Mead baseline —
  roughly a 250x speedup, which is exactly the "faster" half of the
  project's title.
- Per-parameter accuracy is honestly modest (R² ranges 0.16–0.57 across
  the 5 parameters on held-out data) — again consistent with Heston's
  non-identifiability, not a bug in the model. This is a real,
  reportable finding, not a weakness to hide: it's the evidence that
  motivates reporting ranges instead of point estimates.
- The parameter uncertainty was carried all the way through to a final
  **option price range**: for the test case, point estimate ₹10.40,
  with a 90%-confidence range of ₹8.89–₹11.88 — directly matching the
  "₹105, likely between ₹98–₹112" deliverable format from the proposal.

## Not yet built (step 7 on the roadmap)

- Step 7: validation against real market option data (would need actual
  quoted option prices, e.g. NSE/Yahoo Finance options chain, to re-run
  the same calibration pipeline on).

## How to reproduce everything

```bash
cd src
python3 black_scholes.py       # sanity check + put-call parity
python3 gbm_mc.py              # plain vs antithetic MC, a few path counts
python3 heston.py              # Heston collapse check + strike sweep
python3 run_experiments.py     # regenerates both plots in results/
python3 calibration.py         # baseline (slow) optimizer calibration
python3 generate_dataset.py    # builds results/heston_dataset.csv (~90s)
python3 ml_calibration.py      # trains ML calibrator, runs the full demo
```

## One-line summary for the slide

> "We built and validated the full pricing engine end to end — GBM,
> Monte Carlo with antithetic variates (~27% variance reduction),
> Heston stochastic volatility (correctly collapses to Black-Scholes,
> and produces a real volatility skew Black-Scholes structurally
> cannot). We then built both calibration paths: a slow numerical
> baseline, and a Random Forest ML calibrator trained on 6,000
> simulated samples that calibrates ~250x faster (8ms vs 2s) and
> reports honest uncertainty — carried all the way through to a final
> option price range, e.g. '₹10.40, likely between ₹8.89 and ₹11.88.'
> Remaining: validating the whole pipeline against real market option
> data (step 7)."
