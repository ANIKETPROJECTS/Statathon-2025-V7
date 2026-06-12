# Risk Assessment Module — Differencing Attack: Complete Specification

> **For Replit Agent**: This document defines the complete implementation for the **Differencing Attack** in the Risk Assessment module. It follows the same structure as the Prosecutor, Record Linkage, and Attribute Disclosure attack specs. Replace all mock/placeholder logic for this attack with the accurate implementations described below. This document covers: what a Differencing attack is, the mathematical model, the full algorithm in code, and the complete UI output format for the results panel.

---

## 1. What is a Differencing Attack?

### 1.1 Threat Model

The **Differencing Attack** models an adversary who:

1. Has access to a **statistical summary or aggregated query interface** over the dataset (e.g., count queries, sum queries, average queries) — NOT the raw microdata directly.
2. Issues **two carefully chosen queries** that differ by exactly one individual's record.
3. **Subtracts** the two query results to isolate and infer the sensitive attribute value of that one individual.
4. The attacker never sees any individual record directly — they exploit the **difference between aggregate outputs** to reverse-engineer a single person's data.

**This attack targets aggregate releases and query interfaces — not just raw data releases.**

Even if raw data is never published, a differencing attack can succeed on:
- Summary statistics tables (e.g., "Average income in District D04")
- Counts published at different granularities
- Before/after snapshots of aggregated data
- Pivot tables or cross-tabulations

### 1.2 Real-World Example

Suppose a government dataset publishes these two aggregate queries:

```
Query A: Average income of people in District D04, Age 30-40, Gender=Male
         → Result: ₹42,000   (based on 6 people)

Query B: Average income of people in District D04, Age 30-40, Gender=Male
         EXCLUDING person X (i.e., the attacker knows person X is in this group)
         → Result: ₹38,000   (based on 5 people)
```

The attacker computes:
```
Person X's income = (Query_A × 6) − (Query_B × 5)
                  = (42,000 × 6) − (38,000 × 5)
                  = 252,000 − 190,000
                  = ₹62,000
```

Person X's income has been **exactly reconstructed** from two aggregate queries — without ever accessing the raw record.

### 1.3 The Two Variants of Differencing

#### Variant 1: Count-Based Differencing
```
Query_1: COUNT(*) WHERE [QI conditions including target]
Query_2: COUNT(*) WHERE [QI conditions excluding target]

Difference = 1  →  attacker confirms target is in the dataset
             0  →  attacker confirms target is NOT in the dataset
```
This is equivalent to a **membership inference** on aggregate counts.

#### Variant 2: Aggregate-Based Differencing (SA Reconstruction)
```
Query_1: SUM / AVG / COUNT of SA WHERE [group containing target] → R₁  (n₁ records)
Query_2: SUM / AVG / COUNT of SA WHERE [group excluding target]  → R₂  (n₂ = n₁ - 1 records)

For SUM:  Target_SA = R₁ - R₂
For AVG:  Target_SA = (R₁ × n₁) - (R₂ × n₂)
For COUNT of SA value v:  Target_SA = R₁ - R₂  (1 if target has value v, 0 otherwise)
```

### 1.4 Why This Attack is Unique

| Property | Other Attacks | Differencing Attack |
|---|---|---|
| Requires raw data access? | Yes | ❌ No — works on aggregates |
| Defeated by k-anonymity? | Partially | ❌ No |
| Defeated by l-diversity? | No | ❌ No |
| Defeated by large group sizes? | Yes | Only partially — small groups amplify risk |
| Protection mechanism | Large ECs | **Differential Privacy / Query Auditing / Noise addition** |
| Risk driver | EC size = 1 | **EC size = 1 AND small ECs at boundary conditions** |

---

## 2. Core Concepts

### 2.1 Differencing Vulnerability Condition

A record `r` is **vulnerable to a differencing attack** if:

```
Condition 1 (Exact): EC size of record r = 1
  → The attacker queries with and without the QI combination of r.
  → The difference directly reveals r's SA value with certainty.

Condition 2 (Near-Singleton): EC size = 2 or 3
  → Attacker issues a query on the small EC and a query on the EC minus one person.
  → Difference isolates the target with high precision.

Condition 3 (Boundary EC):
  → Two overlapping QI-defined groups where the target is in the intersection.
  → Subtraction of counts or sums isolates the target.
```

