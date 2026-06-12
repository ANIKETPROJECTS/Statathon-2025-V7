# Risk Assessment Module — Prosecutor Attack: Complete Specification

> **For Replit Agent**: Replace all existing mock/placeholder logic in the Risk Assessment module with the accurate implementations described below. This document covers: Quasi-Identifier selection logic, Sensitive Attribute handling, K-Anonymity / L-Diversity / T-Closeness computation, Sample Size, the Prosecutor Attack algorithm (with full math), and the correct UI output format for the results panel.

---

## 1. Core Concepts & Definitions

### 1.1 Quasi-Identifiers (QIs)
A **Quasi-Identifier** is any column (or combination of columns) that, while not directly identifying a person, can be combined with external public data to re-identify them.

**Examples in survey microdata:**
- `Round_Centre_Code`, `FSU_Serial_No`, `Round`, `District_Code`, `State`

**Selection logic in the UI:**
- All columns in the uploaded CSV should be listed under "Quasi-Identifiers"
- User checks the ones they consider QIs
- The system uses **only the checked QIs** to compute equivalence classes
- Default: auto-suggest columns that are NOT free-text or high-cardinality numeric IDs (heuristic: flag columns where `unique_count / total_rows < 0.5` as likely QIs)

### 1.2 Sensitive Attributes (SAs)
A **Sensitive Attribute** is a column whose value, if disclosed, causes harm to the individual (health info, income, religion, caste, location details).

- User selects SAs from remaining columns
- SAs are **never used to build equivalence classes**
- SAs are used ONLY in L-Diversity and T-Closeness checks

### 1.3 Equivalence Class (EC)
An **Equivalence Class** is the set of all records that share the **exact same combination of values** across all selected Quasi-Identifiers.

```
EC(r) = { all records with identical values on all selected QIs as record r }
```

If three people all have `State=MH, Round=2, District_Code=D04`, they form one EC of size 3.

---

## 2. Privacy Parameter Definitions & Algorithms

### 2.1 K-Anonymity
**Definition:** A dataset satisfies **k-anonymity** if every equivalence class has at least `k` records. No individual can be distinguished from at least `k-1` others.

**Algorithm:**
```
for each record r in dataset:
    ec_size = |EC(r)|  # count records with same QI combination
    if ec_size < k:
        mark record as VIOLATING k-anonymity
```

**Metrics to compute and display:**
| Metric | Formula | Meaning |
|---|---|---|
| Min-K | `min(|EC| for all ECs)` | Smallest equivalence class size |
| Avg EC Size | `total_records / number_of_ECs` | Mean EC size |
| % Unique Records | `(records where |EC|=1) / total × 100` | Singleton ECs = worst case |
| % k-Violating Records | `(records where |EC| < k) / total × 100` | Fail rate |

**Violation threshold:** If `Min-K < user_selected_k`, the dataset FAILS k-anonymity.

---

### 2.2 L-Diversity
**Definition:** Each equivalence class must have at least `l` **distinct** values for every sensitive attribute. Prevents attribute disclosure even when k-anonymity holds.

**Algorithm (per sensitive attribute SA):**
```
for each EC:
    distinct_SA_values = count(distinct values of SA within EC)
    if distinct_SA_values < l:
        mark EC as L-DIVERSITY VIOLATING for SA
```

**Metrics:**
| Metric | Formula |
|---|---|
| Min L (per SA) | `min(distinct SA values across all ECs)` |
| % Violating ECs | `ECs where distinct_SA < l / total ECs × 100` |
| % Violating Records | Records in violating ECs / total × 100 |

---

### 2.3 T-Closeness
**Definition:** The distribution of a sensitive attribute within any EC must be "close" to its distribution in the overall dataset. Distance measured by Earth Mover's Distance (EMD) or KL-divergence. Must be ≤ threshold `t`.

