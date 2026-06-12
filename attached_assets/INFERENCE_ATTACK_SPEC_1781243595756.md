# Risk Assessment Module — Inference Attack: Complete Specification

> **For Replit Agent**: Replace all existing mock/placeholder logic for the Inference Attack with the accurate implementations described below. This document covers: the Inference threat model, how it differs from Prosecutor/Journalist (re-identification attacks), the full math (correlation/predictability-based), per-attribute and per-record algorithms, worked examples using the actual uploaded dataset, and the required result sections in detail.

---

## 1. What is the Inference Attack?

The **Inference Attack** is fundamentally different from the Prosecutor and Journalist attacks. Those two are **re-identification attacks** — the goal is to point at a specific row and say "this is person X."

The **Inference Attack** is an **attribute-disclosure attack without re-identification**. The attacker does **not** need to find "the" record belonging to a target. Instead, the attacker asks:

> "Given that I know some non-sensitive attributes about a person (their Quasi-Identifiers), how accurately can I **predict/infer** one of their Sensitive Attributes — even if I never identify which row is theirs?"

**Key distinction:**

| | Prosecutor / Journalist | Inference |
|---|---|---|
| Goal | "Which row is this person?" | "What is this person's [sensitive value], even without knowing their row?" |
| Needs unique EC? | Yes (low EC size = high risk) | **No** — risk can be HIGH even when EC size is large |
| Mechanism | Linkage / matching | Statistical correlation / predictability |
| Worst case | Singleton record (EC=1) | An EC (of any size) where ALL records share the same SA value, OR a strong correlation exists between QIs and an SA across the whole dataset |

**Critical insight:** A dataset can pass Prosecutor and Journalist checks (large EC sizes, k-anonymity satisfied) and **still fail** the Inference Attack badly, if knowing someone's QIs lets you guess their Religion, Social_Group, Land_Owned, etc. with high confidence — *without ever pinpointing their exact row*.

This is why Inference is its own attack type and is **not redundant** with l-diversity/t-closeness checks, even though it uses related underlying statistics — see §6 for how they differ.

---

## 2. Two Forms of Inference Risk Implemented in This Module

### 2.1 Form A — Equivalence-Class Homogeneity Inference (EC-level)

This reuses the same QI-based equivalence classes as Prosecutor/Journalist, but instead of asking "how many people share this EC" (re-identification), it asks:

> "Within this EC, how concentrated is the sensitive attribute's distribution? If concentrated, an attacker who only knows someone's QIs (and NOT that they're in this dataset, NOT which row) can still guess their SA value with high confidence."

This is mathematically related to l-diversity but reframed as a **probabilistic confidence score** rather than a pass/fail count.

### 2.2 Form B — Global Predictive Inference (Dataset-level, correlation-based)

This is **independent of equivalence classes entirely**. It measures:

> "Across the WHOLE dataset, how well can a simple classifier predict Sensitive Attribute SA using only the Quasi-Identifiers as features?"

This catches attacks that EC-based methods miss — e.g., if `State = Madhya Pradesh` correlates strongly with `Religion = Hinduism` across the dataset (even if EC sizes are large and diverse), an attacker can make a high-confidence population-level guess about anyone from Madhya Pradesh.

**Both forms must be computed and shown.** Form A is the "local/per-group" risk; Form B is the "global/statistical" risk. A dataset can score safely on one and dangerously on the other.

---

## 3. Form A — EC-Level Inference Math

For each Equivalence Class `EC` (grouped by selected QIs, exactly as in Prosecutor) and each Sensitive Attribute `SA`:

```
For EC with |EC| records and sensitive attribute SA:

  value_counts = count of each distinct value of SA within EC
  most_common_value = argmax(value_counts)
  most_common_count = value_counts[most_common_value]

  Inference_Confidence(EC, SA) = most_common_count / |EC|
```

**Intuition:**
- `Inference_Confidence = 1.0` → every record in this EC has the SAME value for SA. An attacker who identifies someone as belonging to this EC (via QIs alone, with NO re-identification needed) can state that person's SA value with 100% confidence.
- `Inference_Confidence = 1/n` (where n = number of distinct SA values) → SA is uniformly distributed within the EC — attacker's best guess is no better than random among the observed categories.