### 2.2 Differencing Risk Per Record

```
If |EC(r)| = 1:
    Differencing_Risk(r) = 1.0   ← SA reconstructed exactly

If |EC(r)| = 2:
    Differencing_Risk(r) = 0.90  ← near-certain (attacker gets 50/50 of 2 records, 
                                     combined with auxiliary info narrows further)

If |EC(r)| = 3:
    Differencing_Risk(r) = 0.70

General formula for small ECs:
    Differencing_Risk(r) = 1 / |EC(r)|   for exact reconstruction
                         ≈ max(1/|EC(r)|, 1 - (|EC(r)| - 1)/|EC(r)|)
```

For practical implementation, use the simplified model:

```python
def differencing_risk(ec_size):
    if ec_size == 1:
        return 1.00   # Certain SA reconstruction
    elif ec_size == 2:
        return 0.75   # High risk — small group, easy to isolate
    elif ec_size == 3:
        return 0.50   # Moderate — 2 others to confuse signal
    elif ec_size < k:
        return 1 / ec_size   # Below k-threshold
    else:
        return max(0.05, 1 / ec_size)   # Protected but never fully zero
```

### 2.3 Aggregate Reconstruction Error (ARE)

When the attacker uses the AVG-based differencing formula, the **reconstruction error** depends on EC size:

```
Reconstruction_Error = σ_SA / √(|EC|)

Where σ_SA = standard deviation of the sensitive attribute across the dataset.
```

- For `|EC| = 1`: Error = 0 (exact reconstruction)
- For `|EC| = 5`: Error = σ/√5 ≈ 44% of σ (still quite precise)
- For `|EC| ≥ 100`: Error ≈ σ/10 (noise becomes meaningful)

**Threshold for "safe" reconstruction:**
```
EC is safe from differencing if:
    Reconstruction_Error > 0.1 × global_range(SA)
    i.e., |EC| > 100 × (σ²/ (0.1 × range)²)
```

### 2.4 Dataset-Level Differencing Risk (DDR)

```
DDR = (1/N) × Σᵣ Differencing_Risk(r)
```

This is the **expected fraction of sensitive attribute values** that an attacker with aggregate query access could reconstruct.

### 2.5 Reconstruction Coverage

```
Exact_Reconstruction_Count   = records where |EC| = 1
Near_Exact_Count             = records where |EC| ≤ 3
Below_Threshold_Count        = records where |EC| < k
Protected_Count              = records where |EC| ≥ k
```

---

## 3. Mathematical Model — Differencing Attack

### 3.1 Core Reconstruction Formula (For Numeric SA)

Given:
- Group G₁ = EC of target (size n₁)
- Group G₂ = G₁ minus target (size n₂ = n₁ − 1)
- SUM(G₁) = s₁, SUM(G₂) = s₂

Then:
```
Target_SA_value = SUM(G₁) − SUM(G₂) = s₁ − s₂
```

For AVG:
```
Target_SA_value = AVG(G₁) × n₁ − AVG(G₂) × n₂
                = AVG(G₁) × n₁ − AVG(G₂) × (n₁ − 1)
```

For COUNT of a binary SA value v (e.g., Disease = Diabetic: Yes/No):
```
Target_has_v = COUNT(G₁ where SA=v) − COUNT(G₂ where SA=v)
             = 1   →  target has SA = v
             = 0   →  target does NOT have SA = v
```

### 3.2 Noise Sensitivity (How Much Noise Needed to Block This Attack)

To block exact differencing, any published aggregate must have **noise added with standard deviation at least**:

```
Required_Noise_Std = SA_sensitivity / ε

Where:
  SA_sensitivity = global_max(SA) − global_min(SA)   (for numeric SA)
                 = 1                                   (for binary SA)
  ε              = privacy budget (lower = more private)
```

For **Laplace Mechanism** (standard differential privacy):
```
Noise ~ Laplace(0, SA_sensitivity / ε)
```

This spec computes the required noise level for each SA and EC combination and reports it as a **noise sufficiency metric**.

### 3.3 Differencing Risk Score (0–100) for Badge Display

```
Differencing_Risk_Score = DDR × 100

Badge colour:
  🔴  > 20  — HIGH: Over 1-in-5 SA values reconstructable via differencing
  🟡  5–20  — MEDIUM: Partial differencing risk
  🟢  < 5   — LOW: Dataset is well-protected against differencing
```

