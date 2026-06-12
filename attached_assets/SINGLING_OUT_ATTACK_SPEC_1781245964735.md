# Risk Assessment Module — Singling Out Attack: Complete Specification

> **For Replit Agent**: Replace all existing mock/placeholder logic in the Singling Out Attack section of the Risk Assessment module with the accurate implementations described below. This document covers: Quasi-Identifier selection logic, Sensitive Attribute handling, the Singling Out Attack algorithm (with full math), Predicate Singling Out, Probabilistic Singling Out, Singling Out Score per record and per column, and the correct UI output format for the results panel.

---

## 1. Core Concepts & Definitions

### 1.1 What is "Singling Out"?

**Singling Out** is one of the three fundamental privacy harms defined by the **GDPR Article 29 Working Party** and the **European Data Protection Board (EDPB)**. It is formally defined as:

> "The ability to isolate some or all records which identify an individual in the dataset."

This is **distinct from re-identification**:

| Concept | Meaning | Example |
|---|---|---|
| **Re-identification** | Linking a record to a known external identity | "This row is Ramesh Kumar from Pune" |
| **Singling Out** | Isolating a record as belonging to ONE unique individual — even without knowing *who* that person is | "This row describes exactly one person — I don't know their name, but I know they exist and I can track them" |

**Why it matters in Indian survey microdata:**
An attacker may not know Ramesh Kumar's name. But if they can write a query that returns exactly 1 record — e.g., "the only household in Dist-D04 with Religion=Minority AND Occupation=Artisan AND HH_Size=2" — they have singled that person out. They can now:
- Track that record across dataset releases (longitudinal linkage)
- Use that unique combination to find the person in the real world
- Infer all sensitive attributes associated with that record

---

### 1.2 Singling Out vs Prosecutor vs Marketer

| Dimension | Prosecutor Attack | Marketer Attack | Singling Out Attack |
|---|---|---|---|
| Adversary goal | Re-identify one known target | Re-identify as many as possible | Isolate any unique individual — even anonymously |
| Prior knowledge | Knows target is in dataset | No prior knowledge | No prior knowledge needed |
| Attack method | QI matching against external data | Bulk dataset linkage | Predicate queries on the dataset itself |
| Success condition | Confirmed re-identification | Maximum correct matches | Record returns exactly 1 result |
| External data needed? | YES — voter rolls, etc. | YES — commercial databases | **NO** — only the released dataset is needed |
| GDPR relevance | Re-identification harm | Re-identification harm | **Primary GDPR singling-out harm** |
| Real-world analogy | Investigator confirming a suspect | Data broker running bulk linkage | Researcher writing a query like "find the only X" |

**The Singling Out Attack is the most dataset-internal threat.** It requires zero external data. An attacker only needs the released CSV file.

---

### 1.3 Quasi-Identifiers (QIs)

Same definition as Prosecutor Attack — columns that, alone or in combination, can distinguish one individual from others.

**Selection logic in the UI:**
- All columns listed under "Quasi-Identifiers"
- User checks the ones they consider QIs
- System uses **only the checked QIs** to evaluate singling-out predicates
- Default heuristic: flag columns where `unique_count / total_rows < 0.5`

**Key difference for Singling Out:** Even columns that are NOT typically considered QIs can contribute to singling out when combined. A column like `HH_Size` with only 4 distinct values is harmless alone — but combined with `District + Religion + Occupation`, it may isolate a unique individual. The singling-out analysis therefore evaluates **column combinations**, not just individual columns.

---

### 1.4 Sensitive Attributes (SAs)

Same definition as Prosecutor Attack — columns whose disclosure causes harm.

- Never used to build predicates
- Used ONLY in L-Diversity and T-Closeness checks, and in the **Sensitive Singling Out** sub-analysis

---

### 1.5 Equivalence Class (EC)

Same as Prosecutor Attack:
```
EC(r) = { all records with identical values on all selected QIs as record r }
```

A record is **singled out** if `|EC(r)| = 1` — it is the only record with that combination of QI values.

---

### 1.6 Predicate

A **predicate** is a logical condition (query) that can be applied to the dataset. In singling out analysis:

```
predicate P = a set of conditions on QI columns
P(record r) = TRUE if record r satisfies all conditions in P
```

**Example predicates:**
```
P1: District_Code = D04 AND Religion = 3 AND HH_Size = 2
P2: State = 27 AND Occupation = 7 AND Sector = Rural
P3: FSU_Serial_No = FSU-87881
```

A predicate **singles out** a record if exactly 1 record in the dataset satisfies it:
```
singling_out(P) = TRUE  iff  |{ r : P(r) = TRUE }| = 1
```

---

## 2. Privacy Parameter Definitions & Algorithms

### 2.1 K-Anonymity (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.1. K-Anonymity computation is identical.

Singling-out interpretation:
- **k = 1** (singleton EC) is the mathematical definition of singling out via a conjunctive QI predicate
- Any record with `|EC(r)| = 1` can be singled out by writing a predicate matching all its QI values

