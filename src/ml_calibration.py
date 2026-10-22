"""
Step 5 + 6 on the roadmap: train an ML model that calibrates the Heston
model instantly, and reports how confident it is.

Input:  a price surface (one price per strike, 7 numbers)
Output: the 5 Heston parameters (v0, kappa, theta, xi, rho) that most
        likely produced it, PLUS a confidence interval per parameter.

We use a Random Forest. The reason we pick this over a single neural
net for the uncertainty requirement specifically: a Random Forest is
literally an ensemble of many independently-trained trees -- so we get
a distribution of predictions "for free" just by asking every tree in
the forest for its own answer, instead of needing a dedicated
quantile-regression or Bayesian setup. The spread across trees IS our
confidence range.

We then chain the calibrated Heston parameters back into our pricer to
get a final OPTION PRICE confidence range -- e.g. "the fair call price
is approximately ₹X, likely between ₹Y and ₹Z" -- which is the exact
deliverable promised in the project proposal.
"""

import os
import time
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

from heston import heston_mc_price
from calibration import price_surface as slow_price_surface, STRIKES, S0, T, r

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "results", "heston_dataset.csv")
PARAM_COLS = ["v0", "kappa", "theta", "xi", "rho"]


def load_data():
    df = pd.read_csv(DATA_PATH)
    price_cols = [c for c in df.columns if c.startswith("price_")]
    X = df[price_cols].values
    y = df[PARAM_COLS].values
    return X, y, price_cols


def train_model(X, y, seed=0):
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=seed
    )

    model = RandomForestRegressor(
        n_estimators=200, max_depth=None, min_samples_leaf=3,
        random_state=seed, n_jobs=-1,
    )
    t0 = time.perf_counter()
    model.fit(X_train, y_train)
    train_time = time.perf_counter() - t0

    pred = model.predict(X_test)
    print("Held-out test set performance (per parameter):")
    for i, name in enumerate(PARAM_COLS):
        mae = mean_absolute_error(y_test[:, i], pred[:, i])
        r2 = r2_score(y_test[:, i], pred[:, i])
        print(f"  {name:<8} MAE={mae:.4f}   R^2={r2:.3f}")

    return model, train_time


def predict_with_uncertainty(model, X_query):
    """
    Returns (mean_prediction, lower_90, upper_90) for each parameter,
    using the spread of individual tree predictions in the forest as
    the uncertainty estimate.
    """
    # shape: (n_trees, n_queries, n_params)
    tree_preds = np.stack([t.predict(X_query) for t in model.estimators_], axis=0)
    mean = tree_preds.mean(axis=0)
    lower = np.percentile(tree_preds, 5, axis=0)
    upper = np.percentile(tree_preds, 95, axis=0)
    return mean, lower, upper


if __name__ == "__main__":
    print(f"Loading dataset from {DATA_PATH} ...")
    X, y, price_cols = load_data()
    print(f"  {X.shape[0]} samples, {X.shape[1]} price features -> {y.shape[1]} parameters\n")

    model, train_time = train_model(X, y)
    print(f"\nModel trained in {train_time:.2f}s (one-time cost).\n")

    # --- Head-to-head: ML calibration vs the slow optimizer, same target prices ---
    true_params = dict(v0=0.04, kappa=2.0, theta=0.04, xi=0.3, rho=-0.7)
    target_prices = slow_price_surface(true_params, n_paths=200_000, n_steps=100, seed=99)
    print("Target 'market' prices:", np.round(target_prices, 4))
    print(f"(generated from true params: {true_params})\n")

    t0 = time.perf_counter()
    mean, lower, upper = predict_with_uncertainty(model, target_prices.reshape(1, -1))
    ml_time = time.perf_counter() - t0
    mean, lower, upper = mean[0], lower[0], upper[0]

    print(f"ML calibration took {ml_time*1000:.1f} ms (vs ~2s / 55 re-simulations for "
          f"the Nelder-Mead baseline in calibration.py).\n")

    print(f"{'param':<8}{'true':>10}{'ML mean':>10}{'90% range':>22}")
    for i, name in enumerate(PARAM_COLS):
        print(f"{name:<8}{true_params[name]:>10.4f}{mean[i]:>10.4f}"
              f"   [{lower[i]:.4f}, {upper[i]:.4f}]")

    # --- Carry the uncertainty through to a final option price range ---
    print("\nCarrying parameter uncertainty through to a final option price range "
          "(K=100 call):")
    calibrated_mean = dict(zip(PARAM_COLS, mean))
    calibrated_lower = dict(zip(PARAM_COLS, lower))
    calibrated_upper = dict(zip(PARAM_COLS, upper))

    p_mean = heston_mc_price(S0, 100, T, r, n_paths=100_000, n_steps=100, seed=5,
                              **calibrated_mean)["price"]
    p_lower = heston_mc_price(S0, 100, T, r, n_paths=100_000, n_steps=100, seed=5,
                               **calibrated_lower)["price"]
    p_upper = heston_mc_price(S0, 100, T, r, n_paths=100_000, n_steps=100, seed=5,
                               **calibrated_upper)["price"]
    lo, hi = sorted([p_lower, p_upper])
    print(f"  Fair price ~ {p_mean:.2f}, likely between {lo:.2f} and {hi:.2f}")