### 3.4 Amplification Through Multiple Queries

An attacker can issue multiple differencing queries to reconstruct multiple individuals:

```
Max_Reconstructable_Records = Exact_Reconstruction_Count + Near_Exact_Count
Coverage_Rate = Max_Reconstructable_Records / N × 100
```

---

## 4. Full Differencing Attack Algorithm (Step by Step)

```python
def differencing_attack(dataframe, quasi_identifiers, sensitive_attributes, k, l, t, sample_size_pct):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct / 100, random_state=42)
    N = len(df)

    # Step 2: Build Equivalence Classes
    ec_groups = df.groupby(quasi_identifiers)
    ec_sizes = ec_groups.size().reset_index(name='ec_size')
    df = df.merge(ec_sizes, on=quasi_identifiers, how='left')

    # Step 3: Per-record differencing risk
    def diff_risk(ec_size):
        if ec_size == 1:
            return 1.00
        elif ec_size == 2:
            return 0.75
        elif ec_size == 3:
            return 0.50
        elif ec_size < k:
            return round(1 / ec_size, 4)
        else:
            return round(max(0.05, 1 / ec_size), 4)

    df['diff_risk'] = df['ec_size'].apply(diff_risk)

    # Step 4: Differencing vulnerability label
    df['diff_label'] = df['ec_size'].apply(
        lambda s: 'Exact Reconstruction' if s == 1
                  else 'Near-Exact' if s <= 3
                  else 'Partial' if s < k
                  else 'Protected'
    )

    df['at_risk'] = df['ec_size'] < k

    # Step 5: Dataset-level metrics
    exact_count = (df['ec_size'] == 1).sum()
    near_exact_count = ((df['ec_size'] > 1) & (df['ec_size'] <= 3)).sum()
    partial_count = ((df['ec_size'] >= 4) & (df['ec_size'] < k)).sum()
    protected_count = (df['ec_size'] >= k).sum()

    ddr = df['diff_risk'].mean()
    coverage_rate = (exact_count + near_exact_count) / N * 100
    distinct_ecs = df.groupby(quasi_identifiers).ngroups
    min_k = df['ec_size'].min()
    avg_ec_size = df['ec_size'].mean()

    # Step 6: Per-SA reconstruction analysis (for numeric/binary SAs)
    sa_reconstruction = {}
    for sa in sensitive_attributes:
        sa_vals = df[sa]
        is_numeric = pd.api.types.is_numeric_dtype(sa_vals)

        if is_numeric:
            sa_range = sa_vals.max() - sa_vals.min()
            sa_std = sa_vals.std()
            # Reconstruction error per EC
            ec_recon = ec_groups[sa].agg(['mean', 'std', 'count']).reset_index()
            ec_recon.columns = quasi_identifiers + ['sa_mean', 'sa_std', 'sa_count']
            ec_recon['recon_error'] = sa_std / (ec_recon['sa_count'] ** 0.5)
            ec_recon['recon_error_pct'] = ec_recon['recon_error'] / sa_range * 100 if sa_range > 0 else 0
            exact_recon_ecs = (ec_recon['sa_count'] == 1).sum()
            # Required noise for DP
            required_noise_std = sa_range  # sensitivity for Laplace at ε=1
        else:
            sa_range = None
            sa_std = None
            exact_recon_ecs = (df['ec_size'] == 1).sum()
            required_noise_std = 1  # binary SA sensitivity = 1

        sa_reconstruction[sa] = {
            'is_numeric': is_numeric,
            'sa_range': sa_range,
            'sa_std': sa_std,
            'exact_recon_ecs': int(exact_recon_ecs),
            'required_noise_std': required_noise_std,
            'exact_recon_records': int(exact_count)
        }

    # Step 7: L-Diversity check per SA
    l_div_results = {}
    for sa in sensitive_attributes:
        l_vals = ec_groups[sa].nunique().reset_index(name='l_diversity')
        l_div_results[sa] = {
            'min_l': l_vals['l_diversity'].min(),
            'violating_ecs': (l_vals['l_diversity'] < l).sum(),
            'total_ecs': len(l_vals)
        }

    # Step 8: T-Closeness check per SA
    t_close_results = {}
    for sa in sensitive_attributes:
        global_dist = df[sa].value_counts(normalize=True)
        max_distance = 0
        violating_ecs = 0
        for name, group in ec_groups:
            local_dist = group[sa].value_counts(normalize=True)
            all_values = set(global_dist.index) | set(local_dist.index)
            tvd = 0.5 * sum(abs(local_dist.get(v, 0) - global_dist.get(v, 0)) for v in all_values)
            max_distance = max(max_distance, tvd)
            if tvd > t:
                violating_ecs += 1
        t_close_results[sa] = {
            'max_distance': round(max_distance, 4),
            'violating_ecs': violating_ecs,
            'total_ecs': distinct_ecs
        }

    # Step 9: Top vulnerable records
    top_vulnerable = df.sort_values('diff_risk', ascending=False).head(10)

    return {
        'N': N,
        'ddr': ddr,
        'diff_risk_score': ddr * 100,
        'exact_count': int(exact_count),
        'near_exact_count': int(near_exact_count),
        'partial_count': int(partial_count),
        'protected_count': int(protected_count),
        'coverage_rate': coverage_rate,
        'distinct_ecs': distinct_ecs,
        'min_k': min_k,
        'avg_ec_size': avg_ec_size,
        'sa_reconstruction': sa_reconstruction,
        'l_div_results': l_div_results,
        't_close_results': t_close_results,
        'df_with_scores': df,
        'top_vulnerable': top_vulnerable
    }
```