### 2.2 L-Diversity (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.2. Computation is identical.

Singling-out interpretation:
- L-Diversity violation is especially dangerous here: if a record is singled out (EC size = 1), the attacker also learns every SA value with 100% certainty

### 2.3 T-Closeness (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.3. Computation is identical.

### 2.4 Sample Size (same as Prosecutor)

```python
sample = dataset.sample(frac=sample_size_pct/100, random_state=42)
# All metrics computed on `sample`
# Display note: "Results based on N rows (X% sample)"
```

---

## 3. Singling Out Attack — Full Algorithm & Math

### 3.1 Two Types of Singling Out

The Singling Out Attack has **two distinct sub-attacks**, each with different math:

| Type | Description | Math Basis |
|---|---|---|
| **Predicate Singling Out** | Can an attacker write a simple query using 1–3 QI columns that returns exactly 1 record? | Counts singleton ECs formed by subsets of QI columns |
| **Probabilistic Singling Out** | What is the probability that a randomly chosen record can be singled out using some combination of QI values? | Expected fraction of records that are unique under at least one QI subset |

Both are computed and reported separately in the results panel.

---

### 3.2 Predicate Singling Out: The Math

#### 3.2.1 Full-QI Singling Out (Baseline)

Using ALL selected QIs as the predicate:

```
full_QI_singled_out(r) = 1  iff  |EC(r)| = 1
Full_SO_Rate = num_singletons / N
```

This is the **strongest** singling-out predicate — the most specific possible query. If a record is not a singleton under all QIs, it may still be singled out by a subset.

#### 3.2.2 Subset-Predicate Singling Out

For each subset `S` of the selected QIs (where `|S|` = 1, 2, or 3 columns):

```
EC_S(r) = { records with identical values on QI columns in subset S }
singled_out_by_S(r) = 1  iff  |EC_S(r)| = 1
```

**Why subsets matter:** A dataset may satisfy k-anonymity under ALL QIs combined (Min-K ≥ 5), but a 2-column subset like `(District, Religion)` alone may single out some records. The attacker only needs to find *one* subset that singles out a record.

#### 3.2.3 Per-Record Singling Out Score

A record is considered **singled out** if ANY predicate (full QI or any subset up to size 3) singles it out:

```
singled_out(r) = 1  iff  ∃ subset S ⊆ QIs such that |EC_S(r)| = 1
```

The **Singling Out Score** per record is the fraction of tested subsets that single it out:

```
SO_Score(r) = count(subsets S where |EC_S(r)| = 1) / total_subsets_tested
```

- Range: 0.0 (not singled out by any tested subset) to 1.0 (singled out by every subset)
- A score > 0 means the record is **vulnerable to singling out**
- A score = 1.0 means the record is **uniquely identifiable** under every QI combination tested

#### 3.2.4 Dataset-Level Predicate Singling Out Rate

```
Predicate_SO_Rate = count(records where singled_out(r) = 1) / N × 100
```

This is the primary metric for Singling Out risk.

#### 3.2.5 Column Contribution to Singling Out

For each individual QI column `c`, compute how many records are singled out when ONLY that column is used:

```
Solo_SO_Count(c) = count(records where |EC_{c}(r)| = 1)
```

Then rank columns by their solo singling-out power. This tells the data custodian **which single column is most dangerous**.

For each 2-column pair `(c1, c2)`:

```
Pair_SO_Count(c1, c2) = count(records where |EC_{c1,c2}(r)| = 1)
```

This reveals **dangerous column combinations** — pairs that single out many records even though individually they do not.

---

### 3.3 Probabilistic Singling Out: The Math

Probabilistic Singling Out estimates the risk for records that are NOT singletons under any tested subset — they are still probabilistically vulnerable if their QI combination is **rare** in a larger population.

#### 3.3.1 Uniqueness Probability (Dankar–El Emam Model)

For a record in equivalence class `EC` of size `k_i` drawn from a population of size `P`:

```
P(unique in population | k_i records in sample) ≈ 1 / k_i
```

When `k_i = 1` (singleton in sample): probability of being unique in population is high.
When `k_i > 1`: some of these records may still be unique in the population (they share QI values in the sample only because sampling brought them together).

The **estimated number of population-unique records** (records that appear in a sample EC of size `k_i` but are unique in the full population):

```
E[population_unique | k_i] = (sampling_fraction) × f(k_i)
```

Where `f(k_i)` is an estimator. The simplest estimator (Poisson approximation):

```
λ_i = k_i / (N / P)   # expected EC size in population
P(EC size = 1 in population | λ_i) = λ_i × e^{-λ_i}
```

#### 3.3.2 Simplified Probabilistic SO Score (Without Population Prior)

When population size is unknown, use a simpler measure of **rarity** as a proxy for probabilistic singling-out risk:

```
Rarity_Score(r) = 1 - (|EC(r)| / max_EC_size_in_dataset)
```

