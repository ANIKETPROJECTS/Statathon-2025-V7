# Auto-Assist Classification Engine
## Quasi-Identifiers, Sensitive Attributes & Parameter Auto-Suggestion
### Full Math, Logic & Algorithm Specification

> **For Replit Agent**: Implement this entire module as a pre-processing step that runs immediately after the user uploads a CSV file — BEFORE they touch any checkbox. The goal is to intelligently pre-fill all selections and parameters with justified defaults that the user can then override.

---

## OVERVIEW: The 5-Stage Auto-Assist Pipeline

```
CSV Uploaded
     ↓
Stage 1: Column Profiling        → compute stats for every column
     ↓
Stage 2: Column Classification   → assign each column to QI / SA / Direct-ID / Ignore
     ↓
Stage 3: QI Risk Scoring         → rank QIs by their re-identification contribution
     ↓
Stage 4: Parameter Auto-Suggestion → recommend k, l, t, sample_size
     ↓
Stage 5: UI Rendering            → pre-check boxes + show confidence badges + explain why
```

---

## STAGE 1: Column Profiling

Run these statistics on **every column** the moment the CSV is loaded.
This is the raw data all later stages depend on.

### 1.1 — Per-Column Statistics to Compute

```python
def profile_column(series, total_rows):
    """
    Input : a single pandas Series (one column)
    Output: a dict of profile metrics
    """
    n = total_rows
    non_null = series.dropna()
    
    return {
        # Basic counts
        'total_rows'        : n,
        'null_count'        : n - len(non_null),
        'null_pct'          : (n - len(non_null)) / n,

        # Cardinality
        'unique_count'      : non_null.nunique(),
        'cardinality_ratio' : non_null.nunique() / n,        # 0.0 – 1.0

        # Data type detection
        'inferred_dtype'    : infer_dtype(series),           # see 1.2 below
        'is_numeric'        : pd.api.types.is_numeric_dtype(series),
        'is_categorical'    : non_null.nunique() / n < 0.05, # <5% unique = categorical

        # Distribution
        'top_value'         : non_null.mode()[0] if len(non_null) > 0 else None,
        'top_value_freq'    : non_null.value_counts(normalize=True).iloc[0]
                              if len(non_null) > 0 else 0,   # dominance of top value
        'entropy'           : compute_entropy(non_null),     # see 1.3 below
        'gini_impurity'     : compute_gini(non_null),        # see 1.4 below

        # Numeric-only stats
        'mean'              : non_null.mean() if is_numeric else None,
        'std'               : non_null.std()  if is_numeric else None,
        'min'               : non_null.min()  if is_numeric else None,
        'max'               : non_null.max()  if is_numeric else None,

        # Name-based signals
        'col_name_lower'    : series.name.lower().strip(),
    }
```

---

### 1.2 — Data Type Inference

```python
def infer_dtype(series):
    """
    Returns one of: 'id_string', 'categorical', 'ordinal_numeric',
                    'continuous_numeric', 'binary', 'text', 'date'
    """
    col   = series.dropna()
    n     = len(col)
    uniq  = col.nunique()
    ratio = uniq / n if n > 0 else 0

    if uniq == 2:
        return 'binary'

    if pd.api.types.is_numeric_dtype(col):
        if ratio > 0.95:
            return 'continuous_numeric'   # age, income — high spread
        elif uniq <= 20:
            return 'ordinal_numeric'      # round number 1–5, codes
        else:
            return 'continuous_numeric'

    if pd.api.types.is_string_dtype(col):
        avg_len = col.str.len().mean()
        if ratio > 0.90:
            return 'id_string'            # FSU serial no, name, HHID
        elif avg_len > 40:
            return 'text'                 # free-form text — ignore
        else:
            return 'categorical'          # State, District, etc.

    return 'categorical'
```

---

### 1.3 — Shannon Entropy (measures information content)

```
                  k
H(X) = - Σ  p_i × log₂(p_i)
                 i=1

Where:
  k   = number of distinct values in the column
  p_i = proportion of records with value i
  log₂= logarithm base 2

Range: 0 (all records same value) to log₂(k) (perfectly uniform)
Normalised Entropy: H_norm = H(X) / log₂(k)   → always 0.0 to 1.0
```

```python
def compute_entropy(series):
    from math import log2
    counts = series.value_counts(normalize=True)
    H = -sum(p * log2(p) for p in counts if p > 0)
    k = len(counts)
    H_norm = H / log2(k) if k > 1 else 0.0
    return round(H_norm, 4)   # return normalised 0–1
```