**Algorithm (for categorical SA):**
```
global_distribution = value_counts(SA in entire dataset, normalize=True)

for each EC:
    local_distribution = value_counts(SA in EC, normalize=True)
    
    # Earth Mover's Distance (for ordinal/numeric SA)
    emd = sum(|cumulative_local - cumulative_global|) / (num_categories - 1)
    
    # For categorical SA use Total Variation Distance:
    tvd = 0.5 * sum(|local_prob(v) - global_prob(v)| for each value v)
    
    if tvd > t (or emd > t):
        mark EC as T-CLOSENESS VIOLATING
```

**Metrics:**
| Metric | Formula |
|---|---|
| Max Distance | `max(distance across all ECs)` |
| % Violating ECs | ECs exceeding threshold / total × 100 |

---

### 2.4 Sample Size
- **What it does:** Randomly samples X% of rows BEFORE running the attack
- **Why it exists:** For large datasets, running on 100% is slow; sampling gives faster estimates
- **Implementation:**
```python
sample = dataset.sample(frac=sample_size_pct/100, random_state=42)
# All metrics are computed on `sample`, not full dataset
# Display note: "Results based on N rows (X% sample)"
```
- At 100%, use the full dataset (no sampling)

---

## 3. Prosecutor Attack — Full Algorithm & Math

### 3.1 What is the Prosecutor Attack?
The **Prosecutor Attack** models the **worst-case adversary**: someone who:
1. **Already knows** a specific target individual is in the dataset
2. Knows some of their quasi-identifier values (from external sources: voter rolls, social media, public records)
3. Tries to **isolate** that individual by finding records matching their known QI values

This is the most dangerous attack model — the adversary is not guessing; they are confirming.

---

### 3.2 Prosecutor Re-Identification Risk: The Math

For a record `r` belonging to equivalence class `EC(r)` with size `|EC(r)|`:

```
Prosecutor_Risk(r) = 1 / |EC(r)|
```

**Intuition:** If an EC has only 1 record (singleton), the attacker can uniquely identify the person with 100% certainty. If an EC has 5 records, the best the attacker can do is 1-in-5 = 20%.

**Dataset-level Re-ID Risk (average linkage score):**
```
Re_ID_Risk = (1/N) × Σ (1 / |EC(r)|)   for all records r
```

Where N = total number of records in sample.

**Simplified form:**
```
Re_ID_Risk = (1/N) × Σ_EC  (|EC| × (1/|EC|))
           = (1/N) × Σ_EC  1
           = number_of_distinct_ECs / N
```

So: **Re-ID Risk = number of unique QI combinations / total records**

**Example:** 100 records, all unique QI combos → 100 ECs → Re-ID Risk = 100/100 = **1.0 = 100%**

---

### 3.3 Link Score Per Record
```
link_score(r) = 1 / |EC(r)|
```
- Range: 0 (never happens) to 1.0 (singleton, fully identifiable)
- Link Score = 1.0 means the record is **uniquely identifiable** given the QIs

---

### 3.4 Full Prosecutor Attack Algorithm (Step by Step)

