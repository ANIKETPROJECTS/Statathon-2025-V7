# Model Inversion Attack — Full Specification
> SafeData Pipeline | Risk Assessment Module  
> Government of India — Ministry of Statistics and Programme Implementation  
> Developed by AIRAVATA Technologies

---

## 1. Overview

### 1.1 What is a Model Inversion Attack?

A **Model Inversion Attack** is a privacy attack in which an adversary exploits the outputs (predictions, confidence scores, or aggregate statistics) of a trained model — or of a published dataset — to **reconstruct or infer the sensitive attribute values of individual records**, even without direct access to the raw data.

Unlike linkage or re-identification attacks that use quasi-identifiers to find a specific person, Model Inversion attacks target the **relationship between features and sensitive attributes**. The attacker iteratively queries (or reasons about) the model/data to work backwards from outputs to inputs.

### 1.2 Attack Context in SafeData

In the context of the SafeData Risk Assessment module, a Model Inversion attacker is modelled as someone who:

- Has access to the **released/anonymised dataset** or an ML model trained on it.
- Knows the **structure of the dataset** (column names, data types, distributions).
- Attempts to **recover sensitive attribute values** for specific individuals or population subgroups by exploiting statistical patterns, correlations, or model confidence scores.

This attack is particularly dangerous for datasets used to train or evaluate ML models before public release.

---

## 2. Attacker Profile

| Property | Description |
|---|---|
| **Attacker Type** | Model Inversion Adversary |
| **Knowledge Level** | Black-box (output only) to White-box (model weights + data) |
| **Goal** | Reconstruct sensitive attributes of individuals from released data or model outputs |
| **Target** | Sensitive columns (e.g., income, diagnosis, salary, medical condition) |
| **Resources Required** | Access to released dataset or model API; background knowledge of schema |
| **Applicable Scenarios** | Published statistical tables, ML model APIs, anonymised open data releases |

---

## 3. Attack Variants Modelled

The SafeData module considers **three variants** of Model Inversion:

### 3.1 Attribute Inference Attack (Data-Level)
The attacker uses known quasi-identifier values of a target individual and statistical correlations in the released dataset to **predict/infer the target's sensitive attribute**.

### 3.2 Model Confidence Inversion (Model-Level)
When an ML model trained on the dataset is queried, the attacker uses the model's **output confidence scores** to iteratively reconstruct likely input feature values — including sensitive ones.

### 3.3 Aggregate Inversion (Statistical-Level)
The attacker uses **aggregate statistics** (means, counts, cross-tabulations) published from the dataset to back-calculate individual sensitive values, especially in small groups or cells.

---

## 4. Mathematical Formulation

### 4.1 Notation

| Symbol | Meaning |
|---|---|
| $D$ | Original dataset with $n$ records and $m$ attributes |
| $Q = \{q_1, q_2, \ldots, q_k\}$ | Set of quasi-identifiers (known to attacker) |
| $S$ | Sensitive attribute (target of inversion) |
| $\hat{s}$ | Attacker's inferred/reconstructed value of $S$ |
| $f(\cdot)$ | Model or statistical function trained/derived from $D$ |
| $\mathcal{E}_{inv}$ | Inversion success rate (proportion of successful reconstructions) |
| $\epsilon$ | Reconstruction error tolerance |

---

### 4.2 Attribute Inference (Data-Level)

#### Step 1 — Conditional Distribution Estimation

For each unique combination of quasi-identifier values $\mathbf{q} = (q_1 = v_1, \ldots, q_k = v_k)$, compute the conditional distribution of the sensitive attribute:

$$P(S = s \mid Q_1 = v_1, \ldots, Q_k = v_k) = \frac{|\{r \in D : r[Q] = \mathbf{v},\ r[S] = s\}|}{|\{r \in D : r[Q] = \mathbf{v}\}|}$$

#### Step 2 — Maximum Likelihood Inference

The attacker infers the most likely sensitive value:

$$\hat{s} = \arg\max_{s \in \mathcal{S}} P(S = s \mid Q = \mathbf{v})$$

#### Step 3 — Inference Confidence Score

$$\text{Confidence}(\hat{s}) = \max_{s} P(S = s \mid Q = \mathbf{v})$$

A high confidence score (> threshold $\tau$, e.g., 0.85) indicates **successful attribute inference**.

#### Step 4 — Vulnerability Score per Record

$$\text{VulnScore}(r_i) = \max_{s \in \mathcal{S}} P(S = s \mid Q = r_i[Q])$$

Records with $\text{VulnScore}(r_i) \geq \tau$ are flagged as **at-risk** for model inversion.