**Per-record inference risk (Form A):**

```
inference_risk_A(r, SA) = Inference_Confidence(EC(r), SA)
```

**Dataset-level Form A risk (per SA):**

```
Inference_Risk_A(SA) = (1/N) × Σ_r  Inference_Confidence(EC(r), SA)
```

(weighted average across all records — larger ECs contribute proportionally more records)

**Relationship to L-Diversity:**
- L-Diversity asks: "does this EC have at least `l` distinct SA values?" → **binary pass/fail**, ignores HOW skewed the distribution is.
- Form A Inference asks: "even if there ARE `l` distinct values, is one of them so dominant that an attacker's best guess is still highly likely correct?" → **continuous confidence score**.

**Example:** An EC of size 10 with SA values `[A,A,A,A,A,A,A,A,A,B]` has 2 distinct values → **passes** l-diversity with l=2. But `Inference_Confidence = 9/10 = 0.90` → an attacker guessing "A" is right 90% of the time. L-diversity alone would hide this; Form A Inference exposes it.

---

## 4. Form B — Global Predictive Inference Math

For each Sensitive Attribute `SA`, build a simple predictive model using the selected Quasi-Identifiers as input features:

```python
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import cross_val_score
from sklearn.dummy import DummyClassifier

# Encode QIs (categorical -> one-hot or ordinal encoding)
X = encode(df[quasi_identifiers])
y = df[SA]

# Baseline: what accuracy could you get by ALWAYS guessing the most frequent value?
baseline_model = DummyClassifier(strategy='most_frequent')
baseline_accuracy = cross_val_score(baseline_model, X, y, cv=min(5, smallest_class_count)).mean()

# Attacker model: simple decision tree using QIs only
attacker_model = DecisionTreeClassifier(max_depth=4, random_state=42)
attacker_accuracy = cross_val_score(attacker_model, X, y, cv=min(5, smallest_class_count)).mean()

# Inference lift = how much better than baseline the attacker does
inference_lift(SA) = attacker_accuracy - baseline_accuracy
```

**Metrics:**

| Metric | Formula | Meaning |
|---|---|---|
| Baseline Accuracy | accuracy of always guessing mode | "Naive" attacker with NO QI knowledge |
| Attacker Accuracy | CV accuracy of QI→SA classifier | Attacker WITH QI knowledge |
| Inference Lift | `Attacker Acc − Baseline Acc` | How much QIs help the attacker. **This is the key risk metric.** |
| Inference Risk Score (Form B) | `Attacker Accuracy` itself | Absolute predictive power |

**Interpretation thresholds (for Inference Lift):**

| Lift | Meaning | Status |
|---|---|---|
| `> 0.30` | QIs massively improve SA prediction | 🔴 CRITICAL |
| `0.10 – 0.30` | QIs meaningfully improve SA prediction | 🟡 MEDIUM |
| `< 0.10` | QIs barely help — SA is roughly independent of QIs | 🟢 LOW |

**For small datasets (N < 50, as with this 20-row dummy dataset):**
Cross-validation with 5 folds is unreliable (folds may have 4 rows each). For datasets this small:
- Use **Leave-One-Out Cross-Validation (LOOCV)** instead of 5-fold.
- Display a warning: *"Sample size too small for robust statistical inference — results are indicative only."*
- If `N < 10` per class for any SA value, skip Form B for that SA entirely and display: *"Insufficient data to compute Form B (Global Predictive) inference for [SA] — minimum 10 records per category required."*

---

## 5. Full Inference Attack Algorithm (Step by Step)

