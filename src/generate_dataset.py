"""
Step 4 on the roadmap: build a large (parameters -> prices) dataset by
sampling random, plausible Heston parameter sets and pricing a fixed
strike grid for each one with our Monte Carlo engine.

This dataset is what step 5/6 train on: instead of the slow numerical
optimizer in calibration.py working strike-by-strike, we flip the
problem around -- learn the price-surface -> parameters mapping once,
offline, then calibration at inference time is a single fast model
call.

We use coarse MC settings here (fewer paths/steps) because we need
thousands of samples; each one carries some simulation noise, which is
fine -- it's a reasonable stand-in for real market bid/ask noise, and
part of why the ML calibrator's job is to be robust/uncertain, not
exact.
"""

import time
import numpy as np
import pandas as pd

from heston import heston_mc_price

S0, T, r = 100, 1.0, 0.05
STRIKES = np.array([85, 90, 95, 100, 105, 110, 115])

# plausible ranges for each Heston parameter (equity-like)
PARAM_RANGES = {
    "v0": (0.01, 0.09),      # today's variance -> ~10%-30% vol
    "kappa": (0.5, 4.0),     # mean-reversion speed
    "theta": (0.01, 0.09),   # long-run variance
    "xi": (0.1, 0.8),        # vol of vol
    "rho": (-0.9, -0.1),     # equity leverage effect: typically negative
}


def sample_params(rng):
    return {k: rng.uniform(lo, hi) for k, (lo, hi) in PARAM_RANGES.items()}


def build_dataset(n_samples, n_paths=4_000, n_steps=30, seed=0, out_path=None):
    rng = np.random.default_rng(seed)
    rows = []
    t0 = time.perf_counter()

    for i in range(n_samples):
        params = sample_params(rng)
        prices = []
        for K in STRIKES:
            out = heston_mc_price(S0, K, T, r, n_paths=n_paths, n_steps=n_steps,
                                   seed=rng.integers(0, 1_000_000), **params)
            prices.append(out["price"])

        row = {**params}
        for K, p in zip(STRIKES, prices):
            row[f"price_K{K}"] = p
        rows.append(row)

        if (i + 1) % 50 == 0:
            elapsed = time.perf_counter() - t0
            print(f"  {i+1}/{n_samples} samples done ({elapsed:.1f}s elapsed)")

    df = pd.DataFrame(rows)
    if out_path:
        df.to_csv(out_path, index=False)
        print(f"Saved dataset to {out_path} ({len(df)} rows)")
    return df


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(__file__), "..", "results", "heston_dataset.csv")
    build_dataset(n_samples=6000, n_paths=4_000, n_steps=30, seed=42, out_path=out)