---

### 4.3 Model Confidence Inversion (Model-Level)

When a model $f: X \rightarrow Y$ is trained on $D$ and queried:

#### Step 1 — Iterative Input Reconstruction

The attacker solves the optimisation problem:

$$\hat{\mathbf{x}} = \arg\min_{\mathbf{x}} \mathcal{L}(f(\mathbf{x}),\ y_{\text{target}})$$

where $\mathcal{L}$ is a loss function (e.g., cross-entropy for classification) and $y_{\text{target}}$ is the observed output class/confidence.

#### Step 2 — Gradient-Based Inversion (White-box)

If model gradients are accessible:

$$\hat{\mathbf{x}}^{(t+1)} = \hat{\mathbf{x}}^{(t)} - \eta \cdot \nabla_{\mathbf{x}} \mathcal{L}(f(\hat{\mathbf{x}}^{(t)}),\ y_{\text{target}})$$

Repeated for $T$ iterations. Convergence indicates a feasible reconstruction.

#### Step 3 — Reconstruction Fidelity

$$\text{Fidelity} = 1 - \frac{\|\hat{\mathbf{x}} - \mathbf{x}_{\text{true}}\|_2}{\|\mathbf{x}_{\text{true}}\|_2}$$

A fidelity score $\geq 0.80$ is treated as a **successful inversion**.

---

### 4.4 Aggregate Inversion (Statistical-Level)

For small-cell published statistics (e.g., contingency tables):

#### Step 1 — Cell Identification

Identify cells in the contingency table where group size $n_g \leq \theta$ (e.g., $\theta = 5$):

$$\mathcal{C}_{\text{small}} = \{c : n_c \leq \theta\}$$

#### Step 2 — Differencing Attack Component

If two overlapping aggregate queries $A_1$ and $A_2$ are available:

$$\Delta = A_1 - A_2$$

If $|A_1 \setminus A_2| = 1$, then $\Delta$ **exactly reveals** the sensitive value of a single record.

#### Step 3 — Small-Cell Inversion Risk

$$\text{AggInvRisk} = \frac{|\mathcal{C}_{\text{small}}|}{|\mathcal{C}_{\text{total}}|}$$

---

### 4.5 Overall Model Inversion Risk Score

The composite Model Inversion Risk Score per record $r_i$ combines all three variants:

$$\text{MIRisk}(r_i) = \alpha \cdot \text{VulnScore}(r_i) + \beta \cdot \text{ModelFidelityRisk}(r_i) + \gamma \cdot \text{AggInvRisk}(r_i)$$

Where:
- $\alpha + \beta + \gamma = 1$ (configurable weights; defaults: $\alpha=0.5,\ \beta=0.3,\ \gamma=0.2$)
- $\text{ModelFidelityRisk}(r_i)$ is derived from fidelity scores of reconstructed records matching $r_i$'s quasi-identifier group.

**Dataset-Level Risk Score:**

$$\text{MIRisk}_{\text{dataset}} = \frac{1}{n} \sum_{i=1}^{n} \text{MIRisk}(r_i)$$

---

## 5. Thresholds and Risk Levels

| Risk Level | MIRisk Score Range | Interpretation |
|---|---|---|
| **Low** | 0.00 – 0.30 | Sensitive attributes are well-protected; inversion is highly unlikely |
| **Medium** | 0.31 – 0.60 | Partial reconstruction possible for some subgroups; mitigation advised |
| **High** | 0.61 – 0.80 | Significant attribute leakage likely; re-anonymisation required |
| **Critical** | 0.81 – 1.00 | Sensitive values are directly inferrable; immediate remediation needed |

---

## 6. Role of k-Anonymity, l-Diversity, and t-Closeness

These privacy parameters — configurable in the SafeData UI — directly mitigate Model Inversion risk:

### 6.1 k-Anonymity

Ensures each quasi-identifier combination appears in at least $k$ records. This prevents exact attribute inference by introducing ambiguity.

- If $k \geq 5$: Attacker cannot narrow the conditional distribution to fewer than 5 candidates.
- **Effect on MIRisk:** Higher $k$ reduces $\text{VulnScore}$ by flattening $P(S \mid Q)$.

$$\text{VulnScore}(r_i) \leq \frac{1}{k} \quad \text{when k-anonymity is satisfied}$$

### 6.2 l-Diversity

Ensures each equivalence class has at least $l$ distinct values of the sensitive attribute, preventing the attacker from narrowing inversion to a single value.

- **Effect on MIRisk:** Reduces the maximum of $P(S = s \mid Q = \mathbf{v})$ to at most $\frac{1}{l}$.