---

## 5. UI Results Panel — All Required Sections

The right-hand panel must render all sections below after the assessment runs. All numbers are dynamic — computed from the algorithm above. No hardcoded values.

---

### 5.1 Plain-English Summary Card (Top of Panel)

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔴  Differencing Attack Risk: HIGH                                   │
│                                                                      │
│  An attacker with access to aggregate query results (counts,         │
│  sums, averages) over this dataset could reconstruct the sensitive   │
│  attribute values of [exact_count] individuals exactly, and          │
│  approximate values for [near_exact_count] more.                     │
│                                                                      │
│  This attack does NOT require access to raw records. It works by     │
│  issuing two overlapping queries and subtracting the results to      │
│  isolate a single person's data. [coverage_rate]% of this dataset   │
│  is reconstructable via differencing.                                │
│                                                                      │
│  k-anonymity and l-diversity do NOT prevent this attack.             │
│  Differential Privacy noise addition is required.                   │
│                                                                      │
│  Results based on [N] rows ([sample_pct]% sample) |                  │
│  QIs used: [QI names] | SAs assessed: [SA names]                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Badge colour rule:**
- 🔴 `DDR > 0.20` → HIGH
- 🟡 `0.05 ≤ DDR ≤ 0.20` → MEDIUM
- 🟢 `DDR < 0.05` → LOW

---

### 5.2 Key Metrics Row

Display as horizontal metric cards:

| Metric | Value | Status |
|--------|-------|--------|
| **Dataset Differencing Risk (DDR)** | `[DDR × 100]%` | 🔴/🟡/🟢 |
| **Exact Reconstruction** | `[exact_count] records` | 🔴 if > 0 |
| **Near-Exact Reconstruction** | `[near_exact_count] records` | 🟠 if > 0 |
| **Total Reconstructable** | `[exact + near_exact] ([coverage_rate]%)` | 🔴/🟡 |
| **Min EC Size** | `[min_k]` | 🔴 if < user_k |
| **Avg EC Size** | `[avg_ec_size]` | Informational |

**Tooltip on DDR:**
> "The expected fraction of sensitive attribute values that an attacker issuing differencing queries could correctly reconstruct. This applies to any aggregate release of this data — not just the raw records."

---

### 5.3 Vulnerability Distribution (Donut Chart)

Four-segment donut using actual counts:

| Segment | Condition | Count | Colour |
|---------|-----------|-------|--------|
| Exact Reconstruction | `ec_size = 1` | `[exact_count]` | 🔴 Red |
| Near-Exact | `ec_size = 2–3` | `[near_exact_count]` | 🟠 Orange |
| Partial | `4 ≤ ec_size < k` | `[partial_count]` | 🟡 Yellow |
| Protected | `ec_size ≥ k` | `[protected_count]` | 🟢 Green |