- Range: 0 (record is in the largest EC — most common profile) to ~1 (record is in the smallest EC — rarest profile)
- High rarity = high singling-out vulnerability even if not a singleton

**Normalised Probabilistic SO Score:**

```
Prob_SO_Score(r) = 1 / |EC(r)|
```

(Same formula as link score in Prosecutor Attack — but here it quantifies isolation risk, not re-identification probability.)

#### 3.3.3 Aggregate Probabilistic SO Rate

```
Prob_SO_Rate = (1/N) × Σ_r  (1 / |EC(r)|)
             = num_distinct_ECs / N
```

This is the expected fraction of records that a sophisticated probabilistic attacker can isolate.

---

### 3.4 Singling Out Score Summary

| Score | Formula | Meaning |
|---|---|---|
| `SO_Score(r)` | `count(subsets singling out r) / total_subsets_tested` | Fraction of tested QI subsets that isolate this record |
| `Prob_SO_Score(r)` | `1 / |EC(r)|` | Probability an attacker correctly isolates this record given they found its EC |
| `Predicate_SO_Rate` | `singled_out_records / N` | % of dataset vulnerable to predicate singling out |
| `Prob_SO_Rate` | `distinct_ECs / N` | Expected % vulnerable to probabilistic singling out |
| `Solo_SO_Count(c)` | `count(singleton ECs when only column c used)` | How many records column `c` alone singles out |
| `Pair_SO_Count(c1,c2)` | `count(singleton ECs when only columns c1+c2 used)` | How many records the pair singles out |

---

### 3.5 Full Singling Out Attack Algorithm (Step by Step)

```python
from itertools import combinations

def singling_out_attack(dataframe, quasi_identifiers, sensitive_attributes,
                        k, l, t, sample_size_pct, max_subset_size=3):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct/100, random_state=42)
    N = len(df)

    # Step 2: Build full-QI Equivalence Classes (baseline)
    ec_groups_full = df.groupby(quasi_identifiers)
    ec_sizes_full  = ec_groups_full.size().reset_index(name='ec_size')
    df = df.merge(ec_sizes_full, on=quasi_identifiers, how='left')
    df['prob_so_score'] = 1.0 / df['ec_size']

    # Step 3: Baseline singling-out (full QI predicate)
    num_singletons  = (df['ec_size'] == 1).sum()
    predicate_so_full = num_singletons / N

    # Step 4: Subset predicate singling out
    # Generate all subsets of QIs up to max_subset_size
    all_subsets = []
    for size in range(1, min(max_subset_size, len(quasi_identifiers)) + 1):
        for subset in combinations(quasi_identifiers, size):
            all_subsets.append(list(subset))

    total_subsets = len(all_subsets)

    # Per-record count of subsets that single them out
    df['subset_so_count'] = 0

    # Column-level singling out counters
    solo_so_counts  = {col: 0 for col in quasi_identifiers}
    pair_so_counts  = {}

    subset_summary = []   # For the Subset Singling Out table in results

    for subset in all_subsets:
        ec_sub = df.groupby(subset).size().reset_index(name=f'ec_sub_size')
        df_sub = df.merge(ec_sub, on=subset, how='left')
        singled_by_this = (df_sub['ec_sub_size'] == 1)
        df['subset_so_count'] += singled_by_this.astype(int)

        so_count_this = singled_by_this.sum()

        subset_summary.append({
            'subset': subset,
            'subset_size': len(subset),
            'so_count': int(so_count_this),
            'so_rate': round(so_count_this / N * 100, 2),
            'min_ec_size': int(df_sub['ec_sub_size'].min()),
        })

        # Solo column tracking
        if len(subset) == 1:
            solo_so_counts[subset[0]] = int(so_count_this)

        # Pair column tracking
        if len(subset) == 2:
            pair_key = tuple(sorted(subset))
            pair_so_counts[pair_key] = int(so_count_this)

    # Step 5: Per-record SO Score
    df['so_score'] = df['subset_so_count'] / total_subsets

    # Step 6: Singled-out flag — any subset singles this record out
    df['singled_out'] = df['subset_so_count'] > 0

    # Step 7: Overall Predicate SO Rate (at least one subset singles out)
    predicate_so_rate = df['singled_out'].sum() / N

    # Step 8: Probabilistic SO Rate
    num_distinct_ecs = ec_groups_full.ngroups
    prob_so_rate     = num_distinct_ecs / N

    # Step 9: K-Anonymity check
    min_k       = int(df['ec_size'].min())
    avg_ec_size = round(df['ec_size'].mean(), 2)

    # Step 10: L-Diversity check (identical to Prosecutor)
    l_div_results = {}
    for sa in sensitive_attributes:
        l_vals = ec_groups_full[sa].nunique().reset_index(name='l_diversity')
        l_div_results[sa] = {
            'min_l':         int(l_vals['l_diversity'].min()),
            'violating_ecs': int((l_vals['l_diversity'] < l).sum()),
            'total_ecs':     int(len(l_vals)),
        }

    # Step 11: T-Closeness check (identical to Prosecutor)
    t_close_results = {}
    for sa in sensitive_attributes:
        global_dist  = df[sa].value_counts(normalize=True)
        max_distance = 0
        violating    = 0
        for name, group in ec_groups_full:
            local_dist = group[sa].value_counts(normalize=True)
            all_vals   = set(global_dist.index) | set(local_dist.index)
            tvd = 0.5 * sum(
                abs(local_dist.get(v, 0) - global_dist.get(v, 0)) for v in all_vals
            )
            max_distance = max(max_distance, tvd)
            if tvd > t:
                violating += 1
        t_close_results[sa] = {
            'max_distance':  round(max_distance, 4),
            'violating_ecs': violating,
            'total_ecs':     ec_groups_full.ngroups,
        }

    # Step 12: Top vulnerable records (highest so_score, then prob_so_score)
    top_vulnerable = df.nlargest(10, ['so_score', 'prob_so_score'])

    # Step 13: Top dangerous column combinations
    subset_summary_sorted = sorted(
        subset_summary, key=lambda x: x['so_count'], reverse=True
    )
    top_dangerous_subsets = subset_summary_sorted[:10]

    return {
        'N':                    N,
        'num_singletons':       int(num_singletons),
        'predicate_so_full':    round(predicate_so_full * 100, 2),
        'predicate_so_rate':    round(predicate_so_rate * 100, 2),
        'prob_so_rate':         round(prob_so_rate * 100, 2),
        'num_distinct_ecs':     num_distinct_ecs,
        'total_subsets_tested': total_subsets,
        'min_k':                min_k,
        'avg_ec_size':          avg_ec_size,
        'at_risk_count':        int(df['singled_out'].sum()),
        'protected_count':      int((~df['singled_out']).sum()),
        'solo_so_counts':       solo_so_counts,
        'pair_so_counts':       {str(k): v for k, v in pair_so_counts.items()},
        'top_dangerous_subsets':top_dangerous_subsets,
        'l_diversity':          l_div_results,
        't_closeness':          t_close_results,
        'ec_distribution':      ec_sizes_full['ec_size'].value_counts().sort_index().to_dict(),
        'so_score_distribution':df['so_score'].value_counts(
                                    bins=[0, 0.01, 0.25, 0.50, 0.75, 0.99, 1.0],
                                    normalize=False
                                ).to_dict(),
        'top_vulnerable':       top_vulnerable[
                                    quasi_identifiers + ['ec_size', 'so_score', 'prob_so_score']
                                ].to_dict('records'),
        'all_records':          df[
                                    quasi_identifiers +
                                    ['ec_size', 'so_score', 'prob_so_score', 'singled_out']
                                ].to_dict('records'),
    }
```