$$\max_s P(S = s \mid Q = \mathbf{v}) \leq \frac{1}{l}$$

### 6.3 t-Closeness

Ensures the distribution of $S$ within each equivalence class is close to the overall distribution, measured by Earth Mover's Distance (EMD):

$$\text{EMD}(P(S \mid Q = \mathbf{v}),\ P(S)) \leq t$$

- **Effect on MIRisk:** Prevents exploitation of skewed group distributions that would make inversion easier.

---

## 7. Attack Simulation Steps (Implementation Logic)

```
FUNCTION ModelInversionAttack(dataset D, quasi_ids Q, sensitive_attr S, k, l, t):

  results = []

  FOR each record r in D:

    # Step 1: Get equivalence class
    EC = { x in D : x[Q] == r[Q] }

    # Step 2: Compute conditional distribution
    dist = distribution of S values in EC

    # Step 3: Attribute Inference Score
    VulnScore = max(dist.values())

    # Step 4: Check k-anonymity protection
    k_protected = (|EC| >= k)

    # Step 5: Check l-diversity protection  
    l_protected = (number of distinct S values in EC >= l)

    # Step 6: Check t-closeness protection
    emd = earth_mover_distance(dist, global_dist_S)
    t_protected = (emd <= t)

    # Step 7: Aggregate Inversion Risk
    AggInvRisk = 1.0 if |EC| == 1 else (1 / |EC|)

    # Step 8: Composite Score
    MIRisk = 0.5 * VulnScore + 0.2 * AggInvRisk
             + (0.3 if NOT l_protected else 0.0)

    results.append({
      record_id: r.id,
      VulnScore: VulnScore,
      k_protected: k_protected,
      l_protected: l_protected,
      t_protected: t_protected,
      AggInvRisk: AggInvRisk,
      MIRisk: MIRisk,
      risk_level: classify(MIRisk)
    })

  RETURN aggregate_results(results)
```

---

## 8. Result Sections (UI Output)

The following result panels must be displayed in the Risk Assessment module after running a Model Inversion attack assessment:

---

### 8.1 Overall Model Inversion Risk Score

**Widget type:** Gauge / Dial Chart + Summary Card

**Displays:**
- Composite `MIRisk_dataset` score (0.00 – 1.00)
- Risk level label: Low / Medium / High / Critical
- Colour-coded indicator (green → red)
- Total records assessed and % flagged as at-risk

**Sample Output:**
```
Model Inversion Risk Score: 0.67   [HIGH]
Records Assessed: 10,000
At-Risk Records: 3,412 (34.1%)
```

---

### 8.2 Attribute Inference Vulnerability Breakdown

**Widget type:** Bar Chart + Table

**Displays:**
- Per-sensitive-attribute inference confidence scores
- For each sensitive column: `max P(S|Q)`, `mean P(S|Q)`, `% records with confidence > 0.85`
- Highlights which sensitive attributes are most exposed

**Columns:**
| Sensitive Attribute | Max Inference Confidence | Mean Confidence | At-Risk Records (%) |
|---|---|---|---|
| Diagnosis | 0.94 | 0.72 | 41.2% |
| Income Bracket | 0.81 | 0.58 | 28.7% |

---

### 8.3 Equivalence Class Inversion Risk Distribution

**Widget type:** Histogram / Heatmap

**Displays:**
- Distribution of VulnScore across all equivalence classes
- X-axis: VulnScore buckets (0–0.2, 0.2–0.4, …, 0.8–1.0)
- Y-axis: Number of equivalence classes in each bucket
- Highlights classes where inversion confidence exceeds threshold $\tau$

**Purpose:** Shows whether the dataset has pockets of high-risk equivalence classes even if the overall score is moderate.

---

### 8.4 k-Anonymity / l-Diversity / t-Closeness Protection Analysis

**Widget type:** 3-column status panel with pass/fail indicators

**Displays:**
- For each privacy parameter (k, l, t): current configured value vs. recommended value
- Number of equivalence classes **violating** each parameter
- % of records exposed due to each violation

**Example:**
```
k-Anonymity (k=5):    ✅ 97.3% of classes satisfy k≥5
                      ⚠️  2.7% of classes have k < 5 → exposed records: 271

l-Diversity (l=3):    ❌ 18.4% of classes have < 3 distinct sensitive values
                      → Inversion confidence ≤ 1/l NOT guaranteed

t-Closeness (t=0.20): ✅ 91.2% of classes satisfy EMD ≤ 0.20
                      ⚠️  8.8% exceed t → distribution skew exploitable
```

