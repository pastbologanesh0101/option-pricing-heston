"""
Baseline (non-ML) Heston calibration.

Calibration = the reverse problem: given observed option prices across
strikes, find the Heston parameters (v0, kappa, theta, xi, rho) that
reproduce them. This script does it the "slow, traditional" way the
project proposal calls out: generate a synthetic market price surface
from known ("true") parameters, then recover those parameters by
numerical optimization (Nelder-Mead on squared pricing error).

This is deliberately the slow baseline. The timing numbers here are what
our planned ML calibrator (prices -> parameters, step 5 on the roadmap)
needs to beat -- that's the whole point of building it: this optimizer
re-runs thousands of Monte Carlo simulations, one per iteration, which is
exactly the bottleneck we want to replace with a single fast forward pass
through a trained model.
"""

import time
import numpy as np
from scipy.optimize import minimize

from heston import heston_mc_price

S0, T, r = 100, 1.0, 0.05
STRIKES = np.array([85, 90, 95, 100, 105, 110, 115])

TRUE_PARAMS = dict(v0=0.04, kappa=2.0, theta=0.04, xi=0.3, rho=-0.7)


def price_surface(params, n_paths=20_000, n_steps=50, seed=0):
    """Price every strike under a given parameter set (fast settings,
    since this gets called many times inside the optimizer)."""
    prices = []
    for K in STRIKES:
        out = heston_mc_price(S0, K, T, r, n_paths=n_paths, n_steps=n_steps,
                               seed=seed, **params)
        prices.append(out["price"])
    return np.array(prices)


def unpack(x):
    v0, kappa, theta, xi, rho = x
    return dict(v0=v0, kappa=kappa, theta=theta, xi=xi, rho=np.clip(rho, -0.999, 0.999))


def objective(x, target_prices):
    params = unpack(x)
    try:
        model_prices = price_surface(params, n_paths=5_000, n_steps=30, seed=1)
    except Exception:
        return 1e6
    return np.sum((model_prices - target_prices) ** 2)


if __name__ == "__main__":
    print("Generating synthetic 'market' price surface from known parameters...")
    print(f"True parameters: {TRUE_PARAMS}")
    market_prices = price_surface(TRUE_PARAMS, n_paths=200_000, n_steps=100, seed=99)
    for K, p in zip(STRIKES, market_prices):
        print(f"  K={K}: {p:.4f}")

    # a deliberately-off starting guess, like a calibrator would have with no prior
    x0 = np.array([0.05, 1.0, 0.05, 0.5, -0.3])

    print("\nRunning Nelder-Mead optimization to recover parameters...")
    t0 = time.perf_counter()
    result = minimize(objective, x0, args=(market_prices,), method="Nelder-Mead",
                       options={"maxiter": 200, "xatol": 1e-3, "fatol": 1e-2})
    elapsed = time.perf_counter() - t0

    recovered = unpack(result.x)
    print(f"\nCalibration finished in {elapsed:.1f}s over {result.nit} iterations.")
    print(f"{'param':<8}{'true':>10}{'recovered':>12}")
    for k in TRUE_PARAMS:
        print(f"{k:<8}{TRUE_PARAMS[k]:>10.4f}{recovered[k]:>12.4f}")

    print(f"\nThis is the baseline our planned ML calibrator needs to beat: "
          f"~{elapsed:.0f}s and {result.nit} re-simulations for ONE calibration, "
          f"vs a single forward pass through a trained model (target: milliseconds).")
