"""
Closed-form Black-Scholes pricing.

This is our ground truth benchmark: for a plain European call/put under
constant volatility, the Black-Scholes formula gives the exact answer.
Every Monte Carlo result (GBM, and later Heston in the constant-vol limit)
gets checked against this before we trust it.
"""

import numpy as np
from scipy.stats import norm


def black_scholes_price(S0, K, T, r, sigma, option_type="call"):
    """
    S0 : spot price today
    K  : strike
    T  : time to expiry (years)
    r  : risk-free rate (annualized, continuous compounding)
    sigma : volatility (annualized)
    """
    if T <= 0:
        payoff = max(S0 - K, 0.0) if option_type == "call" else max(K - S0, 0.0)
        return payoff

    d1 = (np.log(S0 / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if option_type == "call":
        price = S0 * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    elif option_type == "put":
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S0 * norm.cdf(-d1)
    else:
        raise ValueError("option_type must be 'call' or 'put'")

    return price


if __name__ == "__main__":
    # sanity check against a well-known textbook example
    S0, K, T, r, sigma = 100, 100, 1.0, 0.05, 0.2
    call = black_scholes_price(S0, K, T, r, sigma, "call")
    put = black_scholes_price(S0, K, T, r, sigma, "put")
    print(f"BS call price: {call:.4f}")
    print(f"BS put price:  {put:.4f}")
    # put-call parity check: C - P = S0 - K*exp(-rT)
    parity_lhs = call - put
    parity_rhs = S0 - K * np.exp(-r * T)
    print(f"Put-call parity check: {parity_lhs:.4f} vs {parity_rhs:.4f}")