```python
def inference_attack(dataframe, quasi_identifiers, sensitive_attributes, k, l, t, sample_size_pct):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct/100, random_state=42)
    N = len(df)

    # Step 2: Build Equivalence Classes (same as Prosecutor)
    ec_groups = df.groupby(quasi_identifiers)
    ec_sizes = ec_groups.size().reset_index(name='ec_size')
    df = df.merge(ec_sizes, on=quasi_identifiers, how='left')

    results = {'N': N, 'form_a': {}, 'form_b': {}}

    for sa in sensitive_attributes:

        # ----- FORM A: EC-level homogeneity -----
        ec_sa_mode = ec_groups[sa].agg(
            lambda x: x.value_counts().iloc[0] / len(x)
        ).reset_index(name='inference_confidence')

        df = df.merge(ec_sa_mode, on=quasi_identifiers, how='left',
                       suffixes=('', f'_{sa}'))

        form_a_dataset_risk = df['inference_confidence'].mean()  # weighted by record count automatically

        # Per-EC breakdown for display
        ec_breakdown = []
        for name, group in ec_groups:
            value_counts = group[sa].value_counts()
            mode_value = value_counts.index[0]
            mode_count = value_counts.iloc[0]
            confidence = mode_count / len(group)
            ec_breakdown.append({
                'qi_values': dict(zip(quasi_identifiers, name if isinstance(name, tuple) else (name,))),
                'ec_size': len(group),
                'most_common_sa_value': mode_value,
                'confidence': confidence,
                'distribution': value_counts.to_dict()
            })

        results['form_a'][sa] = {
            'dataset_risk': form_a_dataset_risk,
            'ec_breakdown': sorted(ec_breakdown, key=lambda x: -x['confidence'])
        }

        # ----- FORM B: Global predictive inference -----
        class_counts = df[sa].value_counts()
        if class_counts.min() < 10 or N < 10:
            results['form_b'][sa] = {
                'status': 'insufficient_data',
                'message': f'Insufficient data to compute Form B inference for {sa} '
                            f'(minimum 10 records per category required; smallest '
                            f'category has {class_counts.min()} records).'
            }
            continue

        X = encode_features(df[quasi_identifiers])
        y = df[sa]

        cv_folds = 5 if N >= 50 else 'loocv'

        baseline_acc = compute_baseline_accuracy(y, cv_folds)
        attacker_acc = compute_attacker_accuracy(X, y, cv_folds)

        results['form_b'][sa] = {
            'status': 'ok',
            'baseline_accuracy': baseline_acc,
            'attacker_accuracy': attacker_acc,
            'inference_lift': attacker_acc - baseline_acc,
            'cv_method': cv_folds
        }

    # ----- Combined dataset-level inference score -----
    # Average Form A risk across all SAs (Form B uses lift, different scale —
    # do NOT average together; report separately)
    results['overall_form_a_risk'] = mean(
        results['form_a'][sa]['dataset_risk'] for sa in sensitive_attributes
    )

    return results
```

---

## 6. How This Differs From (and Relates To) L-Diversity / T-Closeness

This is the most common point of confusion — be precise in the UI copy:

| Check | Question Answered | Needs EC? | Output Type |
|---|---|---|---|
| **K-Anonymity** | "Can I find YOUR exact row?" | Yes | Pass/Fail per EC (count) |
| **L-Diversity** | "Does this EC have enough DISTINCT SA values?" | Yes | Pass/Fail per EC (binary, ignores skew) |
| **T-Closeness** | "Does this EC's SA distribution MATCH the global one?" | Yes | Distance metric per EC |
| **Inference (Form A)** | "Even with ≥l distinct values, can I still GUESS your SA value with high confidence?" | Yes (same ECs) | Continuous confidence score (0-1) |
| **Inference (Form B)** | "Across the WHOLE dataset, do QIs PREDICT SA, regardless of grouping?" | **No** | Model accuracy / lift |

**Important UI note:** Form A Inference and L-Diversity/T-Closeness use the **same equivalence classes** computed once — do not recompute groupby operations three separate times. Compute `ec_groups` once and derive all three checks from it (performance + consistency).

**Worked example showing why all three matter simultaneously**, using a hypothetical EC of size 10 for SA=`Religion`:

| Distribution | L-Diversity (l=2) | T-Closeness (t=0.2, global Hinduism%=50%) | Form A Inference Confidence |
|---|---|---|---|
| `[Hindu]×10` | FAIL (1 distinct) | FAIL (local=100% vs global=50%, dist=0.5>0.2) | **1.00** — certain |
| `[Hindu]×9, [Islam]×1` | PASS (2 distinct) | FAIL (local=90% vs global=50%, dist=0.4>0.2) | **0.90** — near-certain |
| `[Hindu]×6, [Islam]×4` | PASS (2 distinct) | borderline | **0.60** |
| `[Hindu]×5, [Islam]×5` | PASS (2 distinct) | PASS (matches global exactly) | **0.50** — coin flip |