---

## 4. What the Results Panel Should Actually Display

> **Replace all mock charts with the following real output sections.** The goal is that a non-technical government officer can read this and understand exactly which records can be isolated in their dataset — even without external data.

---

### 4.1 Attack Summary Banner (Top)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🔴  SINGLING OUT ATTACK RESULTS                        RISK LEVEL: HIGH     │
│  Dataset: [filename]  |  Rows analysed: [N]  |  QIs used: [list of QI names] │
│  Subsets tested: [total_subsets_tested]  |  Max subset size: 3 columns       │
└──────────────────────────────────────────────────────────────────────────────┘

Plain-English Summary:
"An attacker with only the released CSV file (no external data needed) can 
write a simple database query that isolates exactly ONE person for 
[predicate_so_rate]% of records in this dataset — that is [at_risk_count] 
out of [N] individuals. [num_singletons] records are uniquely identified 
by their combination of [QI names] alone."
```

**Risk Level thresholds:**
| Predicate SO Rate | Risk Level |
|---|---|
| > 20% | 🔴 HIGH |
| 5%–20% | 🟡 MEDIUM |
| < 5% | 🟢 LOW |

---

### 4.2 Key Metrics Row (6 Cards)

| Card | Value | Label | Status Colour |
|---|---|---|---|
| Predicate SO Rate | `[predicate_so_rate]%` | % of records isolatable by a simple predicate query | 🔴 >20%, 🟡 5–20%, 🟢 <5% |
| Probabilistic SO Rate | `[prob_so_rate]%` | Expected % isolatable using statistical inference | 🔴 >20%, 🟡 5–20%, 🟢 <5% |
| Singled-Out Records | `[at_risk_count]` | Records uniquely isolated by at least one QI subset | 🔴 if > 0 |
| Full-QI Singletons | `[num_singletons]` | Records unique under ALL selected QIs | 🔴 if > 0 |
| Subsets Tested | `[total_subsets_tested]` | Number of QI combinations evaluated | ℹ️ Informational |
| Min-K | `[min_k]` | Smallest equivalence class found | 🔴 if < user_k |

---

### 4.3 Record-Level Singling Out Trace Table

**This is the most important output.** Show every record (paginated at 50 rows) with exactly what an attacker sees when running predicate queries:

| Row # | [QI-1] | [QI-2] | [QI-3] | ... | EC Size | SO Score | Prob SO Score | Singled Out? | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | RC-4 | FSU-87881 | Round-2 | ... | 1 | 1.00 | 1.00 | YES | 🔴 SINGLED OUT |
| 2 | RC-1 | FSU-32748 | Round-1 | ... | 1 | 0.87 | 1.00 | YES | 🔴 SINGLED OUT |
| 47 | RC-2 | FSU-10021 | Round-3 | ... | 3 | 0.24 | 0.33 | YES | 🟡 PARTIALLY ISOLATED |
| 88 | RC-0 | FSU-55001 | Round-2 | ... | 7 | 0.00 | 0.14 | NO | 🟢 PROTECTED |

**Column explanations (shown as tooltips or footnotes):**
- **EC Size**: Records sharing this exact combination of ALL selected QI values. Size = 1 = uniquely isolated by the full predicate.
- **SO Score**: Fraction of all tested QI subsets (1-column, 2-column, 3-column) that isolate this record to exactly 1 match. Score of 1.0 = singled out by every tested combination.
- **Prob SO Score**: `1 / EC_Size`. Probability an attacker who finds this record's equivalence class correctly isolates this specific individual.
- **Singled Out?**: YES if any tested QI subset returns exactly 1 record for this individual.
- **Status**: 🔴 = Singled out by at least one subset | 🟡 = EC size < k but not fully singled out | 🟢 = Not singled out by any tested subset.

**Add a filter bar above the table:**
```
[ Show All ] [ 🔴 Singled Out ] [ 🟡 At Risk ] [ 🟢 Protected ]   Search: [_____________]
```

**Add CSV Export button:** "Download Full Singling Out Report (CSV)"

---

### 4.4 Attack Narrative — "How the Singling Out Attack Works on YOUR Data"

Show as a step-by-step walkthrough using ACTUAL values from the top vulnerable record:

```
ATTACK SIMULATION — Step by Step