**Tooltip per segment:**
- **Exact Reconstruction:** EC size = 1. Two queries — one including, one excluding this record — reveal the SA value exactly. Zero error.
- **Near-Exact:** EC size 2–3. Attacker achieves 50–75% accuracy via differencing. Auxiliary knowledge closes the gap further.
- **Partial:** EC below k-threshold. Differencing is imprecise but still extracts signal.
- **Protected:** EC size ≥ k. Noise from other group members makes differencing imprecise — but not impossible without DP.

---

### 5.4 Record-Level Differencing Trace Table

One row per record, paginated at 50 rows.

**Columns:**
| Column | Content |
|--------|---------|
| Row # | Original row index |
| [QI₁] ... [QIₙ] | Actual QI values |
| EC Size | Records sharing this QI combination |
| Diff. Risk Score | Risk value (1.00 / 0.75 / 0.50 / ...) |
| Vulnerability Label | Exact Reconstruction / Near-Exact / Partial / Protected |
| Query Pair Possible? | Yes / No (Yes if ec_size ≤ 3) |
| Status | 🔴 At Risk / 🟢 Protected |

**Header definitions:**
- **Diff. Risk Score**: Probability that an attacker using two differencing queries can correctly reconstruct this record's sensitive attribute value.
- **Query Pair Possible?**: Whether the attacker can construct a valid pair of aggregate queries that isolates this individual.
- **Vulnerability Label**: Exact Reconstruction (1.00) / Near-Exact (0.75) / Partial (<1/k) / Protected (≥k).

**Filter bar:**
```
[ Show All ] [ 🔴 Exact ] [ 🟠 Near-Exact ] [ 🟡 Partial ] [ 🟢 Protected ]   Search: [___]
```

**Export button:** "Download Full Table (CSV)"

---

### 5.5 Attack Simulation Narrative — "How the Attack Works on YOUR Data"

Walkthrough using **actual values from the most vulnerable record**:

```
DIFFERENCING ATTACK SIMULATION — Step by Step

Step 1 — Setup
  The attacker has access to a query interface over this dataset.
  They do NOT have access to individual records.
  They know that person X has these quasi-identifier values:
    [QI₁] = [val₁]
    [QI₂] = [val₂]
    [QI₃] = [val₃]
    ...

Step 2 — Query 1 (Full Group)
  Attacker issues: SELECT [AVG / SUM / COUNT] of [SA_name]
                   WHERE [QI₁]=[val₁] AND [QI₂]=[val₂] AND [QI₃]=[val₃]
  
  Result: [query_result_1]   (based on [EC_size] records)

Step 3 — Query 2 (Group Minus Target)
  Attacker issues: SELECT [AVG / SUM / COUNT] of [SA_name]
                   WHERE [QI₁]=[val₁] AND [QI₂]=[val₂] AND [QI₃]=[val₃]
                   AND Record_ID != [target_ID]   
                   ← (attacker uses any known auxiliary fact to exclude target)
  
  Result: [query_result_2]   (based on [EC_size - 1] records)

Step 4 — Reconstruction via Subtraction
  Person X's [SA_name] = (Query_1 × [EC_size]) − (Query_2 × [EC_size - 1])
                        = ([query_result_1] × [EC_size]) − ([query_result_2] × [EC_size - 1])
                        = [reconstructed_SA_value]
  
  ✅ Attack successful. Person X's [SA_name] = [reconstructed_SA_value]
     Reconstructed with [diff_risk × 100]% certainty.

Step 5 — Scale
  Records reconstructable with certainty (EC=1):  [exact_count]
  Records reconstructable with high accuracy:      [exact_count + near_exact_count]
  Coverage rate:                                   [coverage_rate]%
  
  An attacker with query access could reconstruct the sensitive
  attributes of [coverage_rate]% of this dataset without ever
  seeing a single raw record.
```

---

### 5.6 Equivalence Class Size Distribution (Chart + Table)

**Table:**
| EC Size | Number of ECs | Number of Records | % of Dataset | Differencing Risk |
|---------|---------------|-------------------|--------------|-------------------|
| 1 (Exact) | [count] | [records] | [pct]% | 🔴 Certain reconstruction |
| 2–3 (Near-Exact) | [count] | [records] | [pct]% | 🟠 High accuracy |
| 4–(k-1) (Partial) | [count] | [records] | [pct]% | 🟡 Partial signal |
| k–10 (Protected) | [count] | [records] | [pct]% | 🟢 Protected |
| >10 (Safe) | [count] | [records] | [pct]% | 🟢 Safe |

