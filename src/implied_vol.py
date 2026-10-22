"""
Implied volatility inversion.

Given a market (or Heston-simulated) option price, find the single sigma
that would make the Black-Scholes formula reproduce that price. Plotting
implied vol against strike is how we *see* the volatility smile: under
true Black-Scholes assumptions this curve is flat (one sigma fits every
strike); under Heston, it bends -- and that bend is the whole point of
building a stochastic-volatility model in the first place.
"""

from scipy.optimize import brentq
from black_scholes import black_scholes_price


def implied_vol(price, S0, K, T, r, option_type="call",
                 lo=1e-4, hi=5.0):
    """Invert Black-Scholes for sigma via bisection (Brent's method)."""
    def objective(sigma):
        return black_scholes_price(S0, K, T, r, sigma, option_type) - price

    try:
        return brentq(objective, lo, hi, xtol=1e-6)
    except ValueError:
        return float("nan")  # price outside any achievable BS price for this bracket