**Interpretation for classification:**
| H_norm | Meaning |
|--------|---------|
| 0.00 – 0.10 | Near-constant column, useless for identification → Ignore |
| 0.11 – 0.50 | Low entropy, categorical → likely QI (State, Round) |
| 0.51 – 0.85 | Medium entropy → likely QI or SA |
| 0.86 – 1.00 | High entropy, near-unique → likely Direct Identifier or SA (income) |

---

### 1.4 — Gini Impurity (measures diversity of values)

```
              k
G(X) = 1 - Σ  p_i²
             i=1

Range: 0 (all same value) to (1 - 1/k) (maximum diversity)
Normalised: G_norm = G(X) / (1 - 1/k)   → 0.0 to 1.0
```

```python
def compute_gini(series):
    counts = series.value_counts(normalize=True)
    G = 1 - sum(p**2 for p in counts)
    k = len(counts)
    G_norm = G / (1 - 1/k) if k > 1 else 0.0
    return round(G_norm, 4)
```

**Why both entropy AND Gini?**
- Entropy is sensitive to rare values (tail-heavy distributions)
- Gini is sensitive to dominant values
- Using both together gives a more robust signal
- Combined score: `diversity_score = 0.6 × H_norm + 0.4 × G_norm`

---

## STAGE 2: Column Classification

Each column is scored against four classes. Whichever class has the highest score wins.

### 2.1 — The Four Classes

| Class | Definition | Action |
|-------|-----------|--------|
| **DIRECT_ID** | Uniquely identifies a person directly (name, national ID, phone) | Show warning, recommend REMOVE before release |
| **QUASI_ID** | Can indirectly identify when combined with others | Pre-check as QI |
| **SENSITIVE** | Value disclosure causes harm (income, caste, health) | Pre-check as SA |
| **IGNORE** | No privacy relevance (admin fields, constants) | Un-checked, hidden by default |

---

### 2.2 — Scoring Matrix

Every column gets a score (0–100) for each class. Two inputs feed the score:
1. **Statistical signals** from the profile (Stage 1)
2. **Name-based signals** from the column name string

#### SIGNAL A — Statistical Score Functions

```python
def score_direct_id(profile):
    """
    High cardinality ratio + id-like name = Direct Identifier
    """
    score = 0
    cr = profile['cardinality_ratio']    # 0.0 – 1.0

    # Cardinality contribution (0-60 points)
    if cr >= 0.95:   score += 60
    elif cr >= 0.80: score += 40
    elif cr >= 0.60: score += 20

    # Entropy contribution (0-20 points)
    if profile['entropy'] >= 0.90: score += 20
    elif profile['entropy'] >= 0.70: score += 10

    # Data type contribution (0-20 points)
    if profile['inferred_dtype'] == 'id_string': score += 20

    return min(score, 100)


def score_quasi_id(profile):
    """
    Medium cardinality + categorical + linkable with external data
    """
    score = 0
    cr = profile['cardinality_ratio']

    # Cardinality sweet-spot: 0.005 to 0.50 (not too unique, not too constant)
    if 0.005 <= cr <= 0.50:
        # Peak score at cr ≈ 0.05, falls off on either side
        # Use a tent function:
        if cr <= 0.05:
            score += int(60 * (cr / 0.05))          # 0 → 60 linearly
        else:
            score += int(60 * (1 - (cr - 0.05) / 0.45))  # 60 → 0 linearly

    # Entropy contribution (sweet spot 0.3 – 0.75)
    H = profile['entropy']
    if 0.30 <= H <= 0.75: score += 25
    elif 0.10 <= H < 0.30: score += 10

    # Type contribution
    if profile['inferred_dtype'] in ('categorical', 'ordinal_numeric'): score += 15

    return min(score, 100)


def score_sensitive(profile):
    """
    Medium-high entropy + numeric or categorical + non-identifying
    """
    score = 0
    cr = profile['cardinality_ratio']
    H  = profile['entropy']

    # Sensitive attributes are often numeric (income, score)
    # OR categorical with moderate cardinality (religion, caste)
    if profile['inferred_dtype'] in ('continuous_numeric', 'ordinal_numeric'):
        score += 30
    elif profile['inferred_dtype'] == 'categorical':
        score += 20

    # High entropy suggests meaningful variation (not constant)
    if H >= 0.60: score += 30
    elif H >= 0.40: score += 15

    # Medium cardinality (not unique, not constant)
    if 0.01 <= cr <= 0.30: score += 20
    elif 0.30 < cr <= 0.70: score += 10

    return min(score, 100)


def score_ignore(profile):
    """
    Near-constant columns OR pure admin sequential IDs
    """
    score = 0

    # Constant or near-constant
    if profile['top_value_freq'] >= 0.95: score += 70
    elif profile['top_value_freq'] >= 0.80: score += 40

    # Very low entropy
    if profile['entropy'] <= 0.05: score += 30
    elif profile['entropy'] <= 0.15: score += 15

    return min(score, 100)
```

