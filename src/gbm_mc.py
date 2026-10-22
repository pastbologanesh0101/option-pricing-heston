"""
Monte Carlo option pricing under Geometric Brownian Motion (GBM).

Idea: simulate many random future price paths for the stock, work out
what the option pays off at expiry in each path, discount back to today,
and average. That average is our Monte Carlo estimate of the fair price.

We also implement antithetic variates: a variance-reduction trick where,
for every random path we draw, we also draw its mirror-image path (using
-Z instead of Z for the random shocks). Averaging a path and its mirror
cancels out some of the simulation noise, so we get a more accurate price
estimate without needing to double the number of random draws.
"""

import time
import numpy as np


def _gbm_terminal_from_Z(S0, r, sigma, T, Z):
    """Map a matrix of standard-normal shocks Z (n_paths x n_steps) to
    terminal stock prices under risk-neutral GBM."""
    n_steps = Z.shape[1]
    dt = T / n_steps
    increments = (r - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * Z
    log_ST = np.log(S0) + increments.sum(axis=1)
    return np.exp(log_ST)


def _payoff(ST, K, option_type):
    if option_type == "call":
        return np.maximum(ST - K, 0.0)
    elif option_type == "put":
        return np.maximum(K - ST, 0.0)
    raise ValueError("option_type must be 'call' or 'put'")


def mc_price(S0, K, T, r, sigma, n_paths=100_000, n_steps=1,
             option_type="call", antithetic=False, seed=None):
    """
    Monte Carlo price of a European option under GBM, plus its standard
    error (how uncertain the estimate itself is).

    n_paths is the total number of random draws used (so antithetic=True
    uses n_paths/2 independent draws, each mirrored, for a fair
    draws-for-draws comparison against the plain estimator).
    """
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    dt_steps = n_steps

    if antithetic:
        half = n_paths // 2
        Z = rng.standard_normal((half, dt_steps))
        ST_pos = _gbm_terminal_from_Z(S0, r, sigma, T, Z)
        ST_neg = _gbm_terminal_from_Z(S0, r, sigma, T, -Z)
        payoff_pos = _payoff(ST_pos, K, option_type)
        payoff_neg = _payoff(ST_neg, K, option_type)
        # the antithetic estimator is the mean of each (path, mirror) pair --
        # that pairing is exactly where the variance cancellation happens
        pair_avg = 0.5 * (payoff_pos + payoff_neg)
        discounted = np.exp(-r * T) * pair_avg
        n_used = half
    else:
        Z = rng.standard_normal((n_paths, dt_steps))
        ST = _gbm_terminal_from_Z(S0, r, sigma, T, Z)
        payoffs = _payoff(ST, K, option_type)
        discounted = np.exp(-r * T) * payoffs
        n_used = n_paths

    price = discounted.mean()
    std_error = discounted.std(ddof=1) / np.sqrt(n_used)
    elapsed = time.perf_counter() - t0

    return {
        "price": price,
        "std_error": std_error,
        "n_paths_used": n_paths,  # total random draws spent, for fair comparison
        "time_sec": elapsed,
    }


if __name__ == "__main__":
    from black_scholes import black_scholes_price

    S0, K, T, r, sigma = 100, 100, 1.0, 0.05, 0.2
    bs = black_scholes_price(S0, K, T, r, sigma, "call")
    print(f"Black-Scholes benchmark: {bs:.4f}\n")

    for n in [1_000, 10_000, 100_000]:
        plain = mc_price(S0, K, T, r, sigma, n_paths=n, antithetic=False, seed=42)
        anti = mc_price(S0, K, T, r, sigma, n_paths=n, antithetic=True, seed=42)
        print(f"n={n:>7}  plain: {plain['price']:.4f} (se={plain['std_error']:.4f})"
              f"   antithetic: {anti['price']:.4f} (se={anti['std_error']:.4f})"
              f"   se reduction: {100*(1 - anti['std_error']/plain['std_error']):.1f}%")
