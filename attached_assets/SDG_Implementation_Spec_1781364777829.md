# Synthetic Data Generation (SDG) — Complete Implementation Specification
### Statathon 2025 | MoE Innovation Cell | AIRAVATA Technologies

---

## 0. Overview & Scope

The Privacy Enhancement module's SDG tab exposes two generation methods:

| # | Method | Privacy Model | Best For |
|---|--------|--------------|----------|
| 1 | **Statistical SDG** (Marginal Sampling + Copula) | No formal DP guarantee; high utility | Utility-first release, internal use |
| 2 | **DP-SDG** (DP-CTGAN via DP-SGD) | (ε, δ)-Differential Privacy | Public microdata release, DPDP-Act compliance |

**Target Columns:** SDG applies to the **entire dataset** (all columns). The sidebar Target Column selector is **not applicable** for SDG methods — remove it from the UI for this tab. The user configures method parameters only.

---

## 1. METHOD 1 — Statistical SDG (Marginal Sampling + Gaussian Copula)

### 1.1 Conceptual Goal

Generate a synthetic dataset of size *n* that:
- Preserves each column's **marginal distribution** exactly (or as closely as possible).
- Preserves the **pairwise dependency structure** (Pearson correlations) between columns via a Gaussian Copula.
- Does **not** copy any real record verbatim.

---

### 1.2 Column Type Classification

Before any fitting, classify every column:

```
For column j in {1 … d}:
  IF unique_values(j) / n < 0.05  OR  unique_values(j) ≤ 20:
      type[j] = CATEGORICAL
  ELSE IF dtype(j) ∈ {int, float}:
      type[j] = CONTINUOUS
  ELSE:
      type[j] = CATEGORICAL
```

---

### 1.3 Marginal Fitting

#### 1.3.1 Continuous Columns — Kernel Density Estimation (KDE)

For each continuous column *j* with observed values **x** = {x₁, …, xₙ}:

