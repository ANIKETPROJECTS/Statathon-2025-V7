---
name: Prosecutor Attack Algorithm
description: Correct math for link_score and re_id_risk; do NOT use auxiliary dataset generation
---

## Rule
- `link_score(r) = 1 / |EC(r)|` where EC is built by grouping on selected quasi-identifiers
- `re_id_risk = mean(all link_scores) = num_distinct_ECs / N`
- atRisk = ec_size < k_threshold
- L-Diversity per SA: distinct values per EC; TVD = 0.5 * Σ|local_p - global_p|

**Why:** Previous implementation used a synthetic auxiliary dataset (wrong) — the spec requires pure within-dataset equivalence class analysis.

**How to apply:** runProsecutorAttack(data, qis, k, sensitiveAttrs, l, t) in prosecutorAttack.ts. No auxiliary dataset needed.