Step 1 — Attacker's Starting Point
  The attacker has ONLY the released CSV file. No external databases. 
  No knowledge of who is in the dataset.
  
  They write automated queries — trying every 1-column, 2-column, and 
  3-column combination of [QI names] to find queries that return exactly 1 row.

Step 2 — Finding a Singling-Out Predicate
  The attacker tests the combination: [top_dangerous_subset_columns]
  
  Query: "Show me records where [col1] = [val1] AND [col2] = [val2]"
  Result: 1 record found. (Row #[row_num])
  
  The attacker has singled out this individual — they don't know who it is,
  but they know exactly ONE person in the dataset has this profile.

Step 3 — What the Attacker Now Knows
  Without any external data, the attacker has isolated a unique individual.
  From the record, they can now read all columns — including sensitive ones:
    [SA_1]  = [value]
    [SA_2]  = [value]
    [SA_3]  = [value]
  
  Even if these columns were anonymised, the attacker can track this 
  unique profile across future dataset releases.

Step 4 — Scale of Singling Out
  The attacker ran [total_subsets_tested] queries automatically.
  [at_risk_count] records ([predicate_so_rate]%) were singled out by 
  at least one of these queries.
  
  The most dangerous column combination found:
    Columns: [top_dangerous_subset_columns]
    Records singled out by this pair alone: [pair_so_count]

Step 5 — Why This Requires No External Data
  Unlike the Prosecutor or Marketer attacks, the attacker here never 
  leaves the dataset. The risk is entirely internal — a consequence of 
  rare or unique QI combinations within the released file itself.
```

---

### 4.5 Equivalence Class Distribution (Real Chart)

**Table:**
| EC Size | Number of ECs | Number of Records | % of Dataset |
|---|---|---|---|
| 1 (Unique / Singled Out) | [x] | [x] | [x%] |
| 2–4 | [x] | [x] | [x%] |
| 5–10 | [x] | [x] | [x%] |
| 11–20 | [x] | [x] | [x%] |
| >20 | [x] | [x] | [x%] |

**Chart:** Horizontal bar chart. Each bar = number of records at that EC size bucket. Colour: 🔴 red for size=1 (singled out), 🟠 orange for 2–4, 🟡 yellow for 5–9, 🟢 green for ≥k.

**Singling Out Annotation (unique to this attack):**
Add a callout annotation on the size=1 bar:
```
← These [num_singletons] records can be isolated by a single predicate query.
   No external data needed.
```

---

### 4.6 SO Score Distribution (Real Chart)

Replace the Prosecutor's Link Score Distribution with the Singling Out Score Distribution:

| SO Score Range | Number of Records | Meaning |
|---|---|---|
| 1.00 (singled out by all subsets) | [x] | Completely isolated — every QI combination singles them out |
| 0.51–0.99 (high) | [x] | Singled out by majority of tested subsets |
| 0.26–0.50 (medium) | [x] | Singled out by some subsets — moderate risk |
| 0.01–0.25 (low) | [x] | Singled out by few subsets — low but real risk |
| 0.00 (protected) | [x] | Not singled out by any tested subset |

**Note:** Also show a second mini-chart for **Probabilistic SO Score distribution** using the same 5-bucket breakdown, using `1 / ec_size` as the score.

---

### 4.7 Dangerous Column Combinations Table (Singling Out–Specific)

> **This section has no equivalent in the Prosecutor or Marketer Attack specs.** It is unique to the Singling Out Attack.

Show the top 10 most dangerous QI subsets — the column combinations that single out the most records:

```
DANGEROUS COLUMN COMBINATIONS
(Ranked by number of records singled out)

Rank | Column Combination          | # Records Singled Out | SO Rate | Subset Size
-----|-----------------------------|-----------------------|---------|------------
  1  | District_Code + Religion    |         87            |  87.0%  |     2
  2  | FSU_Serial_No               |        100            | 100.0%  |     1
  3  | District + Occupation + HH_Size |   42              |  42.0%  |     3
  4  | State + Religion + Sector   |         31            |  31.0%  |     3
  ...
```

**Colour coding:**
- 🔴 SO Rate > 20%
- 🟡 SO Rate 5–20%
- 🟢 SO Rate < 5%

**Add a note below the table:**
> "Column combinations at the top of this list are the ones the data custodian should prioritise for generalisation or suppression. Even a single high-cardinality column (like FSU_Serial_No) can single out every record on its own."

---

### 4.8 Per-Column Singling Out Power (Heatmap / Bar Chart)

> **This section is also unique to the Singling Out Attack.** It shows which individual QI columns are most dangerous when used alone.

```
PER-COLUMN SINGLING OUT POWER
(Records singled out when ONLY this column is used as the predicate)

Column              | Unique Values | Records Singled Out | Solo SO Rate
--------------------|---------------|---------------------|-------------
FSU_Serial_No       |     100       |        100          |   100.0% 🔴
District_Code       |      12       |          0          |     0.0% 🟢
Round_Centre_Code   |       5       |          0          |     0.0% 🟢
State               |      10       |          0          |     0.0% 🟢
Round               |       3       |          0          |     0.0% 🟢
```

**Visualisation:** Horizontal bar chart with one bar per QI column. Bar length = Solo SO Rate. Colour = same 🔴/🟡/🟢 thresholds.

**Interpretation note:**
> "A column with Solo SO Rate > 0% is a direct identifier in this dataset — it alone can isolate unique individuals without combining with any other column. These columns should be considered direct identifiers, not quasi-identifiers, and must be removed or heavily generalised before release."

---

### 4.9 L-Diversity Results (Per Sensitive Attribute)

```
L-DIVERSITY CHECK (threshold l = [user_l])

Sensitive Attribute: [SA_NAME]
  Min distinct values in any EC:    [min_l]
  ECs violating l-diversity:        [violating_ecs] out of [total_ecs] ([pct]%)
  Records in violating ECs:         [x] out of [N] ([pct]%)
  Singling Out consequence:         For [singled_out_and_l_violated] records that 
                                    are BOTH singled out AND in l-violating ECs,
                                    the attacker learns [SA_NAME] with 100% certainty
                                    by writing a single predicate query.
  Status: 🔴 FAIL / 🟡 WARN / 🟢 PASS
```

**Combined Risk (unique to Singling Out):** Report the count of records that are BOTH:
1. Singled out by at least one predicate (`singled_out = TRUE`)
2. In an EC that violates l-diversity for any SA

```
combined_singling_sa_risk = count(records where singled_out=TRUE
                                  AND any SA l-diversity violated)
```

This is the count of individuals who are **fully exposed** — their identity can be isolated AND their sensitive attributes are trivially revealed.

---

### 4.10 T-Closeness Results (Per Sensitive Attribute)

```
T-CLOSENESS CHECK (threshold t = [user_t])

Sensitive Attribute: [SA_NAME]
  Global distribution: {value1: x%, value2: y%, ...}
  Maximum EC deviation from global:  [max_distance]
  ECs violating t-closeness:         [violating_ecs] out of [total_ecs] ([pct]%)
  Singling Out consequence:          ECs with high t-closeness deviation that 
                                     are also size-1 allow the attacker to infer
                                     [SA_NAME] with certainty — no distributional 
                                     uncertainty remains when there is only 1 record.
  Status: 🔴 FAIL / 🟡 WARN / 🟢 PASS
```

---

### 4.11 Risk Protection Donut (Real Numbers)

```
Singled Out:  [at_risk_count] records  ([at_risk_pct]%)
              — isolated by at least one QI predicate
Protected:    [protected_count] records ([protected_pct]%)
              — not isolated by any tested QI predicate

Tooltip on hover:
  Singled Out: "An attacker writing a simple SQL/spreadsheet filter on 
                this dataset (no external data needed) can isolate exactly 
                ONE person for each of these records."
  Protected:   "No combination of up to 3 QI columns tested produces a 
                unique match for these records. They blend in with at least 
                one other individual in every tested combination."
```

---

### 4.12 Top Vulnerable Records Table

Show the 10 highest-risk records ranked by SO Score, with full QI values and the most isolating predicate:

| Rank | QI Combination (full values) | EC Size | SO Score | Most Isolating Predicate | Status |
|---|---|---|---|---|---|
| 1 | RC-4, FSU-87881, Round-2, Dist-D04 | 1 | 1.00 | FSU_Serial_No = FSU-87881 (1 column) | 🔴 SINGLED OUT |
| 2 | RC-1, FSU-32748, Round-1, Dist-D02 | 1 | 0.87 | District_Code=D02 AND Religion=3 (2 cols) | 🔴 SINGLED OUT |
| 3 | RC-2, FSU-10021, Round-3, Dist-D07 | 2 | 0.34 | State=MH AND Occupation=7 AND HH_Size=2 (3 cols) | 🟡 PARTIALLY ISOLATED |

**"Most Isolating Predicate" column explanation:**
> The shortest (fewest columns) QI subset that singles out this record. This shows the attacker's minimum effort required to isolate this individual.

**Add a note:** "These rows are the highest priority for suppression or generalisation. The 'Most Isolating Predicate' column shows exactly what query an attacker would write to find them."

---

### 4.13 Recommendations Section (Auto-generated, Specific)

Generate dynamically based on actual results — NOT static text. Show only conditions that are violated.

```
RECOMMENDATIONS (based on Singling Out Attack assessment)

🔴 CRITICAL — [num_singletons] records are uniquely identified by all QIs combined
   An attacker needs only ONE predicate query using ALL selected QI columns 
   to isolate these [num_singletons] individuals with 100% certainty.
   Action: Apply record suppression — remove or heavily generalise these rows.
   Target: 0 singleton records after generalisation.

🔴 CRITICAL — [top_solo_column] singles out [solo_so_count] records on its own
   A single column — [top_solo_column] — has [solo_so_unique_values] unique values 
   and acts as a de-facto direct identifier. It singles out [solo_so_count] records 
   without needing any other column.
   Action: Remove [top_solo_column] from the released dataset entirely,
   OR replace with a generalised/bucketed version (e.g., replace exact 
   FSU Serial Numbers with district-level region codes).

🔴 HIGH — Predicate Singling Out Rate is [predicate_so_rate]% (threshold: <5%)
   [at_risk_count] records are isolatable by at least one 1–3 column predicate.
   Action: Generalise the top dangerous column combinations listed in Section 4.7.
   Start with [top_pair_columns] — this pair alone singles out [pair_so_count] records.

🟡 MEDIUM — Probabilistic SO Rate is [prob_so_rate]% 
   Even records not singled out by exact predicates have rare QI profiles.
   Expected number of probabilistically isolatable records: [num_distinct_ecs].
   Action: Apply k-anonymisation with k ≥ [user_k] across all QI combinations 
   to reduce the number of distinct equivalence classes.

🔴 HIGH — [combined_singling_sa_risk] records are BOTH singled out AND 
   have l-diversity violations for [SA_name]
   For these records, an attacker can isolate the individual AND read their 
   [SA_name] value with 100% certainty — the most severe privacy outcome.
   Action: Treat these records as highest priority. Apply both:
     (1) Suppression/generalisation of [top_singling_column], and
     (2) L-diversity enforcement on [SA_name].

🟡 MEDIUM — L-Diversity violated for [SA_name] in [violating_ecs] ECs
   Action: Ensure each QI group has at least [l] distinct values of [SA_name].
   Consider coarsening or suppressing [SA_name] in the released dataset.

ℹ️ NOTE ON EXTERNAL DATA REQUIREMENT
   Unlike Prosecutor and Marketer attacks, Singling Out requires NO external 
   databases. This risk is inherent to the released dataset itself and cannot 
   be mitigated by restricting access to external data sources.

ℹ️ NEXT STEP
   Go to "Privacy Enhancement" to apply these fixes automatically.
   After enhancement, re-run this assessment to verify that the 
   Predicate SO Rate drops below 5%.
```

---

## 5. Attack Score for the Top Navigation Bar

The **Singling Out badge score** shown in the header:

```
singling_out_score = predicate_so_rate     # 0–100, already a percentage

Display as the Singling Out badge score. Colour: 🔴 >20, 🟡 5–20, 🟢 <5.
```

**Combined Comparison Score (when multiple attacks are enabled):**
```
overall_score = mean(prosecutor_score, marketer_score, singling_out_score, ...)
```

---

## 6. Key Differences: Prosecutor vs Marketer vs Singling Out Results Panel

| Section | Prosecutor Attack | Marketer Attack | Singling Out Attack |
|---|---|---|---|
| Attack Summary Banner | "Attacker knows target is in dataset" | "Data broker does bulk linkage" | "No external data needed — attacker queries the CSV itself" |
| Key Metrics Cards | Re-ID Risk, Singletons, Avg EC, Min-K | + Expected Re-IDs, Population Success Rate | + Predicate SO Rate, Probabilistic SO Rate, Subsets Tested |
| Record Trace Table | Link Score + Status | + Marketer Value (★ scale) | SO Score + Prob SO Score + Most Isolating Predicate |
| Attack Narrative | Single-target QI matching | Bulk commercial linkage | Automated predicate query sweep on the dataset itself |
| Dangerous Column Combinations | ❌ Not present | ❌ Not present | ✅ Present — ranks all 1/2/3-column subsets by SO count |
| Per-Column Singling Out Power | ❌ Not present | ❌ Not present | ✅ Present — shows solo SO rate per column |
| Attribute Disclosure Section | ❌ Not present | ✅ Present (commercial framing) | ✅ Present (singling + SA combined risk count) |
| Population Inference Risk | ❌ Not present | ✅ Present | ❌ Not applicable (no population prior used) |
| L-Diversity Results | ✅ Standard | ✅ Bulk-disclosure framing | ✅ + Combined singling+SA risk count |
| T-Closeness Results | ✅ Standard | ✅ Skew-exploitation framing | ✅ + EC size=1 certainty consequence |
| Risk Donut | "At Risk / Protected" | Commercially framed | "Singled Out / Protected" |
| Top Vulnerable Table | Link Score + Why Vulnerable | + Marketer Value | + Most Isolating Predicate (fewest columns needed) |
| Recommendations | K-anonymity, generalisation | + Attribute disclosure, population | + Solo column removal, pair generalisation, combined SA risk |

---

## 7. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size
       ↓
[Run Assessment clicked — Singling Out Attack tab]
       ↓
1.  Sample dataset (sample_size_pct)
2.  Build full-QI equivalence classes (groupby ALL QIs)
3.  Compute ec_size per record
4.  Compute prob_so_score = 1/ec_size per record
5.  Generate all QI subsets up to size 3
6.  For each subset: build sub-ECs, count records singled out
7.  Compute per-record so_score = subsets_singling_out / total_subsets
8.  Flag singled_out = TRUE if any subset singles out the record
9.  Compute predicate_so_rate = singled_out_records / N
10. Compute prob_so_rate = distinct_ECs / N
11. Rank column combinations by SO count → dangerous subsets table
12. Compute solo_so_count per individual QI column
13. Run k-anonymity check
14. Run l-diversity check per SA + compute combined_singling_sa_risk
15. Run t-closeness check per SA
16. Identify top 10 vulnerable records + their most isolating predicate
17. Generate conditional recommendations
       ↓
Render results panel with ALL sections (4.1–4.13)
```

---

## 8. Implementation Notes for Replit Agent

1. **Remove all hardcoded/mock data** from the Singling Out results panel. Every number must come from the algorithm output.
2. **Subset generation (Step 5) is the performance bottleneck.** If there are many QI columns (e.g., 10+), the number of 3-column subsets is C(10,3) = 120 — manageable. For >15 QI columns, cap at a random sample of 200 subsets and display a note: "Results based on a random sample of 200 subsets out of [total_possible] possible combinations."
3. **The Dangerous Column Combinations table (§4.7) is mandatory and unique to this attack.** Build it from `top_dangerous_subsets` in the return dict. Sort descending by `so_count`.
4. **The Per-Column Singling Out Power section (§4.8) is mandatory.** Build it from `solo_so_counts`. Display as both a table and a horizontal bar chart.
5. **The "Most Isolating Predicate" column in the Top Vulnerable table (§4.12)** must be dynamically computed as the shortest subset that singles out each record. Pull from subset_summary per-record data.
6. **The Combined Singling + SA Risk count (§4.9)** must cross-reference `singled_out` flag with `l_diversity` violation flags per SA. This is a join/merge operation on the record-level dataframe.
7. **Recommendations (§4.13) must be conditional** — only show a recommendation if the condition is actually violated in the data.
8. **All charts must be built from real computed distributions**, not dummy arrays.
9. **Status badges** (🔴/🟡/🟢) on the Singling Out tab in the top nav should update after each run based on `predicate_so_rate`.
10. **Export**: "Download Singling Out Report (CSV)" — full record-level table with `ec_size`, `so_score`, `prob_so_score`, `singled_out`, `most_isolating_predicate` columns.
11. The plain-English summary (§4.1) must be **template-filled with actual numbers** on every run — especially `predicate_so_rate`, `at_risk_count`, and `num_singletons`.
12. **The attack narrative (§4.4) must use real values**: pull `top_dangerous_subsets[0]` for the most isolating combination, and pull the actual QI values from `top_vulnerable[0]` for the example record.
13. **Performance note:** Run the subset loop in a background thread / async function and show a progress indicator during computation: "Tested [x] of [total_subsets] column combinations…"

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