---

### 8.5 Small-Cell Aggregate Inversion Risk

**Widget type:** Table + Warning Badges

**Displays:**
- Number and % of small cells ($n_c \leq 5$) in cross-tabulations
- Cells where a differencing attack could uniquely identify a record's sensitive value
- `AggInvRisk` score for the dataset
- List of high-risk cell combinations (quasi-id value combinations with tiny group sizes)

**Purpose:** Flags statistical tables that expose individuals even without accessing the raw dataset.

---

### 8.6 Per-Record Inversion Risk Table (Drill-Down)

**Widget type:** Searchable, sortable data table (paginated)

**Displays:**
- Record ID (anonymised)
- Quasi-identifier combination (hashed/masked)
- VulnScore
- MIRisk score
- Risk Level (colour-coded badge)
- Protected by k / l / t (✅ / ❌ for each)
- Recommended action (Generalise / Suppress / Add Noise)

**Columns:**
| Record ID | VulnScore | MIRisk | Risk Level | k-OK | l-OK | t-OK | Action |
|---|---|---|---|---|---|---|---|
| R_0042 | 0.91 | 0.78 | 🔴 High | ✅ | ❌ | ✅ | Add Diversity |
| R_0187 | 0.44 | 0.38 | 🟡 Medium | ✅ | ✅ | ⚠️ | Generalise QI |

---

### 8.7 Sensitive Attribute Leakage Map

**Widget type:** Correlation Heatmap

**Displays:**
- Correlation / mutual information between each quasi-identifier and the sensitive attribute
- High correlation = higher inversion risk
- Helps identify which QIs are the primary "levers" enabling model inversion

**Formula used (Mutual Information):**

$$I(Q_j; S) = \sum_{v \in Q_j} \sum_{s \in S} P(Q_j=v, S=s) \log \frac{P(Q_j=v, S=s)}{P(Q_j=v) \cdot P(S=s)}$$

---

### 8.8 Recommended Mitigations

**Widget type:** Ordered action list with severity tags

Based on assessment results, the system generates prioritised recommendations:

| Priority | Mitigation | Targets | Expected MIRisk Reduction |
|---|---|---|---|
| 🔴 P1 | Increase l-diversity to ≥ 5 | All equivalence classes failing l-check | ~0.20 reduction |
| 🔴 P1 | Suppress records with VulnScore > 0.90 | 271 singleton/near-singleton records | ~0.12 reduction |
| 🟡 P2 | Generalise Age → 10-year bands | Reduces QI correlation with sensitive attr | ~0.08 reduction |
| 🟡 P2 | Add Laplace noise to aggregate statistics | Prevents differencing attack | ~0.05 reduction |
| 🟢 P3 | Apply t-closeness (t ≤ 0.15) for failing classes | 880 classes with EMD > 0.20 | ~0.04 reduction |

---

## 9. Key Differences from Other Attack Types

| Property | Prosecutor Attack | Model Inversion Attack |
|---|---|---|
| **Target** | Specific individual re-identification | Sensitive attribute reconstruction |
| **Uses** | Quasi-identifiers to find a unique match | Output distributions / correlations to infer hidden values |
| **Success Metric** | Record is uniquely identified | Sensitive value is predicted with high confidence |
| **Primary Threat Vector** | Record linkage | Statistical / ML inference |
| **Mitigated by** | k-anonymity | l-diversity + t-closeness + noise |
| **Applicable to ML?** | Partially | Yes — directly attacks trained models |

---

## 10. References

1. Fredrikson, M., Jha, S., & Ristenpart, T. (2015). *Model Inversion Attacks that Exploit Confidence Information and Basic Countermeasures.* ACM CCS 2015.
2. Ganta, S. R., Kasiviswanathan, S. P., & Smith, A. (2008). *Composition Attacks and Auxiliary Information in Data Privacy.* ACM KDD 2008.
3. Machanavajjhala, A., Kifer, D., Gehrke, J., & Venkitasubramaniam, M. (2007). *l-Diversity: Privacy Beyond k-Anonymity.* ACM TKDD.
4. Li, N., Li, T., & Venkatasubramanian, S. (2007). *t-Closeness: Privacy Beyond k-Anonymity and l-Diversity.* IEEE ICDE 2007.
5. Sweeney, L. (2002). *k-Anonymity: A Model for Protecting Privacy.* IJUFKS.

---

*Specification Version: 1.0 | Module: Risk Assessment → Model Inversion | SafeData Pipeline*  
*Government of India — MoSPI | Developed by AIRAVATA Technologies*