**Bandwidth (Silverman's Rule):**
```
h_j = 0.9 × min(σ_j, IQR_j / 1.34) × n^(-1/5)

where:
  σ_j   = sample standard deviation of column j
  IQR_j = interquartile range (Q75 - Q25) of column j
  n     = number of records
```

**KDE Density Estimate:**
```
f̂_j(x) = (1 / (n × h_j)) × Σᵢ K((x − xᵢ) / h_j)

K(u) = (1/√(2π)) × exp(−u²/2)    ← Gaussian kernel
```

**CDF Inversion for Sampling (via Probability Integral Transform):**
```
û_j ~ Uniform(0, 1)
x̂_j = F̂_j⁻¹(û_j)    ← numerical inversion of KDE CDF
```

Clamp output to observed range: `x̂_j = clip(x̂_j, min_j, max_j)`

#### 1.3.2 Categorical Columns — Empirical PMF

```
For each category c in column j:
  p̂_j(c) = count(x = c) / n

Sample: x̂_j ~ Multinomial(1, [p̂_j(c₁), p̂_j(c₂), …])
```

---

### 1.4 Dependency Preservation — Gaussian Copula

#### Step 1: Transform to Uniform Marginals (Probability Integral Transform)

For every column *j* and every record *i*:

```
u_ij = F̂_j(x_ij)

For CONTINUOUS j:  u_ij = empirical CDF rank / n   (ties broken randomly)
For CATEGORICAL j: u_ij = F̂_j(x_ij) − Uniform(0, p̂_j(x_ij))
                          ← randomized for discrete CDF continuity
```

#### Step 2: Transform Uniform to Standard Normal (Probit Transform)

```
z_ij = Φ⁻¹(u_ij)

where Φ⁻¹ = quantile function of N(0,1)
Clamp: u_ij ∈ [1e-6, 1 − 1e-6]  to avoid ±∞
```

This gives a latent matrix **Z** ∈ ℝⁿˣᵈ where each column z_j ~ N(0,1).

#### Step 3: Estimate Latent Correlation Matrix

```
Σ̂ = (1/(n−1)) × Zᵀ Z    (d × d Pearson correlation matrix of Z)
```

Apply **Higham's nearest positive definite projection** if Σ̂ is not PD:
```
Σ̂_PD = nearestPD(Σ̂)
```

*(Eigenvalue floor: replace all λ < 1e-6 with 1e-6, then re-normalize diagonal to 1.)*

#### Step 4: Generate Synthetic Latent Samples

```
Z̃ ~ MVN(0, Σ̂_PD)     ← multivariate normal, shape (n_syn × d)

Using Cholesky decomposition:
  L = cholesky(Σ̂_PD)          ← lower triangular, d × d
  ε ~ N(0, I_d), shape (n_syn × d)
  Z̃ = ε × Lᵀ
```

#### Step 5: Back-transform to Uniform

```
Ũ_ij = Φ(Z̃_ij)
```

#### Step 6: Back-transform to Original Scale (Quantile Matching)

```
For CONTINUOUS j:
  x̃_ij = F̂_j⁻¹(Ũ_ij)   ← KDE quantile function (linear interpolation on sorted observed values)
  x̃_ij = clip(x̃_ij, min_j, max_j)

For CATEGORICAL j:
  x̃_ij = c   such that F̂_j(c⁻) < Ũ_ij ≤ F̂_j(c)
```

---

### 1.5 Full Algorithm (Pseudocode)

```
ALGORITHM: StatisticalSDG(X, n_syn, preserve_correlations)

INPUT:
  X                  ← original dataset (n × d)
  n_syn              ← number of synthetic records to generate
  preserve_correlations ← boolean

OUTPUT:
  X̃                 ← synthetic dataset (n_syn × d)

--- FITTING PHASE ---
1. For each column j in 1..d:
     a. Classify type[j] (CONTINUOUS or CATEGORICAL)
     b. If CONTINUOUS:  fit KDE(X[:,j], bandwidth=silverman(X[:,j]))
     c. If CATEGORICAL: compute PMF p̂_j

2. If preserve_correlations:
     a. Compute U = PIT(X)          ← probability integral transform, n × d
     b. Compute Z = Φ⁻¹(U)          ← probit transform, n × d
     c. Compute Σ̂ = corr(Z)         ← d × d latent correlation matrix
     d. Σ̂_PD = nearestPD(Σ̂)
     e. L = cholesky(Σ̂_PD)

--- GENERATION PHASE ---
3. If preserve_correlations:
     a. ε ~ N(0, I_d), shape (n_syn × d)
     b. Z̃ = ε × Lᵀ
     c. Ũ = Φ(Z̃)                   ← back to uniform, n_syn × d
   Else:
     a. Ũ_ij ~ Uniform(0,1)  independently for all i,j

4. For each column j in 1..d:
     a. If CONTINUOUS:  x̃[:,j] = KDE_quantile(Ũ[:,j])
     b. If CATEGORICAL: x̃[:,j] = PMF_quantile(Ũ[:,j])

5. Apply post-processing:
     a. Round integer columns to nearest integer
     b. Clip to [min_j, max_j] for continuous
     c. Enforce valid category membership for categorical

6. Return X̃
```

---

### 1.6 Sidebar Parameters (Method 1)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| Output Size (%) | Slider 10–200 | 100 | `n_syn = round(n × pct / 100)` |
| Preserve Correlations | Toggle | ON | Enable Gaussian Copula step |
| KDE Bandwidth Rule | Dropdown | Silverman | Silverman / Scott / Fixed |
| Random Seed | Number | 42 | Reproducibility |

---

### 1.7 Output Metrics (Method 1)

**Per-Column Metrics:**

| Metric | Formula | Meaning |
|--------|---------|---------|
| KS Statistic | `KS_j = sup_x |F̂_real(x) − F̂_syn(x)|` | Distributional fidelity; 0 = perfect |
| KS p-value | p from two-sample KS test | p > 0.05 → distributions indistinguishable |
| Wasserstein-1 | `W₁ = ∫|F_real − F_syn| dx` | Earth mover's distance |
| Jensen-Shannon Div | `JSD = ½ KL(P‖M) + ½ KL(Q‖M)` | Symmetric, bounded [0,1] |
| Mean Shift (%) | `(μ̃_j − μ_j) / μ_j × 100` | Bias in mean |
| Std Ratio | `σ̃_j / σ_j` | Variance preservation; 1.0 = perfect |
| Category Freq Error | `Σ_c |p̃(c) − p(c)|` for categorical | Total variation distance on categories |

**Global Metrics:**

| Metric | Formula | Meaning |
|--------|---------|---------|
| Avg Pearson R (Corr Preservation) | `(1/P) Σ_{j<k} |r̂_jk − r̃_jk|` | Mean absolute correlation error |
| Correlation Matrix Frobenius Norm | `‖Σ_real − Σ_syn‖_F` | Matrix-level correlation gap |
| Synthesis Time (s) | wall clock | Performance |
| Privacy Score (DCR) | Distance to Closest Record: `min_i ‖x̃ − xᵢ‖ / max_dist` | Higher = more private |

---

## 2. METHOD 2 — DP-SDG (DP-CTGAN via DP-SGD)

### 2.1 Conceptual Goal

Train a **Conditional Tabular GAN (CTGAN)** with **Differentially Private Stochastic Gradient Descent (DP-SGD)** so that the generator satisfies **(ε, δ)-Differential Privacy**. Any synthetic record produced gives an adversary negligible advantage in inferring whether any real individual's data was in the training set.

---

### 2.2 Differential Privacy Formal Definition

A randomized mechanism **M: D → R** satisfies **(ε, δ)-DP** if for all adjacent datasets D, D' (differing by one record) and all outputs S ⊆ R:

```
Pr[M(D) ∈ S] ≤ exp(ε) × Pr[M(D') ∈ S] + δ
```

- **ε (epsilon):** Privacy budget — smaller = stronger privacy
- **δ (delta):** Failure probability — typically 1/n or 1e-5
- **Adjacent:** D' is D with one record added or removed

---

### 2.3 CTGAN Architecture

#### 2.3.1 Data Transformer

**Mode-Specific Normalization for Continuous Columns (VGM):**

For continuous column *j*, fit a **Variational Gaussian Mixture** with *K* components:
```
p(x) = Σ_k π_k × N(x | μ_k, σ_k²)

K = min(10, unique_values_j / 5),  fitted via EM algorithm
```

For each value x_ij, find the most probable mode k*:
```
k* = argmax_k π_k × N(x_ij | μ_k, σ_k)
```

Encode as:
```
α_ij = (x_ij − μ_{k*}) / (4σ_{k*})    ← normalized value, clipped to [−1,1]
β_ij = one_hot(k*, K)                  ← mode indicator, length K
representation_j = [α_ij | β_ij]       ← length 1+K
```

**Categorical Columns:**
```
representation_j = one_hot(x_ij, C_j)  ← length = number of categories C_j
```

Total input dimension to discriminator:
```
d_input = Σ_j (1 + K_j) for continuous + Σ_j C_j for categorical
```

#### 2.3.2 Conditional Vector Construction

For each training step, sample a **conditional vector** cond:
- Pick a random discrete column *j* with probability proportional to its log-frequency.
- Sample a value *c* ~ PMF_j
- cond = one_hot(c, C_j)  (length = C_j, zero-padded to max category size)

This forces the generator to produce samples conditioned on specific category values, preventing mode collapse.

#### 2.3.3 Generator Architecture

```
Input: z ~ N(0, I_{z_dim}),  cond  [concatenated]
       z_dim = 128  (default)

Layer 1: Linear(z_dim + |cond|, 256) → BatchNorm → ReLU → Dropout(0.5)
Layer 2: Linear(256, 256)            → BatchNorm → ReLU → Dropout(0.5)
Layer 3: Linear(256, d_input)        → column-specific activations:
           continuous α  → tanh
           continuous β  → gumbel_softmax(τ=0.2)
           categorical   → gumbel_softmax(τ=0.2)
```

#### 2.3.4 Discriminator Architecture (Critic — No BN for DP)

```
Input: [x_transformed | cond]   dimension = d_input + |cond|

Layer 1: Linear(d_input + |cond|, 256) → LeakyReLU(0.2) → Dropout(0.5)
Layer 2: Linear(256, 256)              → LeakyReLU(0.2) → Dropout(0.5)
Layer 3: Linear(256, 1)                → Sigmoid   (WGAN-GP uses no sigmoid)

NOTE: NO BatchNorm in discriminator — BatchNorm breaks DP per-sample gradient isolation.
```

---

### 2.4 DP-SGD Algorithm (Abadi et al., 2016)

DP-SGD modifies the discriminator's training loop to add privacy:

#### Step 1: Per-Sample Gradient Computation

For mini-batch B = {x₁, …, x_B} and discriminator loss L:
```
For each xᵢ in B:
  gᵢ = ∇_θ L(θ; xᵢ)    ← per-sample gradient (NOT averaged)
```

#### Step 2: Gradient Clipping (Sensitivity Bounding)

```
g̃ᵢ = gᵢ / max(1, ‖gᵢ‖₂ / C)

where C = gradient clipping norm (hyperparameter)
      ‖gᵢ‖₂ ≤ C  is guaranteed after clipping
```

This bounds the **L2 sensitivity** of the gradient sum: Δf = C.

#### Step 3: Noise Addition (Gaussian Mechanism)

```
g̃_noisy = (1/B) × [Σᵢ g̃ᵢ  +  N(0, σ²C²I)]

where σ = noise multiplier (calibrated from ε, δ via RDP accountant)
```

#### Step 4: Parameter Update

```
θ ← θ − η × g̃_noisy     ← standard SGD/Adam step with noisy gradient
```

**Only the discriminator is trained with DP-SGD. The generator is trained with standard SGD** (generator parameters don't touch real data directly — they receive gradients from the discriminator which has already been privatized).

---

### 2.5 Privacy Accounting — Rényi Differential Privacy (RDP)

We use **Rényi DP** for tight composition, then convert to (ε, δ)-DP.

**Rényi Divergence of Gaussian Mechanism:**
```
RDP_step(α) = α / (2σ²)    for one step, one sample (subsampled)

With Poisson subsampling ratio q = B/n:
RDP_subsampled(α) ≈ (1/α-1) × log[
    (1-q)^α + α×q×(1-q)^(α-1) × exp((α-1)/(2σ²)) + O(q²)
]
```

**Composition over T steps:**
```
RDP_total(α) = T × RDP_subsampled(α)   ← simple composition
```

**Convert RDP to (ε, δ)-DP:**
```
ε(δ) = min_{α > 1} [ RDP_total(α) + log(1/δ) / (α-1) ]
```

This is minimized numerically over α ∈ {2, 3, …, 64, 128, 256}.

**Calibrating σ from ε, δ:**
```
Given target ε, δ, T, n, B:
Binary search σ ∈ [0.1, 100] such that ε(δ, σ, T, B, n) = ε_target
```

---

### 2.6 CTGAN Training Loss

**Discriminator Loss (WGAN with Gradient Penalty):**
```
L_D = E[D(x̃)] − E[D(x)]  +  λ × GP

GP = E[(‖∇_x̂ D(x̂)‖₂ − 1)²]
x̂ = t×x + (1−t)×x̃,  t ~ Uniform(0,1)    ← interpolated samples
λ = 10  (gradient penalty coefficient)

DP-SGD clips & noises gradients of L_D before update.
```

**Generator Loss:**
```
L_G = −E[D(G(z, cond))]
    + λ_cond × CrossEntropy(G_cat(z, cond), cond)   ← conditional loss

λ_cond = 1.0  (conditional reconstruction weight)
```

**Training Schedule:**
```
n_critic = 1   ← discriminator updates per generator update (reduced for DP efficiency)
For epoch e in 1..epochs:
  For step s in 1..steps_per_epoch:
    For _ in range(n_critic):
      Sample B real records + conditional vector
      Compute L_D, apply DP-SGD to discriminator
    Sample z ~ N(0,I), conditional vector
    Compute L_G, standard backprop to generator
```

---

### 2.7 Privacy Budget Calculation Display

Show the user **real-time computed ε** as parameters change:

```
Display Panel:
  Target ε (input)     : [slider value]
  Target δ (input)     : [radio value]
  Required σ           : [computed via binary search]
  Actual ε achieved    : [computed via RDP accountant]
  Privacy-Utility Index: [1 − ε/10, capped 0–1]   ← rough indicator
```

---

### 2.8 Full DP-SDG Algorithm (Pseudocode)

```
ALGORITHM: DP_SDG(X, n_syn, ε, δ, C, epochs, batch_size, z_dim)

INPUT:
  X          ← original dataset (n × d)
  n_syn      ← synthetic records to generate
  ε          ← privacy budget
  δ          ← failure probability
  C          ← gradient clipping norm
  epochs     ← training epochs
  batch_size ← B
  z_dim      ← latent dimension (default 128)

OUTPUT:
  X̃         ← synthetic dataset (n_syn × d)
  ε_actual   ← empirical privacy expenditure

--- PREPROCESSING ---
1. T = DataTransformer()
   T.fit(X)          ← fit VGM per continuous col, PMF per categorical
   X_enc = T.transform(X)           ← encoded training data

2. Calibrate σ:
   σ = binary_search(ε, δ, C, epochs × ceil(n/B), n, B)

--- ARCHITECTURE INIT ---
3. G = Generator(z_dim, d_encoded, hidden=256)
4. D = Discriminator(d_encoded, hidden=256)      ← no BatchNorm
5. opt_G = Adam(G.params, lr=2e-4, β=(0.5, 0.999))
6. opt_D = Adam(D.params, lr=2e-4, β=(0.5, 0.999))

--- TRAINING LOOP ---
7. For epoch in 1..epochs:
     For step in 1..ceil(n/B):
       
       [DISCRIMINATOR UPDATE — DP-SGD]
       a. Sample mini-batch {x₁,..,x_B} from X_enc
       b. Sample conditional vector cond ~ conditional_sampler
       c. z ~ N(0, I_{z_dim})
       d. x̃ = G(z, cond)                   ← fake batch
       e. For each xᵢ in {x₁,..,x_B}:
            gᵢ = ∇_θ_D L_D(θ_D; xᵢ, x̃)   ← per-sample gradient
            g̃ᵢ = gᵢ / max(1, ‖gᵢ‖₂ / C)  ← clip
       f. g̃_sum = Σᵢ g̃ᵢ
       g. g̃_noisy = (1/B)(g̃_sum + N(0, σ²C²I))  ← add noise
       h. θ_D ← θ_D − η × g̃_noisy              ← update discriminator

       [GENERATOR UPDATE — standard backprop]
       i. z ~ N(0, I_{z_dim}),  cond ~ conditional_sampler
       j. x̃ = G(z, cond)
       k. g_G = ∇_θ_G L_G(θ_G; x̃)
       l. θ_G ← θ_G − η × g_G

8. ε_actual = RDP_accountant(σ, C, B, n, total_steps, δ)

--- GENERATION ---
9. X̃_enc = []
   While len(X̃_enc) < n_syn:
     z ~ N(0, I_{z_dim}),  cond ~ conditional_sampler
     x̃_batch = G(z, cond)
     X̃_enc.append(x̃_batch)

10. X̃ = T.inverse_transform(X̃_enc[:n_syn])
11. Return X̃, ε_actual
```

---

### 2.9 Sidebar Parameters (Method 2)

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| Output Size (%) | Slider | 100 | 10–500 | n_syn |
| Privacy Budget ε | Slider | 1.0 | 0.1–10.0 | Lower = stronger privacy |
| Delta δ | Radio | 1×10⁻⁵ | 1e-5 / 1e-6 | Failure probability |
| Gradient Clipping Norm C | Slider | 1.0 | 0.1–5.0 | Sensitivity bound |
| Training Epochs | Number | 300 | 50–1000 | Generator training epochs |
| Batch Size | Number | 500 | 64–2048 | Mini-batch size B |
| Latent Dim z | Number | 128 | 64–256 | Generator noise dimension |
| Random Seed | Number | 42 | — | Reproducibility |

**Live-computed read-only display:**
- Required Noise Multiplier σ
- Actual ε achieved (from RDP accountant)
- Total Training Steps = epochs × ⌈n/B⌉

---

### 2.10 Output Metrics (Method 2)

**Privacy Metrics:**

| Metric | Formula | Meaning |
|--------|---------|---------|
| Achieved ε | RDP accountant output | Formal DP guarantee |
| δ | User-set | Failure probability |
| Noise Multiplier σ | Calibrated value | Gaussian noise scale |
| MIA AUC | Membership Inference Attack AUC via shadow model | AUC ≈ 0.5 → indistinguishable |
| Attribute Inference Risk | Probability attacker recovers sensitive attr | Lower = better |

**Utility Metrics (same as Method 1 + training diagnostics):**

| Metric | Formula | Meaning |
|--------|---------|---------|
| KS Statistic per column | `sup_x |F_real − F_syn|` | Marginal fidelity |
| Wasserstein-1 per column | Earth mover's distance | Distribution distance |
| JSD | Jensen-Shannon divergence | Symmetric distribution distance |
| Correlation Matrix Error | `‖Σ_real − Σ_syn‖_F` | Dependency preservation |
| Mean Shift % | `(μ̃ − μ)/μ × 100` | Bias |
| Generator Loss Curve | L_G over epochs | Training convergence |
| Discriminator Loss Curve | L_D over epochs | Training convergence |

---

## 3. SHARED COMPONENTS

### 3.1 Post-Processing Pipeline

```
After any SDG method generates X̃:

For each column j:
  IF type[j] == INTEGER:
    X̃[:,j] = round(X̃[:,j]).astype(int)
    X̃[:,j] = clip(X̃[:,j], min_j, max_j)
  
  IF type[j] == FLOAT:
    X̃[:,j] = clip(X̃[:,j], min_j, max_j)
    decimals_j = infer_decimal_places(X[:,j])
    X̃[:,j] = round(X̃[:,j], decimals_j)
  
  IF type[j] == CATEGORICAL:
    valid_cats = set(X[:,j].unique())
    X̃[:,j] = X̃[:,j].apply(lambda v: v if v in valid_cats else mode_j)
  
  IF type[j] == DATE:
    X̃[:,j] = round_to_valid_date(X̃[:,j])
```

### 3.2 Privacy Score — Distance to Closest Record (DCR)

```
For each synthetic record x̃ᵢ:
  DCR_i = min_{j=1..n} dist(x̃ᵢ, x_j)

dist(a, b):
  For continuous cols: (a_k − b_k)² / range_k²   ← normalized squared diff
  For categorical cols: 0 if a_k == b_k, else 1
  dist = sqrt(Σ_k weighted_diff_k)

Privacy Score = mean(DCR) / max(pairwise dist in real data)
  → 0 = synthetic records copy real records (BAD)
  → 1 = synthetic records are far from all real records (GOOD)
```

### 3.3 Utility Score — Distinguishability (Train-on-Synthetic Test-on-Real)

```
1. Train RandomForest classifier on:
     - Real records   → label 0
     - Synthetic records → label 1
2. Evaluate AUC on held-out mix of real + synthetic
3. Utility Score = 2 × (1 − AUC)   ← 1.0 = indistinguishable, 0 = totally different
```

---

## 4. HTML REPORT STRUCTURE

When user clicks "Download Report (HTML)", generate a self-contained HTML with:

```
SDG REPORT
==========

Section 1: Configuration Summary
  - Method used, all parameters, dataset name, n_real, n_syn

Section 2: Privacy Summary
  [Method 1] Privacy Score (DCR), Distinguishability AUC
  [Method 2] ε achieved, δ, σ, MIA AUC, Privacy Score

Section 3: Per-Column Utility Analysis
  - Table: Column | Type | KS Stat | KS p-val | Wasserstein-1 | JSD | Mean Shift% | Std Ratio
  - Inline SVG charts: side-by-side distribution histograms (real vs synthetic) per column

Section 4: Correlation Analysis
  - Heatmap: real correlation matrix
  - Heatmap: synthetic correlation matrix
  - Difference heatmap |Σ_real − Σ_syn|
  - Frobenius norm error

Section 5: Global Utility Summary
  - Average KS Statistic
  - Average Wasserstein-1
  - Average JSD
  - Correlation Frobenius Error
  - Distinguishability Score

[Method 2 Only] Section 6: Training Diagnostics
  - Generator loss curve (line chart)
  - Discriminator loss curve (line chart)
  - Privacy budget consumption over steps

Section 7: Sample Output (First 10 records of synthetic data, styled table)

Section 8: Recommendations
  - Auto-generated text:
    IF KS_avg > 0.2:  "Consider increasing Output Size or adjusting bandwidth"
    IF ε > 5.0:       "High privacy budget — consider reducing ε for stronger guarantees"
    IF DCR < 0.1:     "WARNING: Synthetic records closely mirror real records — risk of memorization"
    IF corr_error > 0.3: "Correlation structure not well preserved — enable Preserve Correlations or increase epochs"
```

---

## 5. TARGET COLUMNS — UI RECOMMENDATION

**REMOVE** the Target Columns sidebar panel when the active tab is **Synthetic Data Generation**.

Rationale: SDG operates on the **full schema** — it generates a complete synthetic table. Unlike SDC (suppression/generalization which can target specific columns) or DP (Laplace noise which can be column-selective), SDG must jointly model all columns to produce coherent records.

If users need column subsetting, offer a **"Columns to Include in Synthetic Dataset"** checkbox list in the parameters panel instead (default: all selected), which simply drops excluded columns before fitting and re-attaches them as-is (or drops them from output).

---

## 6. TECH STACK RECOMMENDATIONS

| Component | Library |
|-----------|---------|
| KDE, PIT, Copula | `scipy.stats`, `numpy` |
| Nearest PD Matrix | `numpy` eigenvalue decomposition |
| VGM fitting | `sklearn.mixture.BayesianGaussianMixture` |
| CTGAN neural net | `torch` (PyTorch) |
| DP-SGD | `opacus` (Facebook's DP library for PyTorch) |
| RDP Accountant | `opacus.accountants.RDPAccountant` |
| Metrics | `scipy.stats.ks_2samp`, `scipy.stats.wasserstein_distance` |
| MIA | Shadow model via `sklearn.ensemble.RandomForestClassifier` |
| HTML Report | Jinja2 template + inline Chart.js |

---

## 7. IMPLEMENTATION ORDER

```
Priority 1 — Statistical SDG (Method 1):
  [x] Column type classifier
  [x] KDE marginal fitter (Silverman bandwidth)
  [x] Empirical PMF for categorical
  [x] PIT → Probit transform → Correlation matrix
  [x] Cholesky sampling → back-transform
  [x] Post-processing pipeline
  [x] Metrics computation
  [x] HTML report generator

Priority 2 — DP-SDG (Method 2):
  [x] DataTransformer (VGM + one-hot)
  [x] Conditional sampler
  [x] Generator + Discriminator networks (no BN in D)
  [x] DP-SGD training loop via Opacus
  [x] RDP accountant + σ calibration
  [x] Generation loop
  [x] Inverse transform
  [x] All metrics including MIA AUC
  [x] Extended HTML report with loss curves

Priority 3 — UI Updates:
  [x] Remove Target Columns panel for SDG tab
  [x] Add per-method sidebar parameters
  [x] Live ε display (Method 2)
  [x] Download CSV + Download HTML Report buttons
```

---

*Document Version: 1.0 | Statathon 2025 | AIRAVATA Technologies | MoE Innovation Cell*