Row 2 is the key example: it **passes l-diversity** but Form A Inference correctly flags it as a 90% confidence attack — this is the gap Form A fills.

---

## 7. Worked Example Using the Uploaded Dataset

Given the current configuration in the screenshot (QI = `Round` only; SA selection not fully visible, but assume `Religion`, `Social_Group`, `HH_Type`, `Land_Owned`, `Land_Possessed`, `Land_Cultivated`, `NIC_2008` per prior sensitive-attribute selections):

### Step 1 — Equivalence classes by `Round` (5 distinct values in the 20-row sample: Round 61, 62, 63, 66, 67, 68, 69, 71, 72, 74)

Each `Round` value likely has 1-3 records (small ECs).

### Step 2 — Form A for `Religion`

For each `Round` group, compute the most common Religion and its share. With ECs of size 1-3 and ~5 distinct Religion categories in a 20-row dataset, many ECs will have `inference_confidence = 1.0` simply because the EC is small (size 1 or 2 with matching values by chance) — **this will likely produce a HIGH Form A score, possibly misleadingly high due to small sample size**.

**⚠️ Display this caveat prominently:** *"With only 20 records and an average EC size below 2, Form A Inference Confidence scores near 1.0 may simply reflect small-sample noise rather than a genuine population-level pattern. Form B (Global Predictive) results, where computable, are more reliable for small datasets — but may be marked 'insufficient data' here too."*

### Step 3 — Form B for `Religion`

With only 20 records spread across ~5-6 Religion categories (Christianity, Others, Sikhism, Jainism, Islam, Hinduism observed in the data), most categories will have **fewer than 10 records**. Per §4's rule, **Form B should report "insufficient data" for most/all SAs** with this dataset size.

**Expected actual output for this dataset:** Form A will show high (possibly 1.0) scores for most SAs due to small EC sizes; Form B will mostly show "insufficient data" warnings. **This is the CORRECT and EXPECTED behavior for a 20-row dummy dataset** — do not treat low Form B coverage as a bug.

---

## 8. What the Results Panel Should Display

### 8.1 Attack Summary Banner (Top)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🟣  INFERENCE ATTACK RESULTS                            RISK LEVEL: [X]      │
│  Dataset: [filename]  |  Rows analysed: [N]  |  QIs used: [list]             │
│  Sensitive Attributes analysed: [list]                                       │
└──────────────────────────────────────────────────────────────────────────────┘

Plain-English Summary:
"An attacker who knows someone's [QI1], [QI2] — WITHOUT needing to find that
person's exact row — can guess their [SA_with_highest_risk] correctly
[X]% of the time on average (Form A). [If Form B available:] Additionally,
knowing [QI list] improves prediction accuracy of [SA] by [Y] percentage
points over a naive guess (Form B Inference Lift)."
```

### 8.2 Key Metrics Row (4-6 cards)

| Card | Value | Label | Status |
|---|---|---|---|
| Highest Form A Risk | `X%` (and which SA) | Worst-case "guess your attribute from your group" confidence | 🔴 if >70%, 🟡 40-70%, 🟢 <40% |
| Avg Form A Risk (all SAs) | `X%` | Overall attribute-guessing risk across selected SAs | same thresholds |
| Highest Form B Lift | `+X pp` (and which SA) | Worst-case improvement an attacker gets from knowing QIs | 🔴 if >30pp, 🟡 10-30pp, 🟢 <10pp |
| SAs with Form B computed | `X / Y` | How many SAs had enough data for the global model | informational |
| Form A vs L-Diversity gap | `X` ECs | ECs that PASS l-diversity but have Form A confidence > 0.8 | 🔴 highlight these — "hidden" risk |

### 8.3 Per-Sensitive-Attribute Breakdown (repeat for EACH selected SA)

For each SA, show a card/section with:

```
═══════════════════════════════════════════════════
SENSITIVE ATTRIBUTE: [SA_NAME]
═══════════════════════════════════════════════════