```python
def prosecutor_attack(dataframe, quasi_identifiers, sensitive_attributes, k, l, t, sample_size_pct):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct/100, random_state=42)
    N = len(df)

    # Step 2: Build Equivalence Classes
    # Group by all selected quasi-identifiers
    ec_groups = df.groupby(quasi_identifiers)
    
    # Step 3: Compute EC sizes
    ec_sizes = ec_groups.size().reset_index(name='ec_size')
    df = df.merge(ec_sizes, on=quasi_identifiers, how='left')

    # Step 4: Per-record link score
    df['link_score'] = 1.0 / df['ec_size']

    # Step 5: Per-record risk label
    df['at_risk'] = df['ec_size'] < k   # True = at risk

    # Step 6: K-Anonymity check
    min_k = df['ec_size'].min()
    avg_ec_size = df['ec_size'].mean()
    num_singletons = (df['ec_size'] == 1).sum()
    unique_records_pct = num_singletons / N * 100
    re_id_risk = df['link_score'].mean()  # Average linkage score

    # Step 7: L-Diversity check (per sensitive attribute)
    l_div_results = {}
    for sa in sensitive_attributes:
        l_vals = ec_groups[sa].nunique().reset_index(name='l_diversity')
        df = df.merge(l_vals, on=quasi_identifiers, how='left', suffixes=('', f'_{sa}'))
        l_div_results[sa] = {
            'min_l': l_vals['l_diversity'].min(),
            'violating_ecs': (l_vals['l_diversity'] < l).sum(),
            'total_ecs': len(l_vals)
        }

    # Step 8: T-Closeness check (per sensitive attribute)
    t_close_results = {}
    for sa in sensitive_attributes:
        global_dist = df[sa].value_counts(normalize=True)
        max_distance = 0
        violating_ecs = 0
        for name, group in ec_groups:
            local_dist = group[sa].value_counts(normalize=True)
            # Total Variation Distance
            all_values = set(global_dist.index) | set(local_dist.index)
            tvd = 0.5 * sum(abs(local_dist.get(v, 0) - global_dist.get(v, 0)) for v in all_values)
            max_distance = max(max_distance, tvd)
            if tvd > t:
                violating_ecs += 1
        t_close_results[sa] = {
            'max_distance': round(max_distance, 4),
            'violating_ecs': violating_ecs,
            'total_ecs': ec_groups.ngroups
        }

    # Step 9: Top vulnerable records
    top_vulnerable = df[df['link_score'] == 1.0].head(10)   # All singletons first
    if len(top_vulnerable) < 10:
        top_vulnerable = df.nlargest(10, 'link_score')

    return {
        'N': N,
        're_id_risk': re_id_risk,
        'num_unique_records': num_singletons,
        'avg_ec_size': avg_ec_size,
        'min_k': min_k,
        'at_risk_count': df['at_risk'].sum(),
        'protected_count': N - df['at_risk'].sum(),
        'l_diversity': l_div_results,
        't_closeness': t_close_results,
        'ec_distribution': ec_sizes['ec_size'].value_counts().sort_index().to_dict(),
        'link_score_distribution': df['link_score'].value_counts(bins=[0,0.01,0.25,0.50,0.75,0.99,1.0]).to_dict(),
        'top_vulnerable': top_vulnerable[quasi_identifiers + ['ec_size', 'link_score']].to_dict('records'),
        'all_records': df[quasi_identifiers + ['ec_size', 'link_score', 'at_risk']].to_dict('records')
    }
```

---

## 4. What the Results Panel Should Actually Display

> **Replace the current mock charts with the following real output sections.** The goal is that a non-technical government officer can read this and understand exactly what happened to their data.

---

### 4.1 Attack Summary Banner (Top)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🔴  PROSECUTOR ATTACK RESULTS                              RISK LEVEL: HIGH  │
│  Dataset: [filename]  |  Rows analysed: [N]  |  QIs used: [list of QI names] │
└──────────────────────────────────────────────────────────────────────────────┘

Plain-English Summary:
"An attacker who already knows a person is in this dataset can correctly 
identify [X]% of individuals using only [QI1], [QI2], [QI3]. 
Out of [N] records, [singletons] people are completely unique — 
they can be pinpointed with 100% certainty."
```

---

### 4.2 Key Metrics Row (4 cards)

| Card | Value | Label | Status |
|---|---|---|---|
| Re-ID Risk | `1.0%` or `100%` | Average chance an attacker correctly identifies a person | 🔴 if >20%, 🟡 if 5-20%, 🟢 if <5% |
| Unique Records | `N` | Records with no look-alike in the dataset (k=1) | 🔴 if >0 |
| Avg EC Size | `1.0` | Average group size sharing same QI values | 🔴 if <k |
| Min-K | `1` | Smallest group found — this is your worst-case exposure | 🔴 if <user_k |

---

### 4.3 Record-Level Attack Trace Table

**This is the most important output.** Show every record (or paginated top 50) with exactly what an attacker sees:

| Row # | [QI-1] | [QI-2] | [QI-3] | ... | Group Size | Link Score | Status |
|---|---|---|---|---|---|---|---|
| 1 | RC-4 | FSU-87881 | Round-2 | ... | 1 | 1.00 | 🔴 UNIQUELY IDENTIFIABLE |
| 2 | RC-1 | FSU-32748 | Round-1 | ... | 1 | 1.00 | 🔴 UNIQUELY IDENTIFIABLE |
| 47 | RC-2 | FSU-10021 | Round-3 | ... | 3 | 0.33 | 🟡 LOW PROTECTION (k<5) |
| 88 | RC-0 | FSU-55001 | Round-2 | ... | 7 | 0.14 | 🟢 PROTECTED |

**Column explanations (shown as tooltips or footnotes):**
- **Group Size**: How many people in this dataset share your exact combination of [QI names]. Group of 1 = you're alone = fully identifiable.
- **Link Score**: Probability an attacker correctly picks you out. Score of 1.00 = 100% certain. Score of 0.14 = 1-in-7 chance.
- **Status**: Based on k-anonymity threshold you set (k=[user_k])

**Add a filter bar above the table:**
```
[ Show All ] [ 🔴 At Risk Only ] [ 🟢 Protected Only ]   Search: [_____________]
```

---

### 4.4 Attack Narrative — "How the Attack Works on YOUR Data"

Show this as a step-by-step walkthrough using ACTUAL values from the dataset:

```
ATTACK SIMULATION — Step by Step