---

#### SIGNAL B — Name-Based Score Bonuses

```python
# Keyword dictionaries — add more as needed

DIRECT_ID_KEYWORDS = [
    'name', 'phone', 'mobile', 'email', 'aadhar', 'aadhaar', 'pan',
    'passport', 'voter_id', 'employee_id', 'respondent_id', 'uid',
    'person_id', 'individual_id', 'contact', 'address', 'pincode', 'pin'
]

QUASI_ID_KEYWORDS = [
    'state', 'district', 'village', 'tehsil', 'block', 'ward',
    'round', 'centre', 'zone', 'region', 'area', 'sector',
    'fsu', 'serial', 'code', 'stratum', 'sub_round', 'visit',
    'age', 'gender', 'sex', 'occupation', 'education', 'relation',
    'hh_size', 'household_size', 'hhtype', 'religion', 'caste'
]

SENSITIVE_KEYWORDS = [
    'income', 'salary', 'wage', 'earning', 'expenditure', 'expense',
    'hhid', 'hhno', 'health', 'disease', 'illness', 'disability',
    'loan', 'debt', 'asset', 'land', 'mpi', 'poverty', 'score',
    'mlm', 'mlt', 'sr', 'status', 'mpce', 'consumption'
]

IGNORE_KEYWORDS = [
    'flag', 'weight', 'multiplier', 'wgt', 'fw', 'fweight',
    'record_type', 'rec_type', 'filler', 'blank', 'dummy',
    'version', 'batch', 'created_at', 'updated_at', 'timestamp'
]


def name_bonus(col_name, keyword_list, bonus=25):
    """
    Returns `bonus` if any keyword appears as a substring in col_name.
    Case-insensitive. Partial match allowed.
    """
    col_lower = col_name.lower().replace(' ', '_')
    for kw in keyword_list:
        if kw in col_lower:
            return bonus
    return 0
```

---

### 2.3 — Final Classification Decision

```python
def classify_column(profile):
    col_name = profile['col_name_lower']

    # Compute statistical scores
    s_did  = score_direct_id(profile)
    s_qi   = score_quasi_id(profile)
    s_sa   = score_sensitive(profile)
    s_ign  = score_ignore(profile)

    # Add name bonuses
    s_did  += name_bonus(col_name, DIRECT_ID_KEYWORDS,  bonus=30)
    s_qi   += name_bonus(col_name, QUASI_ID_KEYWORDS,   bonus=25)
    s_sa   += name_bonus(col_name, SENSITIVE_KEYWORDS,  bonus=25)
    s_ign  += name_bonus(col_name, IGNORE_KEYWORDS,     bonus=20)

    # Hard override rules (applied AFTER scoring)
    # Rule 1: 100% unique + string → always Direct ID
    if profile['cardinality_ratio'] == 1.0 and profile['inferred_dtype'] == 'id_string':
        return 'DIRECT_ID', 100, "Every value is unique — this is a direct identifier."

    # Rule 2: Single unique value (constant) → always Ignore
    if profile['unique_count'] == 1:
        return 'IGNORE', 100, "This column has only one value — it carries no information."

    # Rule 3: >80% null → Ignore
    if profile['null_pct'] > 0.80:
        return 'IGNORE', 100, "More than 80% of values are missing."

    # Soft decision: highest score wins
    scores = {
        'DIRECT_ID' : s_did,
        'QUASI_ID'  : s_qi,
        'SENSITIVE' : s_sa,
        'IGNORE'    : s_ign,
    }
    winner = max(scores, key=scores.get)
    confidence = scores[winner]

    reason = build_reason(winner, profile, scores)
    return winner, confidence, reason
```