FORM A — Group-Based Inference
  Dataset-wide average confidence: [X]%
  Status: 🔴/🟡/🟢

  Worst Equivalence Classes (sorted by confidence, top 5):
  ┌─────────────────────┬──────────┬─────────────────┬────────────┬──────────────────────┐
  │ QI Combination       │ EC Size  │ Most Common [SA]│ Confidence │ Full Distribution     │
  ├─────────────────────┼──────────┼─────────────────┼────────────┼──────────────────────┤
  │ Round=61              │   2      │ Scheduled Tribe │   100%     │ {ST: 2}              │
  │ Round=62              │   3      │ Scheduled Caste │   67%      │ {SC: 2, OBC: 1}      │
  │ ...                   │  ...     │ ...             │   ...      │ ...                  │
  └─────────────────────┴──────────┴─────────────────┴────────────┴──────────────────────┘

FORM B — Global Predictive Inference
  [If status = 'ok']:
    Baseline accuracy (naive "always guess mode"): [X]%
    Attacker accuracy (QI → SA model): [Y]%
    Inference Lift: +[Y-X] percentage points
    Cross-validation method: [5-fold / LOOCV]
    Status: 🔴/🟡/🟢

  [If status = 'insufficient_data']:
    ⚠️ "Insufficient data to compute Form B for [SA] — minimum 10 records
        per category required. Smallest category ([value]) has only [N]
        records. Form A (group-based) results above remain valid."
═══════════════════════════════════════════════════
```

**This per-SA breakdown is the core deliverable** — analogous to the Record-Level Attack Trace in the Prosecutor spec. Without it, the Inference attack just shows two abstract numbers with no actionable detail.

### 8.4 "How This Attack Works on YOUR Data" — Narrative

```
🔍 ATTACK SIMULATION — Inference Attack Walkthrough

Scenario: An attacker (e.g., a data broker, employer, or insurer) has access
to this released dataset. They know ONE thing about a person — their
[QI1] = [actual value from worst EC] — perhaps from a job application form.
They do NOT know which row in this dataset belongs to that person, and they
don't need to.

Step 1 — Filter by known QI
  The attacker filters the dataset to all [EC_size] records where
  [QI1] = [value]. (No re-identification — just a group filter.)

Step 2 — Read off the dominant Sensitive Attribute value
  Within this group, [mode_count] out of [ec_size] records have
  [SA] = [mode_value]. The attacker concludes:
  "[X]% chance this person's [SA] is [mode_value]."

Step 3 — Use the inference
  The attacker now has a high-confidence guess about this person's
  [SA] (e.g., Social_Group, Religion, Land holdings) WITHOUT EVER
  KNOWING WHICH ROW BELONGED TO THEM. K-anonymity, which only protects
  against row-identification, provides NO protection against this.

Step 4 — Scale
  [N_ec] out of [total_ECs] equivalence classes have Form A confidence
  ≥ 80% for at least one sensitive attribute.
  [X]% of records fall into such high-inference-risk groups.