**Chart:** Horizontal bar chart.
- Colour coded as above.
- Dashed vertical line at EC size = k, labelled "Your k-threshold".
- Second dashed line at EC size = 3, labelled "Near-Exact Reconstruction Boundary".

---

### 5.7 SA Reconstruction Analysis (Per Sensitive Attribute)

For **each numeric sensitive attribute**, show reconstruction precision:

```
SA Reconstruction Analysis — [SA_NAME]

Type: [Numeric / Categorical / Binary]

For Numeric SA:
  Global range:              [min] – [max]  (range = [sa_range])
  Global std deviation:      [sa_std]
  
  Reconstruction Error by EC Size:
  ┌──────────┬──────────────────┬───────────────────┬──────────┐
  │ EC Size  │ Recon. Error (σ) │ Error as % of Range│ Verdict  │
  ├──────────┼──────────────────┼───────────────────┼──────────┤
  │ 1        │ 0                │ 0%                │ 🔴 Exact  │
  │ 2        │ σ/√2 = [val]     │ [pct]%            │ 🔴 High   │
  │ 3        │ σ/√3 = [val]     │ [pct]%            │ 🟠        │
  │ 5 (k=5)  │ σ/√5 = [val]     │ [pct]%            │ 🟡        │
  │ 10       │ σ/√10 = [val]    │ [pct]%            │ 🟢        │
  └──────────┴──────────────────┴───────────────────┴──────────┘
  
  ECs where exact reconstruction is possible: [exact_recon_ecs]
  
  Required Noise for DP Protection:
    To prevent differencing on [SA_name], any published aggregate
    must include Laplace noise with:
    std ≥ [required_noise_std]  (at ε = 1.0)
    This corresponds to a ±[noise_range] uncertainty in any reported figure.

For Categorical / Binary SA:
  Count-based differencing can reveal whether the target has a specific
  [SA_name] value (e.g., Disease=Diabetic: Yes or No).
  
  ECs where count differencing reveals SA value: [exact_count]
  Required protection: Add ±1 count noise to all published group counts.
```

---

### 5.8 Differential Privacy Noise Sufficiency Check

This section is **unique to the Differencing attack** — it evaluates whether, if noise were added, it would be sufficient:

```
Differential Privacy Noise Assessment

For the differencing attack to be blocked, any aggregate release of
this dataset must add noise with standard deviation at least equal to
the SA sensitivity divided by the privacy budget ε.

┌──────────────┬──────────────┬──────────────────┬───────────────────┐
│ Sensitive    │ SA           │ Required Noise    │ Current           │
│ Attribute    │ Sensitivity  │ Std (at ε=1)      │ Protection        │
├──────────────┼──────────────┼──────────────────┼───────────────────┤
│ [SA₁]       │ [range]      │ [req_noise]       │ ❌ None added      │
│ [SA₂]       │ 1 (binary)   │ 1.00              │ ❌ None added      │
└──────────────┴──────────────┴──────────────────┴───────────────────┘

Status: 🔴 No differential privacy noise detected in this dataset.
        Aggregates derived from this data are vulnerable to differencing.

Recommendation: Before publishing any aggregate statistics from this
dataset, apply Laplace or Gaussian noise with the required std above.
Use the Privacy Enhancement module to apply DP noise.
```

---

### 5.9 L-Diversity Results (Per Sensitive Attribute)

```
L-Diversity Check (threshold l = [user_l])

Sensitive Attribute: [SA_NAME]
  Minimum distinct SA values in any EC:  [min_l]
  ECs violating l-diversity:             [violating_ecs] out of [total_ecs] ([pct]%)

  Note: L-Diversity DOES NOT prevent differencing attacks.
  Even if this check passes, differencing can still reconstruct
  SA values from aggregate queries on small ECs.

  Status: 🔴 FAIL / 🟢 PASS
```

---

### 5.10 T-Closeness Results (Per Sensitive Attribute)

```
T-Closeness Check (threshold t = [user_t])

Sensitive Attribute: [SA_NAME]
  Maximum EC deviation (TVD):   [max_distance]
  ECs violating t-closeness:    [violating_ecs] out of [total_ecs] ([pct]%)

  Note: T-Closeness DOES NOT prevent differencing attacks.
  Differencing exploits aggregate arithmetic, not distributional
  skewness. DP noise is the correct countermeasure.

  Status: 🔴 FAIL / 🟢 PASS
```