---

### 2.4 — Confidence Badges

Show these in the UI next to each column checkbox:

| Confidence | Badge | Meaning |
|------------|-------|---------|
| ≥ 80 | 🟢 High confidence | System is very sure |
| 50 – 79 | 🟡 Medium confidence | Likely correct, review suggested |
| < 50 | 🔵 Low confidence | User should decide |

---

### 2.5 — Human-Readable Reason Generator

```python
def build_reason(classification, profile, scores):
    cr    = profile['cardinality_ratio']
    H     = profile['entropy']
    dtype = profile['inferred_dtype']
    name  = profile['col_name_lower']

    reasons = []

    if classification == 'DIRECT_ID':
        reasons.append(f"{int(cr*100)}% of values are unique")
        reasons.append("Column name suggests a direct identifier")

    elif classification == 'QUASI_ID':
        reasons.append(f"Has {profile['unique_count']} distinct values across {profile['total_rows']} rows")
        reasons.append(f"Cardinality ratio = {cr:.2f} (moderate — good for linking)")
        if H < 0.5:
            reasons.append("Low entropy — values cluster into groups (linkable)")
        reasons.append("Can be combined with other columns to narrow down individuals")

    elif classification == 'SENSITIVE':
        reasons.append(f"Data type is {dtype}")
        reasons.append("Column name matches known sensitive attribute keywords")
        reasons.append("Disclosure of this value may cause harm to the individual")

    elif classification == 'IGNORE':
        if profile['top_value_freq'] > 0.9:
            reasons.append(f"Top value appears in {int(profile['top_value_freq']*100)}% of rows — near-constant")
        if H < 0.1:
            reasons.append("Near-zero entropy — carries no discriminating information")

    return " | ".join(reasons)
```

**Example output in UI:**
```
FSU_Serial_No    [QUASI-ID 🟢]
  "Has 87 distinct values across 100 rows | Cardinality ratio = 0.87 |
   Column name matches quasi-identifier keywords (serial, fsu)"

State            [SENSITIVE 🟡]
  "Data type is categorical | Column name matches sensitive keywords |
   Disclosure may cause harm"

HHID             [QUASI-ID 🟢]
  "Has 100 distinct values — consider whether this should be removed entirely"
```

---

## STAGE 3: QI Risk Contribution Ranking

Once QIs are identified, rank them by how much they contribute to re-identification risk.
This helps the user decide **which QIs to drop** if they want to reduce risk.

### 3.1 — Individual Column Re-ID Contribution Score

For each QI column `q_i`, compute how unique records become when you add it to the QI set:

```python
def qi_risk_contribution(df, qi_list):
    """
    For each QI, measure how much it increases the number of
    unique equivalence classes (= how much it hurts privacy).
    
    More unique ECs → higher risk → higher contribution score.
    """
    results = {}

    # Baseline: unique ECs without any QI
    baseline_ecs = 1   # trivially 1 if no QIs selected

    for qi in qi_list:
        # ECs using just this one QI alone
        solo_ecs   = df[qi].nunique()
        solo_ratio = solo_ecs / len(df)

        # Marginal contribution: ECs when adding this QI
        # to all OTHER QIs combined
        other_qis = [q for q in qi_list if q != qi]

        if other_qis:
            without_qi   = df.groupby(other_qis).ngroups
            with_all_qis = df.groupby(qi_list).ngroups
            marginal     = with_all_qis - without_qi
            marginal_pct = marginal / len(df) * 100
        else:
            marginal     = solo_ecs
            marginal_pct = solo_ratio * 100

        results[qi] = {
            'solo_unique_values'    : solo_ecs,
            'solo_cardinality_ratio': round(solo_ratio, 4),
            'marginal_new_ECs'      : marginal,
            'marginal_risk_pct'     : round(marginal_pct, 2),
            'risk_rank'             : None   # filled after sorting
        }

    # Rank by marginal_risk_pct descending
    sorted_qis = sorted(results.items(), key=lambda x: x[1]['marginal_risk_pct'], reverse=True)
    for rank, (qi, data) in enumerate(sorted_qis, start=1):
        results[qi]['risk_rank'] = rank

    return results
```