```

### 8.5 Form A Confidence Distribution (Chart, per SA)

| Confidence Range | # ECs | # Records | % Dataset | Meaning |
|---|---|---|---|---|
| 0.90 – 1.00 | ... | ... | ...% | Attacker near-certain of SA value |
| 0.70 – 0.89 | ... | ... | ...% | Attacker likely correct |
| 0.50 – 0.69 | ... | ... | ...% | Attacker better than random |
| < 0.50 | ... | ... | ...% | SA well-protected within group |

Bar chart, color-coded red/orange/yellow/green matching the ranges above. **One chart per selected Sensitive Attribute**, or a tabbed/toggle view if multiple SAs are selected.

### 8.6 Form A vs L-Diversity Cross-Check Table (NEW — important)

This directly visualizes the gap described in §6:

| QI Combination | EC Size | L-Diversity Status (l=[user_l]) | Form A Confidence | Flag |
|---|---|---|---|---|
| Round=61 | 2 | ✅ PASS (2 distinct values) | 0.90 | 🔴 **HIDDEN RISK** |
| Round=63 | 1 | ❌ FAIL (1 distinct value) | 1.00 | (already flagged by L-Diversity) |
| Round=67 | 5 | ✅ PASS (3 distinct values) | 0.45 | ✅ Genuinely safe |

**Highlight rows where L-Diversity PASSES but Form A Confidence > 0.7** — these are blind spots that l-diversity alone misses. This table is arguably the single most valuable output of the entire Inference module, because it shows the officer exactly where their existing privacy checks (k-anonymity/l-diversity) give false confidence.

### 8.7 Form B Model Performance Table (across all SAs)

| Sensitive Attribute | Baseline Acc. | Attacker Acc. (QI model) | Inference Lift | Status |
|---|---|---|---|---|
| Religion | [X]% or "insufficient data" | ... | ... | ... |
| Social_Group | ... | ... | ... | ... |
| HH_Type | ... | ... | ... | ... |
| Land_Owned | ... (likely insufficient — too many distinct values) | | | |

**Note:** For continuous-like attributes (`Land_Owned`, `Land_Possessed`, `Land_Cultivated` — stored as strings like "37.4 acres" but effectively continuous), Form B as a classifier doesn't apply well. For these:
- **Either** bucket them into quantile bins (e.g., Low/Medium/High land ownership) before running Form B, OR
- Mark Form B as "Not Applicable — continuous attribute" and rely on Form A only (Form A's "most common value" for a continuous attribute within a small EC is still meaningful as "these people have very similar land holdings").

**This binning decision must be made explicit in the UI** — show a small toggle or note: *"Land_Owned treated as [X] bins for Form B analysis."*

### 8.8 Risk-Protection Summary (Inference-specific)

Unlike Prosecutor/Journalist's binary "At Risk / Protected" donut (based on EC size vs k), Inference risk is **continuous and per-SA**. Replace the donut with:

```
INFERENCE RISK SUMMARY

For each Sensitive Attribute, % of records in HIGH inference-risk groups
(Form A confidence ≥ 0.7):

Religion:       [████████░░] 80%   🔴
Social_Group:   [█████░░░░░] 50%   🟡
HH_Type:        [██░░░░░░░░] 20%   🟢
Land_Owned:     [██████████] 100%  🔴
...
```

Horizontal bar per SA, with the same color thresholds as §8.2.

### 8.9 Recommendations Section (Auto-generated, Inference-specific)

```
RECOMMENDATIONS (Inference Attack)

🔴 CRITICAL — Form A confidence for [SA] is [X]% on average
   Action: Even though k-anonymity/l-diversity may pass, [N] equivalence
   classes have near-uniform [SA] values. Consider:
     - Adding noise/perturbation to [SA] within these groups
     - Suppressing [SA] entirely for records in groups flagged in §8.6
     - Increasing diversity by merging small ECs (broader generalisation
       of [QI list])

🟡 MEDIUM — Form B Inference Lift for [SA] is +[X]pp
   Action: [QI list] are strong predictors of [SA] across the WHOLE
   dataset, not just within groups. Consider removing or coarsening
   [most predictive QI, if identifiable from decision tree feature
   importance] to reduce this correlation.

🔵 INFO — [N] ECs PASS L-Diversity but show Form A confidence > 70%
   Action: Review the "Form A vs L-Diversity Cross-Check" table (§8.6).
   These groups give a false sense of security — l-diversity's distinct-
   count check does not capture distributional skew.

ℹ️ NOTE — Form B could not be computed for [SA list] due to insufficient
   data (minimum 10 records/category). Re-run with a larger dataset or
   combined sample for more reliable global predictive estimates.

ℹ️ NEXT STEP — Go to "Privacy Enhancement" → "Attribute Perturbation" or
   "Sensitive Attribute Generalisation" to address Form A risks directly;
   re-run this assessment afterward to verify confidence scores have
   decreased.