---

### 5.11 Top Vulnerable Records Table

Show 10 records with highest differencing risk:

| Rank | QI Combination | EC Size | Diff. Risk | Label | Why Vulnerable |
|------|---------------|---------|------------|-------|----------------|
| 1 | [QI vals] | 1 | 1.00 | 🔴 Exact Reconstruction | Singleton — query pair isolates exactly |
| 2 | [QI vals] | 1 | 1.00 | 🔴 Exact Reconstruction | Singleton — query pair isolates exactly |
| 3 | [QI vals] | 2 | 0.75 | 🟠 Near-Exact | Group of 2 — high-confidence subtraction |
| 4 | [QI vals] | 3 | 0.50 | 🟠 Near-Exact | Group of 3 — moderate-confidence subtraction |

**Note below table:**
> "These records' sensitive attribute values can be reconstructed from aggregate query responses — no raw data access is required. Apply differential privacy noise before publishing any statistics derived from this dataset."

---

### 5.12 Query Pair Catalogue (Unique to Differencing)

Show a sample of the **actual query pairs** an attacker would use — populated with real values from the dataset's most vulnerable records. This makes the attack concrete for non-technical stakeholders.

```
EXAMPLE QUERY PAIRS (Attacker's Playbook)

Query Pair #1 — Targets Row #[row_id]  (EC size = 1)
  ┌────────────────────────────────────────────────────────┐
  │ Query A:  SELECT AVG([SA_name])                        │
  │           FROM dataset                                 │
  │           WHERE [QI₁]='[val]' AND [QI₂]='[val]' ...  │
  │           → Result: [R₁]  (n = [EC_size] records)     │
  │                                                        │
  │ Query B:  SELECT AVG([SA_name])                        │
  │           FROM dataset                                 │
  │           WHERE [QI₁]='[val]' AND [QI₂]='[val]' ...  │
  │           AND rowid != [target_rowid]                  │
  │           → Result: [R₂]  (n = [EC_size - 1] records) │
  │                                                        │
  │ Reconstruction:                                        │
  │   Target [SA_name] = R₁×[n] − R₂×[n-1] = [result]   │
  └────────────────────────────────────────────────────────┘

Query Pair #2 — Targets Row #[row_id]  (EC size = 2)
  [Same format as above]

Show up to 5 query pairs for the top 5 most vulnerable records.
```

---

### 5.13 Recommendations Section (Auto-Generated, Conditional)

```
RECOMMENDATIONS (based on Differencing Attack Assessment)

🔴 CRITICAL — [exact_count] records are exactly reconstructable
   These records sit in singleton ECs. Any attacker with query access
   can issue two aggregate queries to reconstruct [SA_name] with
   zero error for these individuals.
   Action: Apply record suppression for singleton ECs, OR
   generalise QIs to merge singleton ECs into larger groups.
   Additionally, add Laplace noise (std ≥ [required_noise]) to any
   published aggregates derived from this dataset.

🔴 HIGH — [near_exact_count] records are near-exactly reconstructable (EC 2–3)
   Groups of 2–3 records allow 50–75% reconstruction accuracy.
   Combined with external auxiliary data, accuracy increases further.
   Action: Push all ECs to size ≥ k=[user_k] via QI generalisation.

🔴 CRITICAL — No Differential Privacy noise applied
   k-anonymity and l-diversity do NOT protect against differencing.
   The only robust protection is adding calibrated noise to aggregates
   before release.
   Action: In Privacy Enhancement, apply the Laplace Mechanism with:
     ε = 1.0 and sensitivity = [required_noise_std] for [SA_name].
   This adds ±[noise_range] uncertainty to any published aggregate,
   making differencing attacks statistically infeasible.

🟡 MEDIUM — [partial_count] records have Partial differencing risk
   These records fall below k=[user_k] threshold. Differencing produces
   noisy estimates but still extracts signal.
   Action: Increase k-anonymity threshold or apply QI generalisation
   to push these ECs above the threshold.

🟡 L-Diversity violated for [SA names]  (if applicable)
   While l-diversity alone does not block differencing, fixing
   l-diversity violations reduces the overall attack surface.

ℹ️ KEY DISTINCTION
   This attack targets AGGREGATE RELEASES, not just raw data.
   Even if you never release individual records, publishing any
   COUNT / SUM / AVG statistics from this dataset is vulnerable
   unless differential privacy noise is applied.

ℹ️ NEXT STEP
   Go to "Privacy Enhancement" to apply Differential Privacy noise
   and QI generalisation. After enhancement, re-run this assessment.
```

