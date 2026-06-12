# Risk Assessment Module — Membership Inference Attack: Complete Specification

> **For Replit Agent**: Replace all existing mock/placeholder logic for the Membership Inference Attack with the accurate implementations described below. This document covers: the Membership Inference threat model, how it differs from Prosecutor/Journalist/Inference, the full math (similarity/distance and density-based formulations), the per-record/dataset algorithm, worked guidance for the uploaded dataset, and the required result sections in detail.

---

## 1. What is the Membership Inference Attack?

The **Membership Inference Attack (MIA)** answers a yes/no question that is subtly but importantly different from every other attack in this module:

> "Was THIS SPECIFIC PERSON's record used in/included in this dataset AT ALL — yes or no?"

It is **not**:
- "Which row is theirs?" (that's Prosecutor)
- "Is their row in here, accounting for sampling?" (that's Journalist)
- "What is one of their attribute values?" (that's Inference)

It **is**:
- "Did this person's data contribute to this released dataset/statistic/model — even if I can never point to which row?"

**Why this matters even when re-identification is impossible:**
Simply confirming that someone **participated** in a survey can itself be sensitive. Examples:
- A survey of households receiving a specific welfare scheme, NREGA job cards, or a health condition — confirming membership reveals the underlying sensitive fact (e.g., "this household IS in the NREGA beneficiary survey") without needing to know WHICH row.
- A survey conducted only in a specific district/community — confirming someone's household was surveyed could reveal their location/community affiliation.
- In ML contexts (if this dataset is later used to train a model), MIA against the trained model can reveal whether a specific individual's data was in the training set.

**Key distinction from Prosecutor:**

| | Prosecutor | Membership Inference |
|---|---|---|
| Question | "Which row is X?" | "Is X's data in this dataset at all?" |
| Attacker's starting knowledge | X's QI values, AND certainty X is in the dataset | X's full (or near-full) record (QIs + plausible SA values) from an EXTERNAL source, but **NOT** certainty about inclusion |
| Output | A specific row | A binary yes/no (with confidence) |
| Defeated by... | Generalisation, suppression (changes QIs) | **Cannot be fully defeated by QI generalisation alone** — depends on how "typical" or "distinctive" the FULL record is relative to the population this dataset was drawn from |

---

## 2. The Core Mathematical Idea: Distinguishability

MIA exploits the fact that records *actually in* a dataset tend to be **more similar to other records in the dataset** (and to the dataset's overall statistical profile) than records that are *not* in it — particularly for **outlier / unusual** records.

There are two standard formalizations. **This module implements both**, since they catch different risk patterns.

### 2.1 Form A — Record Distinctiveness / Outlier Score

**Question:** "Is this record's full combination of attribute values (QIs + SAs together) so UNUSUAL relative to the rest of the dataset that, if an attacker has a candidate record matching it, they can confidently say 'this person's data is almost certainly in here — nobody else looks like this'?"

This is a **self-contained, single-dataset** test — it does not require an external "shadow" dataset.

**Algorithm (per record):**

```
For record r, using ALL selected attributes (QIs + SAs combined):

  1. Compute a similarity/distance score between r and every other record r'
     in the dataset (e.g., Gower distance for mixed categorical/numeric data,
     or simple Hamming distance for fully categorical attributes).

  2. nearest_neighbor_distance(r) = min( distance(r, r') for all r' != r )

  3. outlier_score(r) = nearest_neighbor_distance(r)
     (normalized to [0,1] by dividing by the max possible distance)
```

**Interpretation:**
- `outlier_score(r) ≈ 0` → record `r` has a near-identical "twin" elsewhere in the dataset. Even if an attacker has X's full attribute profile, they can't distinguish "X is the source of row 7" from "X is the source of row 14" — there's plausible deniability about WHICH record is theirs, AND about whether their specific data point (as opposed to a near-identical other person's) is what's reflected.
- `outlier_score(r) ≈ 1` → record `r` is highly unusual — no other record looks like it. If an attacker has a candidate profile matching X that is ALSO highly unusual, and it matches `r` closely, they can be confident **"a record with this unusual profile IS in this dataset"** — i.e., membership inference succeeds, **even without confirming it's row r specifically vs. some hypothetical similar row.**

**Dataset-level Form A risk:**

```
Membership_Risk_A = (1/N) × Σ_r  outlier_score(r)
```

Also report the **distribution** (not just the mean) — a dataset can have a low average but a few extreme outliers that are individually very high-risk.

### 2.2 Form B — Population-Relative Membership Score (Shadow/Reference-Based)

**Question:** "Compared to the GENERAL POPULATION (not just this dataset), how unusual is this record? If a record is rare in the general population but appears in this dataset, an attacker with that rare profile gains strong evidence the dataset specifically includes 'people like them.'"

This requires a **reference distribution** for the population — for survey microdata, this can be approximated using:
- The `Multiplier_comb` column (same expansion-weight logic as the Journalist attack — §2, Journalist spec), which gives an estimate of how many people in the population share similar characteristics.
- OR, if available, marginal distributions from Census/external published tables for individual QI/SA columns (out of scope for v1 — flag as a future enhancement).

**Algorithm (per record, using Multiplier_comb as proxy):**

```
For record r:

  population_rarity(r) = 1 / Multiplier_comb(r)

  # Multiplier_comb represents how many population units this single
  # sampled record "represents". A LOW Multiplier_comb means this record
  # represents very few people in the population => the record's profile
  # is RARE in the population => higher membership-inference risk if this
  # exact profile is observed in the released data.

  membership_risk_B(r) = normalize(population_rarity(r))
                       = (1/Multiplier_comb(r)) / max(1/Multiplier_comb(r') for all r')
```

**Dataset-level Form B risk:**

```
Membership_Risk_B = (1/N) × Σ_r  membership_risk_B(r)
```

**Relationship to Journalist Attack:** Form B here is the SAME `Multiplier_comb` data used in the Journalist spec, but interpreted differently:
- **Journalist attack** asks: "if I know this profile, how many ROWS in the population match it?" → used to discount RE-IDENTIFICATION confidence.
- **Membership Form B** asks: "if this profile is RARE in the population, and I see it in the released data, how confident am I that 'someone with this rare profile' PARTICIPATED?" → a LOW `Multiplier_comb` (rare in population) INCREASES membership risk, the OPPOSITE direction of how it affects Journalist re-id risk discounting.

**This inverse relationship must be explained clearly in the UI** — see §8.1.

---

## 3. Combined Membership Risk Score

```
Membership_Risk(r) = combine(Form_A(r), Form_B(r))
```

**Recommended combination (v1):** Report Form A and Form B **separately** (do not average into a single number — they answer related-but-distinct questions and use different evidence). However, compute a **flag**:

```
high_membership_risk(r) = (Form_A(r) >= 0.7) OR (Form_B(r) >= 0.7)
```

A record is flagged if it's an outlier WITHIN the dataset (Form A) OR rare relative to the population (Form B) — either condition alone is sufficient for elevated membership-inference risk.

**Dataset-level summary:**

```
pct_high_membership_risk = count(high_membership_risk(r) for all r) / N × 100
```

---

## 4. Distance Metric Details (Form A)

Since this dataset has a mix of categorical (Religion, Social_Group, HH_Type, State, etc.) and numeric/quasi-numeric (HH_Size, NREG_Job_Card count fields, Land_Owned/Possessed/Cultivated as "X.X acres" strings) attributes, use **Gower's Distance**:

```python
def gower_distance(r1, r2, attributes):
    """
    For each attribute, compute a per-attribute distance in [0,1], then average.
    """
    total = 0
    for attr in attributes:
        if is_numeric(attr):
            # Range-normalized absolute difference
            range_attr = df[attr].max() - df[attr].min()
            if range_attr == 0:
                d = 0
            else:
                d = abs(r1[attr] - r2[attr]) / range_attr
        else:
            # Categorical: 0 if same, 1 if different
            d = 0 if r1[attr] == r2[attr] else 1
        total += d
    return total / len(attributes)
```

**Preprocessing required for this dataset:**
- `Land_Owned`, `Land_Possessed`, `Land_Cultivated` — strip " acres" suffix, parse to float, treat as numeric for Gower distance.
- `NREG_Job_Card`, `No_NREG_Card`, `Saving_Bank_Held_by_any_member` — Yes/No or count fields; treat Yes/No as categorical (binary), counts as numeric.
- All other selected attributes (Religion, State, District, Social_Group, HH_Type, Sector, etc.) — categorical.
- **Direct identifiers** (FSU_Serial_No, Sch_No, District_code, Multiplier_comb itself, etc.) — **EXCLUDE from the Form A distance calculation** (these are already flagged separately as "Direct Identifiers Detected" in the UI per the Prosecutor spec; including them would make every record artificially "unique").

**Which attributes to include in Form A's distance calculation:**
Use the **union of selected Quasi-Identifiers AND Sensitive Attributes** (both, combined) — NOT just QIs. This is a critical difference from Prosecutor/Journalist/Inference, where QIs and SAs play separate roles. For Membership Inference, **the attacker's external knowledge may include BOTH** (e.g., a data broker profile of someone might include their religion, social group, AND land holdings together) — what matters is the OVERALL distinctiveness of the full profile.

**UI requirement:** Display which columns were included in the distance calculation explicitly:
```
Membership Inference uses ALL selected attributes (Quasi-Identifiers + Sensitive
Attributes combined) to assess record distinctiveness: [full list of columns]
```

---

## 5. Full Membership Inference Algorithm (Step by Step)

```python
def membership_inference_attack(dataframe, quasi_identifiers, sensitive_attributes,
                                   k, l, t, sample_size_pct):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct/100, random_state=42)
    N = len(df)

    # Step 2: Determine the attribute set for Form A
    # Union of QIs and SAs, EXCLUDING flagged direct identifiers
    profile_attributes = list(set(quasi_identifiers) | set(sensitive_attributes))
    profile_attributes = [a for a in profile_attributes if a not in DIRECT_IDENTIFIERS]

    if len(profile_attributes) == 0:
        return {'status': 'no_attributes_selected',
                'message': 'Select at least one Quasi-Identifier or Sensitive '
                            'Attribute to run Membership Inference.'}

    # Step 3: Preprocess attributes for Gower distance
    df_processed = preprocess_for_gower(df, profile_attributes)
    # - parse "X.X acres" -> float for Land_Owned/Possessed/Cultivated
    # - encode Yes/No -> 1/0
    # - leave categoricals as-is (handled inside gower_distance)

    # Step 4: FORM A — Nearest-neighbor distinctiveness
    n = len(df_processed)
    distance_matrix = compute_pairwise_gower(df_processed, profile_attributes)  # n x n

    nn_distances = []
    for i in range(n):
        dists = [distance_matrix[i][j] for j in range(n) if j != i]
        nn_distances.append(min(dists) if dists else 1.0)  # if N=1, max risk

    df['form_a_outlier_score'] = nn_distances
    membership_risk_A = mean(nn_distances)

    # Step 5: FORM B — Population-relative rarity (using Multiplier_comb)
    if 'Multiplier_comb' in df.columns:
        rarity = 1.0 / df['Multiplier_comb']
        df['form_b_population_rarity'] = rarity / rarity.max()  # normalize to [0,1]
        membership_risk_B = df['form_b_population_rarity'].mean()
        form_b_status = 'ok'
    else:
        df['form_b_population_rarity'] = None
        membership_risk_B = None
        form_b_status = 'multiplier_comb_unavailable'

    # Step 6: Combined flag
    if form_b_status == 'ok':
        df['high_membership_risk'] = (
            (df['form_a_outlier_score'] >= 0.7) |
            (df['form_b_population_rarity'] >= 0.7)
        )
    else:
        df['high_membership_risk'] = (df['form_a_outlier_score'] >= 0.7)

    pct_high_risk = df['high_membership_risk'].mean() * 100

    # Step 7: Top-N most distinctive records
    top_distinctive = df.nlargest(10, 'form_a_outlier_score')

    return {
        'N': N,
        'profile_attributes_used': profile_attributes,
        'membership_risk_A': membership_risk_A,
        'membership_risk_B': membership_risk_B,
        'form_b_status': form_b_status,
        'pct_high_risk_records': pct_high_risk,
        'form_a_distribution': df['form_a_outlier_score'].value_counts(
            bins=[0, 0.2, 0.4, 0.6, 0.8, 1.0]).to_dict(),
        'top_distinctive_records': top_distinctive[
            profile_attributes + ['form_a_outlier_score', 'form_b_population_rarity',
                                    'high_membership_risk']
        ].to_dict('records'),
        'all_records': df[profile_attributes + [
            'form_a_outlier_score', 'form_b_population_rarity', 'high_membership_risk'
        ]].to_dict('records')
    }
```

---

## 6. How This Differs From (and Relates To) Other Attacks in This Module

| Attack | Question | Uses EC (groupby)? | Uses distance/similarity? | Uses Multiplier_comb? |
|---|---|---|---|---|
| Prosecutor | Which row is X (attacker certain X is in dataset)? | Yes | No | No |
| Journalist | Which row is X (attacker uncertain X is sampled)? | Yes | No | Yes (population EC estimate) |
| Inference | What is X's sensitive attribute (no row needed)? | Yes (Form A) / No (Form B) | No | No |
| **Membership** | **Is X's record in this dataset AT ALL (binary)?** | **No** | **Yes (Form A: nearest-neighbor)** | **Yes (Form B: rarity, inverse use)** |

**Key conceptual point for the UI copy:** Prosecutor/Journalist/Inference all rely on grouping records by shared Quasi-Identifier values (equivalence classes). **Membership Inference does NOT use equivalence classes at all** — it asks a per-record distinctiveness question across the FULL attribute profile. A record can be in a large, well-protected EC (safe from Prosecutor/Journalist/Inference) and STILL be the single most unusual record in the dataset overall (high Membership risk), if its combination of values across OTHER attributes (outside the EC's defining QIs) is rare.

**Worked example:** Suppose `Sector=Rural, State_Region=Maharashtra` is an EC of size 5 (well-protected: k=5). But within that EC, one record has `HH_Size=12` while the other four have `HH_Size=2-4`, AND that same record has `Land_Owned=49.9 acres` (near the dataset maximum) while others have 5-20 acres. That one record, despite being in a "safe" EC for Prosecutor purposes, has a **high Form A outlier score** — its overall profile across HH_Size + Land_Owned + other attributes makes it stand out, so an attacker with a matching external profile could confidently say "someone with THIS profile is in this dataset," even without identifying which of the 5 EC members it is... except that, because it's so different from the other 4, the attacker effectively narrows it down anyway. **This shows Form A capturing risk that EC-based metrics structurally cannot see.**

---

## 7. Worked Guidance for the Uploaded Dataset (20 rows)

Given the configuration in the screenshot — Sensitive Attributes appear to include `NREG_Job_Card`, `Saving_Bank_Held_by_any_member` (and possibly others from the partially-visible list), with k=3, l=2, t=0.30:

### Step 1 — Profile attributes for Form A
Combine whatever QIs were selected with the SAs visible (`NREG_Job_Card`, `Saving_Bank_Held_by_any_member`, and likely `Land_Cultivated` based on the partial checkbox visibility). Exclude direct identifiers per the orange warning box (FSU_Serial_No, Sch_No, District, District_code, Multiplier_comb, Land_Owned, Land_Possessed, Land_Cultivated — **wait**: if Land_Cultivated is both flagged as a "direct identifier" in the orange box AND selected as a Sensitive Attribute, this is a **configuration conflict** — see §9 for how to handle this.

### Step 2 — Expected Form A behavior for N=20
With only 20 records and a handful of categorical + numeric attributes, **Gower distances will likely be small but non-zero for most pairs** (categorical attributes like Religion, Social_Group have ~5-8 categories each, so exact matches across multiple categorical fields are statistically less likely with only 20 rows). Expect:
- Most `form_a_outlier_score` values in the **0.3 - 0.6** range (moderately distinctive — no exact "twins" but not wildly unusual either).
- A few records with notably HIGHER scores (0.7+) if they have extreme values for `HH_Size`, `Land_Owned`, etc. (e.g., the row with `HH_Size=12` or `Land_Owned=46.4 acres` observed in the raw data).

### Step 3 — Expected Form B behavior
`Multiplier_comb` values in the dataset range roughly from ~325 to ~1988 (observed in the raw CSV). The record with the LOWEST `Multiplier_comb` (≈325, the Mysuru/Odisha row) represents the FEWEST people in the population → **HIGHEST Form B rarity score**. The record with the HIGHEST `Multiplier_comb` (≈1988, the Jaipur/Himachal Pradesh row) represents the MOST people → LOWEST Form B rarity score.

**⚠️ Display this caveat:** *"Form B treats Multiplier_comb as a PROXY for population rarity. With only 20 records, Form B scores are relative WITHIN THIS SAMPLE only and should not be read as absolute population-level probabilities."*

---

## 8. What the Results Panel Should Display

### 8.1 Attack Summary Banner (Top)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🟤  MEMBERSHIP INFERENCE ATTACK RESULTS                  RISK LEVEL: [X]     │
│  Dataset: [filename]  |  Rows analysed: [N]                                  │
│  Profile attributes used (QI ∪ SA, identifiers excluded): [list]            │
└──────────────────────────────────────────────────────────────────────────────┘

Plain-English Summary:
"This attack asks a different question than the others: NOT 'which row is
this person' or 'what is their attribute', but 'is this person's data in
this dataset AT ALL'. [X]% of records ([N_high] out of [N]) have profiles
distinctive enough — either standing out within this dataset (Form A) or
rare in the wider population (Form B) — that an attacker with a matching
external profile could confidently confirm this person participated in
this survey, even without knowing which row is theirs."

⚠️ IMPORTANT — Why this matters even if Prosecutor/Journalist risk is LOW:
Membership Inference does NOT require finding "your" row. Even a perfectly
k-anonymous dataset (every EC size ≥ k) can leak the fact that "someone
with profile P participated" if profile P is unusual enough overall.
```

### 8.2 Key Metrics Row (4-5 cards)

| Card | Value | Label | Status |
|---|---|---|---|
| Avg Form A Outlier Score | `X` (0-1) | Average record distinctiveness within this dataset | 🔴 if >0.6, 🟡 0.3-0.6, 🟢 <0.3 |
| Avg Form B Population Rarity | `X` (0-1) or "N/A" | Average rarity relative to estimated population (via Multiplier_comb) | same thresholds, or grey "N/A" if Multiplier_comb unavailable |
| High-Risk Records | `N (X%)` | Records flagged on EITHER Form A or Form B ≥ 0.7 | 🔴 if >0, else 🟢 |
| Most Distinctive Record | Row #[X], score [Y] | The single highest-risk record — "no other record looks like this one" | 🔴 always shown |
| Profile Attributes Used | `K` columns | How many attributes (QI ∪ SA) feed into the distance calculation | informational |

### 8.3 Record-Level Membership Trace Table

**This is the core deliverable**, analogous to Prosecutor's Record-Level Attack Trace:

| Row # | [Profile attribute columns...] | Form A Score | Form B Score | Nearest Neighbor (Row #) | Status |
|---|---|---|---|---|---|
| 1 | ... | 0.45 | 0.32 | Row 7 | 🟢 LOW |
| 7 | ... | 0.45 | 0.18 | Row 1 | 🟢 LOW |
| 12 | ... | 0.82 | 0.71 | Row 3 (closest, but still far) | 🔴 HIGH RISK |

**New column vs other attack tables:** "**Nearest Neighbor (Row #)**" — shows WHICH other record this one is closest to, and implicitly how far. This gives the officer intuition: "Row 12's closest match is Row 3, but even that match is fairly different" → Row 12 stands alone.

**Filter bar:** `[ Show All ] [ 🔴 High Risk Only ] [ 🟢 Low Risk Only ]` + search, same pattern as Prosecutor.

### 8.4 "How This Attack Works on YOUR Data" — Narrative

```
🔍 ATTACK SIMULATION — Membership Inference Walkthrough

Scenario: An attacker has obtained a profile of a specific person — e.g.,
from a leaked HR database, a social media profile, or another linked
dataset — containing: [list of actual values from the MOST DISTINCTIVE
record, e.g., Religion=Jainism, Social_Group=OBC, HH_Size=11,
Land_Owned=4.5 acres, NREG_Job_Card=Yes, ...]

The attacker does NOT know if this person took part in this particular
survey. They want to find out.

Step 1 — Search for a close match
  The attacker scans this dataset's [K] profile attributes for records
  similar to their target profile.

Step 2 — Evaluate the closest match
  Row #[X] is the closest match, with a similarity distance of [1 - Form_A
  score] — i.e., [Form_A_score × 100]% different across the profile.

  [If Form A score is HIGH, e.g. > 0.7]:
  "This is a POOR match — no record in the dataset closely resembles the
  target profile. HOWEVER, this absence itself can be informative: if the
  attacker independently knows this dataset is meant to be representative
  of people like their target (e.g., a survey of a specific scheme's
  beneficiaries), the FACT that such a distinctive profile appears
  (Row #X itself, if it resembles the target) confirms 'someone like this'
  is in the data."

  [If Form A score is LOW, e.g. < 0.3]:
  "Multiple records closely resemble this profile (Row #[X] and Row #[Y]
  are both close matches). The attacker CANNOT confidently distinguish
  'my target's data' from 'a similar-looking other person's data' —
  this provides plausible deniability."

Step 3 — Population context (Form B)
  [If Multiplier_comb available]:
  "This profile's estimated population rarity is [Form_B_score]. [If high:]
  Profiles like this are RARE in the general population — if the attacker
  ALSO knows this dataset specifically surveys [population description],
  finding ANY closely-matching record strongly suggests their target
  participated."

Step 4 — Scale
  [N_high] out of [N] records ([X]%) have a high membership-inference risk
  (Form A ≥ 0.7 OR Form B ≥ 0.7).
```

### 8.5 Form A Distribution (Chart + Table)

| Outlier Score Range | # Records | % Dataset | Meaning |
|---|---|---|---|
| 0.00 – 0.19 | ... | ...% | Has a near-identical twin — strong plausible deniability |
| 0.20 – 0.39 | ... | ...% | Similar records exist |
| 0.40 – 0.59 | ... | ...% | Moderately distinctive |
| 0.60 – 0.79 | ... | ...% | Quite unusual |
| 0.80 – 1.00 | ... | ...% | 🔴 Highly distinctive — effectively a "loner" record |

Horizontal bar chart, red for the top bin, green for the bottom bin (note: **opposite color direction from EC-size charts**, since HIGH outlier score = HIGH risk here, whereas HIGH EC size = LOW risk in Prosecutor).

### 8.6 Form B Distribution (Chart + Table) — only if `Multiplier_comb` available

| Population Rarity Range | # Records | % Dataset | Meaning |
|---|---|---|---|
| 0.00 – 0.19 | ... | ...% | Common profile — represents many people in the population |
| 0.20 – 0.39 | ... | ...% | ... |
| ... | | | |
| 0.80 – 1.00 | ... | ...% | 🔴 Rare profile — represents very few people in the population |

If `Multiplier_comb` is **not selected/available**, show:
```
⚠️ Form B (Population Rarity) requires the Multiplier_comb column.
This column is currently [not selected / not present in dataset].
Form A (within-dataset distinctiveness) results above remain valid
and are the primary risk indicator in this case.
```

### 8.7 Most Distinctive Records Table (Top 10)

| Rank | Row # | [Profile attributes, full values] | Form A | Form B | Nearest Neighbor | Distance to NN |
|---|---|---|---|---|---|---|
| 1 | 12 | Religion=Jainism, HH_Size=11, Land_Owned=4.5, ... | 0.82 | 0.71 | Row 3 | 0.82 |
| 2 | ... | | | | | |

**Note:** "These records are statistically distinctive within the dataset. While they may not be directly re-identifiable (check Prosecutor/Journalist results separately), their unusual combination of attributes makes it easier for an attacker with external knowledge to confirm whether 'someone like this' is included in the dataset."

### 8.8 Cross-Reference with Prosecutor/EC Results (NEW — important)

If Prosecutor results are available (from a prior or simultaneous run), show:

```
CROSS-CHECK: Membership Risk vs Re-Identification Risk

Row #12:
  - Prosecutor EC Size: 5 (k-anonymity SATISFIED, k=3)
  - Prosecutor Status: 🟢 PROTECTED
  - Membership Form A Score: 0.82
  - Membership Status: 🔴 HIGH RISK

  ⚠️ This record is PROTECTED from row-level re-identification (it shares
  its Quasi-Identifier combination with 4 others), but its OVERALL profile
  (including Sensitive Attributes) is highly distinctive. K-anonymity does
  NOT protect against this.
```

**This cross-check table is the single most important insight of the Membership module** — it demonstrates that k-anonymity/l-diversity/t-closeness (all EC-based) provide ZERO guarantee against membership inference, because membership inference operates on the FULL profile, not just the QI-defined groups.

If Prosecutor has not been run, show:
```
ℹ️ Run the Prosecutor Attack assessment to see how Membership Inference
results compare against your dataset's k-anonymity protections.
```

### 8.9 Recommendations Section (Auto-generated, Membership-specific)

```
RECOMMENDATIONS (Membership Inference Attack)

🔴 CRITICAL — Row #[X] has Form A outlier score [Y] (highest in dataset)
   Action: This record's combination of [list the 2-3 attributes that
   contribute most to its distinctiveness — e.g., the attributes where
   this record's value is most different from the dataset mode/median]
   makes it stand out. Consider:
     - Generalising/bucketing [attribute] (e.g., HH_Size into ranges
       instead of exact counts)
     - Top/bottom-coding extreme values (e.g., cap Land_Owned at the
       95th percentile, label as "46+ acres")
     - If this record represents a genuine outlier in the population
       (not a data error), consider whether it should be excluded from
       public release or only released in aggregate form

🟡 MEDIUM — [N] records ([X]%) flagged as high membership-inference risk
   Action: Apply the perturbation/generalisation techniques above to
   bring these records' Form A scores below 0.7.

[If Form B status = 'ok' and high]:
🟡 MEDIUM — [N] records have high population rarity (Form B ≥ 0.7)
   Action: These profiles are rare in the general population. If this
   dataset's survey scope is publicly known (e.g., "NREGA beneficiaries
   in District X"), even confirming "a record with this profile exists
   in the data" may reveal sensitive participation information. Consider
   aggregation or k-anonymisation at a coarser geographic/demographic
   level for these specific profiles.

[If Form B status = 'multiplier_comb_unavailable']:
ℹ️ NOTE — Multiplier_comb was not available/selected. Form B (population
   rarity) could not be computed. Re-run with Multiplier_comb included
   (it will be excluded from direct-identifier flags specifically for
   this purpose) for a more complete membership risk picture.

ℹ️ NEXT STEP — Go to "Privacy Enhancement" → "Outlier Treatment" or
   "Top/Bottom Coding" to address the most distinctive records identified
   in §8.7. Re-run this assessment afterward — Form A scores for the
   treated records should decrease.
```

---

## 9. Configuration Conflicts & Edge Cases

1. **Attribute appears in BOTH the "Direct Identifiers Detected" warning box AND is selected as a QI or SA**: Per §4, Form A's `profile_attributes` should EXCLUDE direct identifiers regardless of user selection. If the user has selected, e.g., `Land_Cultivated` (flagged as a direct identifier due to high cardinality) as a Sensitive Attribute, display a configuration warning:
   ```
   ⚠️ "[Attribute] is flagged as a potential direct identifier (high
   cardinality) AND is selected as a Sensitive Attribute. It has been
   EXCLUDED from the Membership Inference profile to avoid trivially
   inflating Form A scores. Consider deselecting it or binning it into
   ranges first."
   ```

2. **`profile_attributes` is empty** (no QIs or SAs selected, or all selected attributes are flagged identifiers): Return early with the message in §5 Step 2 — do not attempt distance computation on zero columns.

3. **N is very small (e.g., N < 5)**: Gower distances become unstable/meaningless with very few records (nearest-neighbor distance could trivially be high for everyone). Display:
   ```
   ⚠️ "With only [N] records, Membership Inference results are highly
   sensitive to individual records and may not generalize. Treat results
   as illustrative only."
   ```
   (This applies to the 20-row dataset, though N=20 is borderline acceptable — not as severe a warning as N<5, but still worth a general small-sample note per §7.)

4. **All numeric attributes have zero variance** (e.g., everyone has the same `HH_Size`): The range-normalization in Gower distance (`range_attr == 0`) must default that attribute's contribution to `d=0` for all pairs (handled in §4's pseudocode) — do NOT divide by zero.

---

## 10. Validation / Sanity Checks (for testing this implementation)

1. **Form A scores ∈ [0, 1]** always. A score of exactly 0 means an EXACT duplicate record exists elsewhere in the dataset (across ALL profile attributes) — verify this is plausible/flagged if it occurs (duplicate rows may indicate a data quality issue worth surfacing separately).
2. **Form A score = 1.0 is only possible if N = 1** (no other records to compare against) OR if a record differs maximally (distance=1 on every attribute) from ALL other records — the latter is rare but possible with few categorical attributes.
3. **Form B scores ∈ [0, 1]** after normalization; the record with the SMALLEST `Multiplier_comb` value in the dataset must have `Form B = 1.0` (it's the rarest).
4. **`nearest_neighbor` relationship need not be symmetric** — Row A's nearest neighbor being Row B does NOT guarantee Row B's nearest neighbor is Row A (Row B might have an even closer Row C). This is expected and should not be "fixed" — display as-is.
5. **§8.8 cross-check**: a record can simultaneously be 🟢 PROTECTED (Prosecutor, large EC) and 🔴 HIGH RISK (Membership, high Form A) — this combination is the EXPECTED and most pedagogically important output of this entire module. A test run where NO record shows this combination should be double-checked (either the dataset is unusually uniform, or the attribute-set difference between EC-defining QIs and the full profile_attributes isn't being exploited correctly).
6. For the 20-row dataset: expect Form A scores mostly in 0.3-0.6 (per §7), with 1-3 records potentially exceeding 0.7 due to extreme `HH_Size` or `Land_*` values. Form B should range based on the `Multiplier_comb` spread (~325 to ~1988 in the raw data) if that column is included.

---

## 11. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size
       ↓
[Run Assessment clicked, "Membership" checked]
       ↓
1. Sample dataset (sample_size_pct)
2. Determine profile_attributes = (QIs ∪ SAs) − direct_identifiers
   - if empty, return early with guidance message
   - if any selected attribute IS a flagged direct identifier, show
     configuration warning (§9.1) and exclude it
3. Preprocess: parse "X.X acres" -> float, encode Yes/No -> 0/1,
   leave categoricals as-is
4. FORM A: compute pairwise Gower distance matrix -> nearest-neighbor
   distance per record -> outlier_score
5. FORM B: if Multiplier_comb available, compute normalized rarity
   (1/Multiplier_comb, normalized) per record; else mark 'unavailable'
6. Combine: flag high_membership_risk = (Form_A >= 0.7) OR (Form_B >= 0.7)
7. Identify top-10 most distinctive records (by Form A)
8. Cross-reference with Prosecutor EC sizes/status if that assessment
   has been run (or run it implicitly using the same QIs)
9. Generate recommendations (per flagged record + dataset-level)
       ↓
Render results panel with ALL sections in §8 above
```

---

## 12. Implementation Notes for Replit Agent

1. **Membership Inference is the ONLY attack in this module that does NOT use `groupby(quasi_identifiers)`** — do not attempt to reuse the Prosecutor/Inference equivalence-class machinery for the core Form A/B computation. It IS, however, used for the §8.8 cross-check, which should call/reuse the Prosecutor results.
2. **The §8.3 Record-Level Membership Trace and §8.7 Most Distinctive Records table are mandatory** — analogous to Prosecutor's Record-Level Attack Trace, these are the actionable core output.
3. **§8.8 Cross-Reference table is the highest-value section** — prioritize this in implementation. It is the section that most clearly differentiates Membership Inference from every other attack type and should be impossible to skip.
4. **Gower distance computation is O(N²)** — for N=20 this is trivial (400 pairs), but flag in code comments that for large datasets (N > 1000), this needs either sampling of comparison pairs or an approximate nearest-neighbor index (e.g., FAISS, sklearn BallTree with a custom Gower-compatible metric) to remain performant.
5. **Preprocessing the "X.X acres" strings is mandatory** before any distance computation — if Land_Owned/Possessed/Cultivated are included as profile attributes and left as raw strings, Gower distance will treat them as categorical (every value "different"), artificially inflating Form A scores for ALL records. This must be fixed at the preprocessing step (§5 Step 3), not worked around later.
6. **Color/threshold conventions are INVERTED relative to Prosecutor**: in Prosecutor, LOW EC size = HIGH risk (red); in Membership, HIGH outlier score = HIGH risk (red). Ensure chart color scales (§8.5, §8.6) are not copy-pasted with the wrong direction from the Prosecutor EC-size chart.
7. **Status badge for Membership in top nav** should use `membership_score = pct_high_risk_records` (from §5's `pct_high_risk`), with thresholds 🔴 >20%, 🟡 5-20%, 🟢 <5% (consistent with Prosecutor/Journalist re-id thresholds, since this is also a "% of records at risk" style metric, unlike Inference's confidence-based score).

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