**UI output — QI Risk Ranking Table:**
```
┌─────────────────────┬──────────────┬──────────────────┬──────────┐
│ Quasi-Identifier    │ Unique Values│ Marginal Risk    │ Rank     │
├─────────────────────┼──────────────┼──────────────────┼──────────┤
│ FSU_Serial_No       │ 87 / 100     │ +68% new ECs     │ 🔴 #1   │
│ Round_Centre_Code   │ 6 / 100      │ +12% new ECs     │ 🟡 #2   │
│ Round               │ 4 / 100      │ +5% new ECs      │ 🟢 #3   │
│ District_Code       │ 12 / 100     │ +3% new ECs      │ 🟢 #4   │
└─────────────────────┴──────────────┴──────────────────┴──────────┘
Tip: Removing FSU_Serial_No would reduce re-identification risk by ~68%.
```

---

## STAGE 4: Parameter Auto-Suggestion

### 4.1 — K-Anonymity Threshold (k)

**Goal:** Choose k such that at least 90% of records are protected.

```python
def suggest_k(df, qi_list):
    """
    Strategy: Find the k value where ≥90% of records are in ECs of size ≥k.
    Use the 10th percentile of EC sizes as the suggested k.
    """
    ec_sizes = df.groupby(qi_list).size().reset_index(name='ec_size')
    df2      = df.merge(ec_sizes, on=qi_list, how='left')

    # Distribution of EC sizes across all records
    size_series = df2['ec_size']

    # Current state
    pct_unique   = (size_series == 1).mean() * 100
    pct_k5_ok    = (size_series >= 5).mean() * 100

    # Suggested k = 10th percentile of EC sizes
    # (ensures 90% of records are in ECs at least this large)
    suggested_k = max(2, int(size_series.quantile(0.10)))

    # Cap at reasonable value
    suggested_k = min(suggested_k, 10)

    # Justification string
    if pct_unique > 50:
        reason = (f"{pct_unique:.0f}% of records are singletons. "
                  f"Recommended k={suggested_k} — but significant "
                  f"suppression/generalisation will be needed.")
    elif suggested_k <= 2:
        reason = (f"Most ECs are very small. k=2 is the minimum "
                  f"to provide any protection. Consider k=5 as best practice.")
        suggested_k = 2
    else:
        reason = (f"With k={suggested_k}, approximately 90% of records "
                  f"will be in equivalence classes of at least this size.")

    return {
        'suggested_k' : suggested_k,
        'min_possible': 1,
        'max_sensible': 10,
        'pct_unique'  : pct_unique,
        'pct_protected_at_k': pct_k5_ok,
        'reason'      : reason
    }
```

**Standards reference for the UI tooltip:**
```
Industry standards for k:
  k = 2  → Minimal (academic / low-sensitivity data)
  k = 3  → Basic (NSO internal research use)
  k = 5  → Standard (GDPR-aligned, recommended for public release)
  k = 10 → Strict (medical / financial / highly sensitive data)
  k = 25 → Very strict (census micro-data, national security contexts)
```

---

### 4.2 — L-Diversity Threshold (l)

**Goal:** Each EC must have at least `l` distinct values for every sensitive attribute.

```python
def suggest_l(df, qi_list, sensitive_attributes, suggested_k):
    """
    Strategy:
    1. For each SA, compute the actual min distinct values across all ECs.
    2. Suggest l = floor(suggested_k / 2), at minimum 2.
    3. Never suggest l > actual_min_diversity (would be unachievable).
    """
    results = {}

    ec_groups = df.groupby(qi_list)

    for sa in sensitive_attributes:
        # Diversity of this SA across all ECs
        l_per_ec    = ec_groups[sa].nunique()
        actual_min  = int(l_per_ec.min())
        actual_mean = float(l_per_ec.mean())

        # Suggestion: half of k, minimum 2
        naive_suggestion = max(2, suggested_k // 2)

        # Cannot suggest higher than what's achievable
        suggested_l = min(naive_suggestion, actual_min + 1)
        suggested_l = max(2, suggested_l)

        pct_violating = (l_per_ec < suggested_l).mean() * 100

        if actual_min == 1:
            reason = (f"Some ECs have only 1 distinct value of {sa} — "
                      f"an attacker learns {sa} with certainty. "
                      f"l={suggested_l} is the suggested minimum.")
        else:
            reason = (f"Average EC has {actual_mean:.1f} distinct {sa} values. "
                      f"l={suggested_l} would protect "
                      f"{100 - pct_violating:.0f}% of records.")

        results[sa] = {
            'suggested_l'     : suggested_l,
            'actual_min_l'    : actual_min,
            'actual_mean_l'   : round(actual_mean, 2),
            'pct_violating'   : round(pct_violating, 2),
            'reason'          : reason
        }

    # Overall suggested l = min across all SAs (most conservative)
    overall_l = min(v['suggested_l'] for v in results.values()) if results else 2

    return overall_l, results
```

