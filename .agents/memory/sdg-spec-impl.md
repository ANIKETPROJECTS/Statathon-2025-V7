---
name: SDG Module Full Spec
description: Complete implementation of Statistical SDG (Gaussian Copula) and DP-SDG (DP-SGD simulation) in synthetic.ts; UI wiring in privacy-page.tsx
---

## Core Algorithms

### Statistical SDG (`applyStatisticalSDG`)
Options object: `{ targetSize, preserveCorrelations, bandwidthRule: "silverman"|"scott"|"fixed", seed: number|null }`
- Column classification: `unique/N < 0.05 || unique ≤ 20 → categorical`; else if numeric → continuous
- KDE fitting: Silverman `h = 0.9 × min(σ, IQR/1.34) × n^(−1/5)`, Scott `h = 1.06σn^(−1/5)`, Fixed `(max−min)/20`
- Gaussian Copula path (when `preserveCorrelations && numCols >= 2`):
  1. PIT: `u_ij = empiricalCDF(sorted, x_ij)` with small random jitter
  2. Probit: `z_ij = Φ⁻¹(u_ij)` via Acklam rational approximation (max error 1.15e-9)
  3. Correlation matrix of Z → `nearestPD` (Jacobi eigendecomposition, floor λ < 1e-6, renormalize diagonal)
  4. Cholesky L → generate `z̃ = ε × Lᵀ` → `Ũ = Φ(z̃)` → back-transform via `kdeQuantile`
- Cap copula at 50 columns for Cholesky stability

### DP-SDG (`applyDPSDG`)
Options object: `{ targetSize, epsilon, delta, clipNorm, epochs, batchSize, seed }`
- RDP accounting: `computeSigmaFromEpsilon(eps, delta, T, n, B)` via binary search; `computeEpsilonFromSigma` via min over α ∈ [1.5..256] of `T × q²α/(2σ²) + log(1/δ)/(α−1)`
- Simulation: `T_sim = min(T, 600)` steps for browser performance; real T used for RDP accounting
- Per-step: sample batch → per-sample gradient clipping by C → Gaussian noise N(0, σ²C²I) → mean/variance update
- Generation: DP-learned Gaussian → normCDF-ranked → kdeQuantile back-transform (preserves distribution shape)
- Categorical: DP histogram updated per step → normalized PMF for sampling
- Loss curves sampled every 30 steps for HTML report

### Metrics (both methods)
- KS statistic + p-value, Wasserstein-1, JSD (histogram-based, 20 bins), Mean Shift %, Std Ratio
- DCR score (sample 80 syn × 40 real, normalized by max pairwise dist)
- Correlation Frobenius error (real vs syn corr matrix)
- Privacy-Utility Index = max(0, 1 − ε/10) for DP-SDG

## UI Wiring (privacy-page.tsx)

### New state variables
- `synthBandwidthRule: "silverman"|"scott"|"fixed"` (default silverman)
- `synthSeedEnabled: boolean` (default false), `synthSeed: number` (default 42)
- `dpSgdEpochs: number` (default 300), `dpSgdBatchSize: number` (default 500)

### showTC_other change
`const showTC_other = family === "crypto";` — SDG tab has NO target column panel per spec §5

### Live DP-SDG privacy panel
Computed inline: T = epochs × ⌈N/B⌉; σ = computeSigmaFromEpsilon(ε, δ, T, N, B); displayed as read-only grid in blue info box

### Exported functions
`computeSigmaFromEpsilon` and `computeEpsilonFromSigma` are exported for live UI display

**Why:** SDG applies to the full schema — no per-column targeting makes sense. Target columns were removed from the SDG tab per spec §5.