Step 1 — Attacker's Knowledge
  The attacker knows person X is in this dataset.
  They know from a voter roll / public record that:
    Round_Centre_Code = RC-4
    FSU_Serial_No     = FSU-87881
    Round             = 2

Step 2 — Database Query
  Attacker queries: "Show me all records where 
  Round_Centre_Code=RC-4 AND FSU_Serial_No=FSU-87881 AND Round=2"
  
  Result: 1 record found. (Row #1)

Step 3 — Re-identification
  Since only 1 record matches, the attacker has identified this person 
  with 100% certainty. They now know:
    State    = [value]
    HHID     = [value]
    District = [value]

Step 4 — Scale
  This attack was possible on [X] out of [N] records in your dataset.
  [Y]% of your dataset is fully re-identifiable this way.
```

---

### 4.5 Equivalence Class Distribution (Real Chart)

Replace the current bar chart with a table + chart that shows actual numbers:

**Table:**
| EC Size | Number of ECs | Number of Records | % of Dataset |
|---|---|---|---|
| 1 (Unique) | 100 | 100 | 100% |
| 2–4 | 0 | 0 | 0% |
| 5–10 | 0 | 0 | 0% |
| 11–20 | 0 | 0 | 0% |
| >20 | 0 | 0 | 0% |

**Chart:** Horizontal bar chart where each bar = number of records at that EC size. Color: red for size=1, orange for 2-4, yellow for 5–9, green for ≥k.

---

### 4.6 Link Score Distribution (Real Chart)

| Score Range | Number of Records | Meaning |
|---|---|---|
| 1.00 (certain) | 100 | Attacker is 100% certain |
| 0.51–0.99 (high) | 0 | More likely correct than not |
| 0.26–0.50 (medium) | 0 | Coin-flip or worse for attacker |
| 0.01–0.25 (low) | 0 | Attacker has <25% chance |
| 0.00 (safe) | 0 | Effectively anonymous |

---

### 4.7 L-Diversity Results (Per Sensitive Attribute)

```
L-Diversity Check (threshold l = [user_l])

Sensitive Attribute: STATE
  Min distinct values in any EC: 1
  ECs violating l-diversity: 100 out of 100 (100%)
  Meaning: In some groups, all records share the same State value.
           An attacker who identifies the group learns State with certainty.
  Status: 🔴 FAIL

Sensitive Attribute: HHID
  Min distinct values in any EC: 1
  ECs violating l-diversity: 100 out of 100 (100%)
  Status: 🔴 FAIL
```

---

### 4.8 T-Closeness Results (Per Sensitive Attribute)

```
T-Closeness Check (threshold t = [user_t])

Sensitive Attribute: STATE
  Global distribution: {MH: 30%, UP: 25%, RJ: 20%, ...}
  Maximum EC deviation from global: 0.87
  ECs violating t-closeness: 98 out of 100
  Meaning: The distribution of State inside individual groups is very 
           different from the overall dataset. This reveals information.
  Status: 🔴 FAIL
```

---

### 4.9 Risk Protection Donut (Real Numbers)

Replace the decorative donut with one backed by real counts:

```
At Risk:   [X] records  ([X%])   — EC size < k OR link_score = 1.0
Protected: [Y] records  ([Y%])   — EC size ≥ k

Show tooltip on hover: 
  At Risk: "These records can be re-identified by an attacker who 
            knows the target is in the dataset."
  Protected: "These records share their QI combination with at least 
              [k] others, providing plausible deniability."
```

---

### 4.10 Top Vulnerable Records Table

Show the 10 highest-risk records with full QI values visible:

| Rank | QI Combination (full values) | Link Score | EC Size | Why Vulnerable |
|---|---|---|---|---|
| 1 | RC-4, FSU-87881, Round-2, Dist-D04 | 1.00 | 1 | Singleton — no look-alike |
| 2 | RC-1, FSU-32748, Round-1, Dist-D02 | 1.00 | 1 | Singleton — no look-alike |

**Add a note:** "These rows should be suppressed or generalized before releasing this dataset."

---

### 4.11 Recommendations Section (Auto-generated, Specific)

Generate these dynamically based on actual results — NOT static text:

```
RECOMMENDATIONS (based on your assessment results)

🔴 CRITICAL — [N] singleton records found
   Action: Apply record suppression — remove these [N] rows before release,
   OR generalize FSU_Serial_No (the highest-cardinality QI) by 
   replacing specific values with range brackets.

🔴 HIGH — Re-ID Risk is [X]% (threshold: <5%)
   Action: Your dataset needs k-anonymisation. Apply generalisation 
   to [top contributing QI] to bring Min-K up to at least [user_k].

🟡 MEDIUM — L-Diversity violated for [SA name]
   Action: Ensure each QI group has at least [l] distinct values 
   of [SA name]. Consider not releasing [SA name] in raw form.

ℹ️ NEXT STEP
   Go to "Privacy Enhancement" to apply these fixes automatically.
   After enhancement, re-run this assessment to verify improvement.
```

---

## 5. Attack Score for the Top Navigation Bar

The **Comparison Score** shown in the header (currently showing `54.2`) should be:

```
Comparison Score = weighted average of all attack risk scores

prosecutor_score    = re_id_risk × 100              # 0-100
journalist_score    = ... (see journalist attack spec)
...

overall_score = mean(all enabled attack scores)
```

For Prosecutor only:
```
prosecutor_score = (num_singletons / N) × 100
```
Display this as the Prosecutor badge score. Color: 🔴 >20, 🟡 5-20, 🟢 <5.

---

## 6. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size
       ↓
[Run Assessment clicked]
       ↓
1. Sample dataset (sample_size_pct)
2. Build equivalence classes (groupby QIs)
3. Compute ec_size per record
4. Compute link_score = 1/ec_size per record
5. Compute re_id_risk = mean(link_scores)
6. Run k-anonymity check
7. Run l-diversity check per SA
8. Run t-closeness check per SA
9. Identify top vulnerable records
10. Generate recommendations
       ↓
Render results panel with ALL sections above
```

---

## 7. Implementation Notes for Replit Agent

1. **Remove all hardcoded/mock data** from the results panel. Every number must come from the algorithm output.
2. **The record-level trace table (Section 4.3) is mandatory** — this is the core output that makes the tool genuinely useful. Paginate at 50 rows, add CSV export button.
3. **The Attack Narrative (Section 4.4) must use real values** pulled from the top vulnerable record.
4. **Recommendations (Section 4.11) must be conditional** — only show a recommendation if the condition is actually violated.
5. **All charts must be built from real computed distributions**, not dummy arrays.
6. **Status badges** (🔴/🟡/🟢) on the QI/SA headers in the top nav should update after each run based on actual risk level per attack type.
7. **Export**: Add a "Download Full Report (CSV)" button that exports the full record-level table with link scores and status.
8. The plain-English summary paragraph (Section 4.1) should be **template-filled with actual numbers** every time the assessment runs.

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