**Tooltip text for UI:**
```
What is l-diversity?
  If l=3, every group of people sharing the same quasi-identifiers
  must contain at least 3 different values of each sensitive attribute.
  This prevents an attacker from learning your sensitive value even
  after they narrow you down to your equivalence class.

Recommended l values:
  l = 2  → Minimum (any two different SA values per EC)
  l = 3  → Standard
  l = 5  → Strict (medical/financial data)
```

---

### 4.3 — T-Closeness Threshold (t)

**Goal:** The distribution of a SA within any EC should not deviate more than `t` from the global distribution.

```python
def suggest_t(df, qi_list, sensitive_attributes):
    """
    Strategy:
    1. Compute the actual maximum TVD (Total Variation Distance) across all ECs
       for each sensitive attribute.
    2. Suggest t = 0.20 as the standard default (ISO/academic standard).
    3. Warn if current max_tvd >> 0.20, meaning significant work is needed.
    """
    from math import sqrt

    results = {}
    ec_groups = df.groupby(qi_list)

    for sa in sensitive_attributes:
        global_dist = df[sa].value_counts(normalize=True)
        all_values  = global_dist.index.tolist()

        tvd_list = []
        for name, group in ec_groups:
            local_dist = group[sa].value_counts(normalize=True)
            # Total Variation Distance
            tvd = 0.5 * sum(
                abs(local_dist.get(v, 0) - global_dist.get(v, 0))
                for v in all_values
            )
            tvd_list.append(tvd)

        max_tvd  = max(tvd_list)
        mean_tvd = sum(tvd_list) / len(tvd_list)

        # Suggest t slightly above mean_tvd so most ECs pass
        suggested_t = round(min(0.50, max(0.10, mean_tvd + 0.05)), 2)

        # Standard reference: 0.20 is the most common threshold
        # If mean_tvd > 0.20, warn that data needs significant restructuring
        pct_violating_at_std = sum(1 for v in tvd_list if v > 0.20) / len(tvd_list) * 100

        reason = (f"Average EC deviation from global {sa} distribution: {mean_tvd:.3f}. "
                  f"Max deviation: {max_tvd:.3f}. "
                  f"At standard t=0.20: {pct_violating_at_std:.0f}% of ECs would violate.")

        results[sa] = {
            'suggested_t'    : suggested_t,
            'max_tvd'        : round(max_tvd, 4),
            'mean_tvd'       : round(mean_tvd, 4),
            'pct_violating_at_suggested_t': round(
                sum(1 for v in tvd_list if v > suggested_t) / len(tvd_list) * 100, 2),
            'reason'         : reason
        }

    # Overall suggested t = median of per-SA suggestions
    import statistics
    overall_t = round(statistics.median(v['suggested_t'] for v in results.values()), 2) \
                if results else 0.20

    return overall_t, results
```

**Tooltip text for UI:**
```
What is t-closeness?
  Even if your group has diverse values of a sensitive attribute,
  an attacker can still learn information if the distribution inside
  your group looks very different from the whole dataset.

  t = 0.20 means the distribution inside any group can deviate by
  at most 20% from the overall dataset distribution.

Recommended t values:
  t = 0.50  → Lenient (basic protection)
  t = 0.20  → Standard (recommended default)
  t = 0.10  → Strict
  t = 0.05  → Very strict (medical/census data)
```

---

### 4.4 — Sample Size Auto-Suggestion

