"""
Heston stochastic volatility model.

GBM assumes volatility (sigma) is a constant. Real markets don't behave
that way -- volatility itself drifts around randomly and tends to spike
during crashes (the "volatility clustering" effect). The Heston model
fixes this by making the *variance* of the stock itself a random process
that moves around, instead of a fixed number:

    dS_t = r*S_t*dt + sqrt(v_t)*S_t*dW1_t
    dv_t = kappa*(theta - v_t)*dt + xi*sqrt(v_t)*dW2_t

    corr(dW1_t, dW2_t) = rho * dt

where:
    v_t   = instantaneous variance (v_0 is today's variance)
    kappa = speed of mean reversion (how fast vol is pulled back to theta)
    theta = long-run average variance
    xi    = "vol of vol" -- how jumpy the variance process itself is
    rho   = correlation between stock shocks and variance shocks
            (in equities this is usually negative: "leverage effect" --
            prices drop, vol spikes)

We simulate this with the Euler-Maruyama scheme plus full truncation
(Lord, Koekkoek & Van Dijk 2010) to keep the simulated variance from
going negative, which is a known numerical issue with naive Euler
discretization of the square-root variance process.

Setting xi=0 and v0=theta collapses Heston back to flat-volatility GBM,
which is our main internal correctness check: Heston --xi=0--> GBM
--xi=0,single-step--> Black-Scholes, so all three should agree in that
limit.
"""

import time
import numpy as np


def simulate_heston_paths(S0, v0, r, kappa, theta, xi, rho, T,
                           n_paths, n_steps, seed=None):
    """
    Full-truncation Euler scheme for the Heston model.
    Returns terminal stock prices (array of length n_paths).
    """
    rng = np.random.default_rng(seed)
    dt = T / n_steps
    sqrt_dt = np.sqrt(dt)

    S = np.full(n_paths, S0, dtype=float)
    v = np.full(n_paths, v0, dtype=float)

    Z1 = rng.standard_normal((n_paths, n_steps))
    Z2 = rng.standard_normal((n_paths, n_steps))
    # correlate the variance shocks with the stock shocks via rho
    W1 = Z1
    W2 = rho * Z1 + np.sqrt(1 - rho**2) * Z2

    for t in range(n_steps):
        v_pos = np.maximum(v, 0.0)  # full truncation: use max(v,0) in the diffusion
        sqrt_v = np.sqrt(v_pos)

        S = S * np.exp((r - 0.5 * v_pos) * dt + sqrt_v * sqrt_dt * W1[:, t])
        v = v + kappa * (theta - v_pos) * dt + xi * sqrt_v * sqrt_dt * W2[:, t]

    return S


def heston_mc_price(S0, K, T, r, v0, kappa, theta, xi, rho,
                     n_paths=100_000, n_steps=100, option_type="call", seed=None):
    t0 = time.perf_counter()
    ST = simulate_heston_paths(S0, v0, r, kappa, theta, xi, rho, T,
                                n_paths, n_steps, seed=seed)

    if option_type == "call":
        payoffs = np.maximum(ST - K, 0.0)
    elif option_type == "put":
        payoffs = np.maximum(K - ST, 0.0)
    else:
        raise ValueError("option_type must be 'call' or 'put'")

    discounted = np.exp(-r * T) * payoffs
    price = discounted.mean()
    std_error = discounted.std(ddof=1) / np.sqrt(n_paths)
    elapsed = time.perf_counter() - t0

    return {"price": price, "std_error": std_error, "time_sec": elapsed}


if __name__ == "__main__":
    from black_scholes import black_scholes_price

    S0, K, T, r = 100, 100, 1.0, 0.05

    # --- Sanity check: Heston with xi=0, v0=theta=sigma^2 must collapse to GBM/BS ---
    sigma = 0.2
    bs = black_scholes_price(S0, K, T, r, sigma, "call")
    collapsed = heston_mc_price(S0, K, T, r, v0=sigma**2, kappa=1.0, theta=sigma**2,
                                 xi=0.0, rho=0.0, n_paths=200_000, n_steps=50, seed=1)
    print("=== Collapse check (xi=0 Heston should match Black-Scholes) ===")
    print(f"Black-Scholes: {bs:.4f}")
    print(f"Heston (xi=0): {collapsed['price']:.4f} (se={collapsed['std_error']:.4f})\n")

    # --- Realistic Heston parameters (equity-like: negative rho, vol clustering) ---
    print("=== Realistic Heston vs flat-vol Black-Scholes, across strikes ===")
    v0, kappa, theta, xi, rho = 0.04, 2.0, 0.04, 0.3, -0.7
    flat_sigma = np.sqrt(theta)  # same long-run variance, for a fair side-by-side
    for K_test in [80, 90, 100, 110, 120]:
        h = heston_mc_price(S0, K_test, T, r, v0, kappa, theta, xi, rho,
                             n_paths=200_000, n_steps=100, seed=7)
        b = black_scholes_price(S0, K_test, T, r, flat_sigma, "call")
        print(f"K={K_test:>3}  Heston: {h['price']:.4f} (se={h['std_error']:.4f})"
              f"   flat-vol BS: {b:.4f}   diff: {h['price']-b:+.4f}")
