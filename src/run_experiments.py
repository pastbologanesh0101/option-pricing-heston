"""
Generates the three results we want for the review presentation:

1. MC convergence plot -- plain vs antithetic Monte Carlo price converging
   to the Black-Scholes benchmark as the number of simulated paths grows.
2. Variance reduction table -- quantifies how much antithetic variates
   cuts the standard error for the same simulation budget.
3. Volatility smile plot -- implied vol backed out of Heston prices across
   strikes, next to the flat line Black-Scholes would give. This is the
   visual proof of *why* we need Heston: BS can't produce a smile at all,
   it's structurally a flat line by construction.

Run: python3 run_experiments.py
Outputs land in ../results/
"""

import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from black_scholes import black_scholes_price
from gbm_mc import mc_price
from heston import heston_mc_price
from implied_vol import implied_vol

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..", "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Shared base-case parameters
# ---------------------------------------------------------------------------
S0, K, T, r, sigma = 100, 100, 1.0, 0.05, 0.2
BS_PRICE = black_scholes_price(S0, K, T, r, sigma, "call")


def experiment_1_convergence():
    print("Running experiment 1: MC convergence (plain vs antithetic)...")
    path_counts = np.unique(np.logspace(2, 5.3, 25).astype(int))

    plain_prices, anti_prices = [], []
    plain_se, anti_se = [], []

    for n in path_counts:
        p = mc_price(S0, K, T, r, sigma, n_paths=int(n), antithetic=False, seed=1)
        a = mc_price(S0, K, T, r, sigma, n_paths=int(n), antithetic=True, seed=1)
        plain_prices.append(p["price"]); plain_se.append(p["std_error"])
        anti_prices.append(a["price"]); anti_se.append(a["std_error"])

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    ax = axes[0]
    ax.plot(path_counts, plain_prices, "o-", label="Plain MC", alpha=0.7, ms=4)
    ax.plot(path_counts, anti_prices, "s-", label="Antithetic MC", alpha=0.7, ms=4)
    ax.axhline(BS_PRICE, color="black", ls="--", label=f"Black-Scholes = {BS_PRICE:.4f}")
    ax.set_xscale("log")
    ax.set_xlabel("Number of simulated paths")
    ax.set_ylabel("Estimated call price")
    ax.set_title("MC price convergence to Black-Scholes")
    ax.legend()

    ax = axes[1]
    ax.plot(path_counts, plain_se, "o-", label="Plain MC", alpha=0.7, ms=4)
    ax.plot(path_counts, anti_se, "s-", label="Antithetic MC", alpha=0.7, ms=4)
    ax.set_xscale("log"); ax.set_yscale("log")
    ax.set_xlabel("Number of simulated paths (random draws spent)")
    ax.set_ylabel("Standard error")
    ax.set_title("Standard error vs simulation budget")
    ax.legend()

    fig.tight_layout()
    out = os.path.join(RESULTS_DIR, "mc_convergence.png")
    fig.savefig(out, dpi=150)
    print(f"  saved {out}")

    avg_reduction = 100 * (1 - np.mean(np.array(anti_se) / np.array(plain_se)))
    print(f"  average std-error reduction from antithetic variates: {avg_reduction:.1f}%")
    return avg_reduction


def experiment_2_smile():
    print("Running experiment 2: Heston implied volatility smile...")
    v0, kappa, theta, xi, rho = 0.04, 2.0, 0.04, 0.3, -0.7
    flat_sigma = np.sqrt(theta)

    strikes = np.arange(75, 131, 5)
    heston_prices, heston_iv, bs_iv = [], [], []

    for Kx in strikes:
        h = heston_mc_price(S0, Kx, T, r, v0, kappa, theta, xi, rho,
                             n_paths=300_000, n_steps=100, seed=11)
        heston_prices.append(h["price"])
        iv = implied_vol(h["price"], S0, Kx, T, r, "call")
        heston_iv.append(iv)
        bs_iv.append(flat_sigma)  # BS has one sigma for every strike, by construction

    fig, ax = plt.subplots(figsize=(7, 5))
    ax.plot(strikes, np.array(heston_iv) * 100, "o-", label="Heston implied vol", color="#c0392b")
    ax.plot(strikes, np.array(bs_iv) * 100, "--", label="Black-Scholes (flat, by assumption)", color="#2c3e50")
    ax.axvline(S0, color="gray", ls=":", alpha=0.6, label="At-the-money")
    ax.set_xlabel("Strike price")
    ax.set_ylabel("Implied volatility (%)")
    ax.set_title("Volatility smile: Heston vs Black-Scholes")
    ax.legend()
    fig.tight_layout()
    out = os.path.join(RESULTS_DIR, "vol_smile.png")
    fig.savefig(out, dpi=150)
    print(f"  saved {out}")

    print(f"  strikes: {list(strikes)}")
    print(f"  Heston implied vols (%): {[round(x*100,2) for x in heston_iv]}")
    return strikes, heston_iv


def experiment_3_collapse_check():
    print("Running experiment 3: Heston -> GBM/BS collapse check (xi=0)...")
    collapsed = heston_mc_price(S0, K, T, r, v0=sigma**2, kappa=1.0, theta=sigma**2,
                                 xi=0.0, rho=0.0, n_paths=300_000, n_steps=50, seed=3)
    diff = collapsed["price"] - BS_PRICE
    within_3se = abs(diff) < 3 * collapsed["std_error"]
    print(f"  Black-Scholes: {BS_PRICE:.4f}")
    print(f"  Heston(xi=0):  {collapsed['price']:.4f} (se={collapsed['std_error']:.4f})")
    print(f"  diff: {diff:+.4f}  -- within 3 standard errors: {within_3se}")
    return collapsed, within_3se


if __name__ == "__main__":
    print(f"Base case: S0={S0}, K={K}, T={T}, r={r}, sigma={sigma}")
    print(f"Black-Scholes benchmark price: {BS_PRICE:.4f}\n")

    reduction = experiment_1_convergence()
    print()
    collapsed, ok = experiment_3_collapse_check()
    print()
    strikes, iv = experiment_2_smile()

    print("\n=== Summary for slides ===")
    print(f"Antithetic variates reduce MC standard error by ~{reduction:.0f}% "
          f"for the same number of random draws.")
    print(f"Heston collapses correctly to Black-Scholes in the xi=0 limit "
          f"(sanity check passed: {ok}).")
    print(f"Heston produces a volatility smile/skew ranging from "
          f"{min(iv)*100:.1f}% to {max(iv)*100:.1f}% implied vol across strikes "
          f"{strikes.min()}-{strikes.max()}, vs a flat {np.sqrt(0.04)*100:.1f}% for Black-Scholes.")