```python
def suggest_sample_size(total_rows):
    """
    Strategy: balance between computational speed and statistical accuracy.
    
    Use the standard statistical formula for sample size:
    n = Z² × p × (1-p) / e²
    
    Where:
      Z = 1.96  (95% confidence level)
      p = 0.5   (maximum variance assumption — most conservative)
      e = margin of error (chosen based on dataset size)
    """
    Z = 1.96
    p = 0.5

    if total_rows <= 500:
        # Small dataset — always use 100%, no point sampling
        return {
            'suggested_pct' : 100,
            'suggested_n'   : total_rows,
            'reason'        : "Dataset is small — using 100% for maximum accuracy."
        }

    elif total_rows <= 5000:
        # Medium dataset — use 5% margin of error
        e = 0.05
        n_required = int((Z**2 * p * (1-p)) / (e**2))
        # Apply finite population correction
        n_corrected = int(n_required / (1 + (n_required - 1) / total_rows))
        pct = min(100, max(50, int(n_corrected / total_rows * 100)))
        return {
            'suggested_pct' : pct,
            'suggested_n'   : n_corrected,
            'reason'        : (f"With {pct}% sample ({n_corrected} rows), "
                               f"results accurate to ±5% at 95% confidence.")
        }

    else:
        # Large dataset (>5000 rows) — 2% margin of error, max 10,000 rows
        e = 0.02
        n_required  = int((Z**2 * p * (1-p)) / (e**2))
        n_corrected = min(n_required, 10000)
        pct = max(10, int(n_corrected / total_rows * 100))
        return {
            'suggested_pct' : pct,
            'suggested_n'   : n_corrected,
            'reason'        : (f"With {pct}% sample ({n_corrected} rows), "
                               f"results accurate to ±2% at 95% confidence. "
                               f"Increase to 100% for exact results.")
        }
```

---

## STAGE 5: UI Rendering Specification

### 5.1 — Column Selector Panel Layout

```
After upload, show this panel BEFORE "Run Assessment":

┌─────────────────────────────────────────────────────────────────────┐
│  📋 COLUMN ANALYSIS  —  analysis_filename.csv  |  N rows, M columns │
│  We've analysed your columns and pre-selected the most likely        │
│  quasi-identifiers and sensitive attributes. Review and adjust.      │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐  ┌───────────────────────────────┐
│  ⚠️  DIRECT IDENTIFIERS          │  │  🔴 QUASI-IDENTIFIERS          │
│  These may need to be removed    │  │  Columns that can indirectly   │
│  before releasing the dataset.   │  │  identify individuals.         │
│                                  │  │                                │
│  ⚠️ FSU_Serial_No  [100% unique] │  │  ✅ Round_Centre_Code  🟢      │
│     "Every value is unique —     │  │     "6 distinct values |       │
│      likely a direct ID"         │  │      cardinality=0.06"         │
│  [ Move to QI ] [ Remove ]       │  │  ✅ Round              🟢      │
│                                  │  │  ✅ District_Code      🟡      │
│                                  │  │  ☐  Sch_No             🔵      │
└──────────────────────────────────┘  └───────────────────────────────┘

┌──────────────────────────────────┐  ┌───────────────────────────────┐
│  🟠 SENSITIVE ATTRIBUTES         │  │  ⚪ IGNORE                     │
│  Values whose disclosure         │  │  These columns have no         │
│  could harm the individual.      │  │  privacy relevance.            │
│                                  │  │                                │
│  ✅ State          🟢            │  │  ☐ Record_Type                 │
│  ✅ HHID           🟡            │  │  ☐ Filler_Col                  │
│  ✅ MLT_SR         🔵            │  │                                │
│                                  │  │                                │
└──────────────────────────────────┘  └───────────────────────────────┘

[ ← Reset to Auto-Suggestions ]         [ Confirm Selection → ]
```

---

### 5.2 — Parameter Suggestion Panel

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚙️  PRIVACY PARAMETERS  —  Auto-suggested based on your data        │
└─────────────────────────────────────────────────────────────────────┘

K-ANONYMITY                                              Suggested: 5
  ━━━━━━━━━●━━━━━━━━━━━━━━━━━  [1 ─────────── 25]
  ℹ "With k=5, approximately 90% of records will be in equivalence
    classes of at least 5 people. Currently 100% of records are
    singletons — significant generalisation needed."
  
  [?] k=2: minimal  |  k=5: standard  |  k=10: strict  |  k=25: very strict

L-DIVERSITY                                              Suggested: 3
  ━━━━━━●━━━━━━━━━━━━━━━━━━━━  [2 ─────────── 10]
  ℹ "Average EC currently has 1.0 distinct State values.
    l=3 would require some restructuring."

T-CLOSENESS                                              Suggested: 0.20
  ━━━━━━━━━━━━━━━●━━━━━━━━━━━  [0.05 ─────── 0.50]
  ℹ "Average distribution distance: 0.41. At t=0.20, 
    78% of ECs would currently violate."