---

### 5.14 Attack Score for Badge Display

```
Differencing_Risk_Score = DDR × 100

Badge colour:
  🔴  > 20  — HIGH
  🟡  5–20  — MEDIUM
  🟢  < 5   — LOW
```

Feeds into the **Overall Comparison Score**:
```
overall_score = mean(all enabled attack scores)
differencing_contribution = DDR × 100
```

---

## 6. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size
       ↓
[Run Assessment clicked — Differencing enabled]
       ↓
1.  Sample dataset at sample_size_pct
2.  Build equivalence classes (groupby QIs)
3.  Compute ec_size per record
4.  Compute diff_risk per record using risk function
5.  Label records: Exact / Near-Exact / Partial / Protected
6.  Compute DDR = mean(diff_risk)
7.  Compute exact_count, near_exact_count, coverage_rate
8.  For each numeric SA: compute reconstruction error by EC size
9.  Compute required DP noise std per SA
10. Run L-Diversity check per SA (note: does not block this attack)
11. Run T-Closeness check per SA (note: does not block this attack)
12. Generate Query Pair Catalogue from top 5 vulnerable records
13. Identify top 10 vulnerable records
14. Generate conditional recommendations
       ↓
Render all 14 result sections in the right-hand panel
```

---

## 7. What Makes Differencing Unique vs. Other Attacks

| Property | Prosecutor | Rec. Linkage | Attr. Disclosure | Differencing |
|---|---|---|---|---|
| Requires raw data? | Yes | Yes (join) | Yes | ❌ No — works on aggregates |
| Core formula | `1/EC_size` | `1/EC_size` | `dominant_freq` | `1/EC_size` + noise model |
| Defeated by k-anon? | Yes | Yes | No | ❌ No |
| Defeated by l-diversity? | No | No | Yes | ❌ No |
| Defeated by t-closeness? | No | No | Partially | ❌ No |
| Correct countermeasure | Large ECs | Large ECs | Diverse ECs | **Differential Privacy noise** |
| Outcome labels | At Risk / Protected | Certain/Probable/Possible/Protected | Guaranteed/High/Moderate/Safe | Exact/Near-Exact/Partial/Protected |
| Unique sections | — | QI Contribution Analysis | SA Sensitivity Ranking, Homogeneity Heatmap | **SA Reconstruction Analysis**, **DP Noise Sufficiency Check**, **Query Pair Catalogue** |
| SA type matters? | No | No | Yes (categorical) | ✅ Yes — numeric vs. binary/categorical have different reconstruction formulas |

---

## 8. Implementation Notes for Replit Agent

1. **Reuse EC computation** from Prosecutor / Record Linkage / Attr. Disclosure. All attacks share the same `groupby(QI)` step.
2. **The Query Pair Catalogue (Section 5.12) is mandatory and unique to this attack.** Populate with actual QI values, EC sizes, and SA names from the dataset. This is what makes the attack concrete for stakeholders.
3. **SA Reconstruction Analysis (Section 5.7) must distinguish numeric from categorical SAs.** Use `pd.api.types.is_numeric_dtype()` to branch.
4. **DP Noise Sufficiency Check (Section 5.8) must compute `required_noise_std` per SA** using `SA_range` for numeric and `1` for binary/categorical.
5. **The narrative in Summary Card (5.1) must explicitly state that k-anonymity and l-diversity do NOT protect against this attack.** This is the key educational message for this attack type.
6. **Outcome labels** are: Exact Reconstruction / Near-Exact / Partial / Protected — distinct from all other attacks.
7. **The record-level trace table (Section 5.4) is mandatory.** Paginate at 50 rows, add CSV export.
8. **Recommendations (Section 5.13) must be conditional** — only render blocks whose conditions are violated.
9. **All charts must use real computed values** — no dummy arrays.
10. **Export:** "Download Full Report (CSV)" exports all records with EC sizes, diff risk scores, and vulnerability labels.

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