```

---

## 9. Attack Score for Top Navigation Bar

```
inference_score = overall_form_a_risk × 100
```

(Form B lift is reported separately and not folded into this score, since it's on a different scale and may be "insufficient data" for many SAs — averaging it in would be misleading.)

Display alongside `prosecutor_score` / `journalist_score` in the Comparison tab. Color thresholds: 🔴 >70, 🟡 40-70, 🟢 <40 (note: **different thresholds from Prosecutor/Journalist**, since Form A confidence has a natural floor of `1/num_categories`, not 0 — a "safe" inference score is realistically higher than a "safe" re-id score).

---

## 10. Validation / Sanity Checks (for testing this implementation)

1. **Form A confidence is always ≥ `1/(number of distinct SA values in that EC)`** and ≤ 1.0. A value of exactly `1/n` (where n = distinct values present) corresponds to a perfectly uniform distribution within the EC.
2. **Form A confidence = 1.0 whenever EC size = 1** (a single record trivially has 100% "confidence" — the only value present). This is expected, NOT a bug, and is precisely why the §7 caveat about small EC sizes is necessary.
3. **Form B baseline accuracy = (count of most frequent SA value) / N** — this should match a simple `value_counts().max() / len()` computation, independent of any QIs. If the "baseline" model's accuracy doesn't match this, the encoding or CV setup is broken.
4. **Form B attacker accuracy ≥ Form B baseline accuracy is NOT guaranteed** — with weak QIs or small data, a decision tree can OVERFIT and perform worse than baseline under cross-validation. A negative `inference_lift` is a valid (if unusual) result and should be displayed as-is (floor display at 0 for the "Lift" status color, but show the true signed value in the table).
5. **§8.6 cross-check table row count = total number of ECs** — every EC appears exactly once, regardless of whether it passes or fails L-Diversity.
6. For this specific 20-row dataset: **expect Form B to report "insufficient data" for most/all SAs**, and Form A to show many high (near-1.0) confidence values due to small EC sizes. A run that shows Form B working smoothly with high accuracy on this dataset should be treated with suspicion (likely means the "insufficient data" guard (§4, §5) was not implemented).

---

## 11. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size
       ↓
[Run Assessment clicked, "Inference" checked]
       ↓
1. Sample dataset (sample_size_pct)
2. Build equivalence classes (groupby QIs) — REUSE from Prosecutor/L-Div/T-Close
3. For each Sensitive Attribute SA:
     a. FORM A: compute per-EC mode value + confidence (most_common_count/ec_size)
        -> dataset_risk = mean(confidence) across all records
     b. Check class balance (min category count)
        - if < 10: mark Form B as "insufficient_data", skip to next SA
        - else: encode QIs, run baseline (DummyClassifier) and attacker
                (DecisionTreeClassifier) with CV (5-fold or LOOCV)
        -> inference_lift = attacker_acc - baseline_acc
4. Build Form A vs L-Diversity cross-check table (reuse L-Diversity EC results)
5. Build per-SA confidence distribution charts
6. Compute overall_form_a_risk = mean across all SA dataset_risks
7. Generate recommendations (per-SA, conditional on thresholds)
       ↓
Render results panel with ALL sections in §8 above
```

---

## 12. Implementation Notes for Replit Agent

1. **Reuse the equivalence-class groupby from the Prosecutor/L-Diversity computation** — do not recompute `df.groupby(quasi_identifiers)` separately for Inference. Pass the grouped object (or its cached results) into this module.
2. **The §8.3 per-SA breakdown and §8.6 cross-check table are mandatory** — these are the actionable outputs. The summary cards in §8.2 alone are not sufficient (analogous to how Prosecutor's Record-Level Trace Table is mandatory, not just the 4 summary cards).
3. **Continuous-like Sensitive Attributes** (`Land_Owned`, `Land_Possessed`, `Land_Cultivated` — currently stored as strings like "37.4 acres") need a parsing step (strip " acres", convert to float) before Form A mode-counting will be meaningful, since otherwise every value is technically distinct as a string and Form A confidence collapses to `1/ec_size` trivially. **Decide and document**: either (a) bin into quantiles before any computation, or (b) round to nearest integer acre before mode-counting. Document the chosen approach in the UI per §8.7.
4. **The "insufficient data" guard (§4, §5, validation #6) is mandatory** and must actually suppress Form B computation — do not silently run sklearn on tiny folds and report a meaningless number.
5. **All thresholds/colors in §8.2, §8.5, §8.8, §9 must be implemented as configurable constants**, not hardcoded inline, since they differ from the Prosecutor/Journalist thresholds (a "safe" Form A score is NOT < 5% the way re-id risk is — it's < 40%, because of the `1/n` floor).
6. **Status badges** in the top nav for "Inference" should reflect `inference_score` (§9) independently.

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