SAMPLE SIZE                                              Suggested: 100%
  ━━━━━━━━━━━━━━━━━━━━━━━━━●━  [10% ─────── 100%]
  ℹ "Dataset has 100 rows — using 100% for exact results."

[ ← Use Suggested Values ]       [ Run Assessment → ]
```

---

### 5.3 — QI Contribution Warning

Before running, if any QI has a marginal risk contribution >30%, show:

```
⚠️  HIGH-RISK QUASI-IDENTIFIER DETECTED

FSU_Serial_No alone contributes +87% to re-identification risk.
This column has 87 unique values across 100 rows.

Options:
  [A] Keep as QI and see full risk (recommended — shows true exposure)
  [B] Remove from QI list (underestimates risk, not recommended)
  [C] Move to Direct Identifier zone and suppress before release
```

---

## COMPLETE MASTER FUNCTION

```python
def auto_assist_pipeline(csv_path):
    """
    Master function. Call this immediately after CSV upload.
    Returns everything needed to pre-populate the UI.
    """
    import pandas as pd

    df = pd.read_csv(csv_path)
    N  = len(df)
    M  = len(df.columns)

    # Stage 1: Profile every column
    profiles = {}
    for col in df.columns:
        profiles[col] = profile_column(df[col], N)

    # Stage 2: Classify every column
    classifications = {}
    for col, profile in profiles.items():
        cls, confidence, reason = classify_column(profile)
        classifications[col] = {
            'classification' : cls,
            'confidence'     : confidence,
            'reason'         : reason,
            'profile'        : profile
        }

    # Separate into lists
    direct_ids  = [c for c, d in classifications.items() if d['classification'] == 'DIRECT_ID']
    quasi_ids   = [c for c, d in classifications.items() if d['classification'] == 'QUASI_ID']
    sensitives  = [c for c, d in classifications.items() if d['classification'] == 'SENSITIVE']
    ignores     = [c for c, d in classifications.items() if d['classification'] == 'IGNORE']

    # Stage 3: QI Risk Contribution (only if QIs exist)
    qi_contributions = {}
    if quasi_ids:
        qi_contributions = qi_risk_contribution(df, quasi_ids)

    # Stage 4: Parameter suggestions
    k_suggestion              = suggest_k(df, quasi_ids)
    suggested_k               = k_suggestion['suggested_k']
    suggested_l, l_details    = suggest_l(df, quasi_ids, sensitives, suggested_k)
    suggested_t, t_details    = suggest_t(df, quasi_ids, sensitives)
    sample_suggestion         = suggest_sample_size(N)

    return {
        'dataset_info': {
            'rows': N, 'columns': M, 'filename': csv_path
        },
        'column_classifications': classifications,
        'column_groups': {
            'direct_identifiers' : direct_ids,
            'quasi_identifiers'  : quasi_ids,
            'sensitive_attributes': sensitives,
            'ignore'             : ignores
        },
        'qi_contributions'   : qi_contributions,
        'suggested_params'   : {
            'k'           : suggested_k,
            'l'           : suggested_l,
            't'           : suggested_t,
            'sample_size' : sample_suggestion['suggested_pct']
        },
        'param_details': {
            'k': k_suggestion,
            'l': l_details,
            't': t_details,
            'sample': sample_suggestion
        }
    }
```

---

## SUMMARY TABLE — What Each Signal Detects

| Signal | Formula | Detects |
|--------|---------|---------|
| Cardinality Ratio | `unique / total` | High → Direct ID; Medium → QI |
| Shannon Entropy (normalised) | `H / log₂(k)` | Spread of values; high = identifier or SA |
| Gini Impurity (normalised) | `G / (1 - 1/k)` | Dominance of values; low = constant = ignore |
| Diversity Score | `0.6×H + 0.4×G` | Combined diversity |
| Top Value Frequency | `mode_count / total` | High → constant → ignore |
| Name Keyword Match | substring search | Domain-specific hints |
| Marginal EC Contribution | `ECs_with - ECs_without` | How much this QI drives uniqueness |
| EC Size Quantile (10th) | `quantile(0.10)` | Suggests k |
| Min L per EC | `min(distinct SA / EC)` | Suggests l |
| Mean TVD across ECs | `avg(TVD per EC)` | Suggests t |
| Statistical Sample Formula | `Z²p(1-p)/e²` | Suggests sample size |

---

*Specification version: 1.0 | Auto-Assist Classification Engine | MoSPI Statathon 2025 — SafeData Pipeline*
