"""
One-time export: trains the same Random Forest calibrator as
ml_calibration.py, then dumps every tree's structure to a compact JSON
file the Next.js app can load and walk in plain TypeScript -- no Python
runtime needed on the deployed site.

Run manually whenever heston_dataset.csv changes:
    python3 export_rf_for_web.py
"""

import os
import json
import numpy as np
from sklearn.ensemble import RandomForestRegressor

from ml_calibration import load_data, PARAM_COLS

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "src", "data", "rf_model.json")

# Fewer trees than the research model (200) -- this is a live browser demo,
# not the benchmark claim, and it keeps the JSON payload small. The
# uncertainty story (tree-to-tree spread) still holds at this size.
N_ESTIMATORS = 60


def tree_to_dict(tree):
    t = tree.tree_
    return {
        "childrenLeft": t.children_left.tolist(),
        "childrenRight": t.children_right.tolist(),
        "feature": t.feature.tolist(),
        "threshold": t.threshold.tolist(),
        # value shape is (n_nodes, n_outputs, 1) for a multi-output regressor
        "value": t.value[:, :, 0].tolist(),
    }


def main():
    print("Loading dataset...")
    X, y, price_cols = load_data()
    print(f"  {X.shape[0]} samples, {X.shape[1]} features -> {y.shape[1]} params")

    print(f"Training RandomForestRegressor(n_estimators={N_ESTIMATORS})...")
    model = RandomForestRegressor(
        n_estimators=N_ESTIMATORS, max_depth=None, min_samples_leaf=3,
        random_state=0, n_jobs=-1,
    )
    model.fit(X, y)

    trees = [tree_to_dict(t) for t in model.estimators_]

    payload = {
        "paramNames": PARAM_COLS,
        "priceCols": price_cols,
        "nEstimators": N_ESTIMATORS,
        "trees": trees,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f)

    size_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
    print(f"Wrote {OUT_PATH} ({size_mb:.2f} MB, {len(trees)} trees)")


if __name__ == "__main__":
    main()
