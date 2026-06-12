# Risk Assessment Module — Marketer Attack: Complete Specification

> **For Replit Agent**: Replace all existing mock/placeholder logic in the Marketer Attack section of the Risk Assessment module with the accurate implementations described below. This document covers: Quasi-Identifier selection logic, Sensitive Attribute handling, the Marketer Attack algorithm (with full math), population inference risk, attribute disclosure risk, and the correct UI output format for the results panel.

---

## 1. Core Concepts & Definitions

### 1.1 What Makes the Marketer Attack Different from the Prosecutor Attack?

| Dimension | Prosecutor Attack | Marketer Attack |
|---|---|---|
| Adversary goal | Re-identify ONE specific known target | Re-identify as MANY records as possible to profit |
| Prior knowledge | Knows target is in the dataset | Does NOT know who is in the dataset |
| Success metric | 1 confirmed re-identification | Maximum average linkage across all records |
| Attack strategy | Exact QI match for one person | Population-level probabilistic matching |
| Real-world analogy | Stalker/investigator targeting a specific person | Data broker matching a sold dataset against external databases |

The Marketer Attack is an **average-case** adversary model. It asks:
> "If an attacker bought or obtained this dataset and tried to link every record to external data — how many people can they successfully re-identify on average?"

---

### 1.2 Quasi-Identifiers (QIs)

Same definition as Prosecutor Attack — columns that, combined with external public data, can re-identify individuals.

**Selection logic in the UI:**
- All columns listed under "Quasi-Identifiers"
- User checks the ones they consider QIs
- System uses **only the checked QIs** to compute equivalence classes
- Default heuristic: flag columns where `unique_count / total_rows < 0.5`

### 1.3 Sensitive Attributes (SAs)

Same definition as Prosecutor Attack — columns whose disclosure causes harm.

- Never used to build equivalence classes
- Used ONLY in Attribute Disclosure Risk, L-Diversity, and T-Closeness checks

### 1.4 Equivalence Class (EC)

Same as Prosecutor Attack:
```
EC(r) = { all records with identical values on all selected QIs as record r }
```

### 1.5 Population Size Assumption

The Marketer Attack requires one extra input: **assumed population size** from which the dataset was drawn.

```
population_size (P) = user-provided or estimated external population
```

**Why it matters:** If your dataset has 1,000 records drawn from a population of 10,000, an attacker trying to link randomly has a very different success rate than if the population is only 1,200.

**Default suggestion:** If not provided, use `P = N × 10` as a conservative estimate (i.e. assume the dataset represents 10% of the population).

---

## 2. Privacy Parameter Definitions & Algorithms

### 2.1 K-Anonymity (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.1. K-Anonymity computation is identical. Only the **interpretation** differs:

- In Prosecutor: any singleton is an immediate catastrophic risk (known target)
- In Marketer: singletons are high-value targets; small ECs inflate the average re-ID rate

### 2.2 L-Diversity (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.2. The check is identical.

Interpretation difference:
- Marketer attack cares about **attribute disclosure at scale** — even if no individual is uniquely identified, if every EC for a sensitive attribute has only one value, the attacker learns that attribute for ALL matched records.

### 2.3 T-Closeness (same as Prosecutor)

Refer to Prosecutor Attack Spec §2.3. Computation is identical.

### 2.4 Sample Size (same as Prosecutor)

```python
sample = dataset.sample(frac=sample_size_pct/100, random_state=42)
# All metrics computed on `sample`
# Display note: "Results based on N rows (X% sample)"
```

---

## 3. Marketer Attack — Full Algorithm & Math

### 3.1 What is the Marketer Attack?

The **Marketer Attack** models an adversary who:
1. Has **no prior knowledge** of whether any specific individual is in the dataset
2. Obtains the released dataset (or a linked version of it)
3. Tries to **match as many records as possible** against an external database (voter rolls, credit bureau, phone directories, social media)
4. Monetises or exploits every successful match

This is the most **commercially realistic** attack — data brokers, insurance companies, advertisers, and financial institutions routinely attempt population-scale re-identification.

---

### 3.2 Marketer Re-Identification Risk: The Math

#### 3.2.1 Per-Record Success Probability

For an adversary randomly selecting a target person from the external population `P` and trying to link them to a record in the dataset:

```
Marketer_Risk(r) = (1 / |EC(r)|) × (|EC(r)| / P)
                 = 1 / P
```

Wait — this simplifies to `1/P` regardless of EC size. That's the **unconditional** case. The more useful formulation is the **conditional** case: *given that the attacker has already found a matching EC in the data*, what is the probability they correctly identify the right person within it?

```
Marketer_Risk_conditional(r) = 1 / |EC(r)|
```

This is the same formula as the Prosecutor. The difference is in **how we aggregate** and **what we count as a success**.

#### 3.2.2 Expected Number of Correct Re-Identifications

The Marketer cares about **expected total re-identifications across all records** — not just any single one.

```
E[correct_reids] = Σ_r  (1 / |EC(r)|)
                 = Σ_EC  (|EC| × (1 / |EC|))
                 = Σ_EC  1
                 = number_of_distinct_ECs
```

So the **expected number of people the Marketer correctly re-identifies** equals the number of distinct equivalence classes.

**Intuition:** Each EC contributes exactly 1 expected correct match (the attacker "guesses" one record from the EC and is right on average once per EC).

#### 3.2.3 Marketer Re-ID Rate (Dataset-Level Score)

```
Marketer_ReID_Rate = E[correct_reids] / N
                   = number_of_distinct_ECs / N
```

This is algebraically identical to the Prosecutor's dataset-level `re_id_risk`. **But the interpretation is different:**

| Metric | Prosecutor Reading | Marketer Reading |
|---|---|---|
| `num_distinct_ECs / N = 0.8` | 80% of records can be confirmed if the target is known | 80% of the dataset is re-identifiable in a bulk linkage attack |

#### 3.2.4 Marketer Success Rate with Population Prior

When the external population size `P` is known:

```
# Probability an attacker randomly picks someone from P and correctly links them:
Marketer_Success_Rate = (N / P) × Marketer_ReID_Rate
```

Where:
- `N / P` = sampling fraction (what fraction of the population is in the dataset)
- `Marketer_ReID_Rate` = fraction of dataset records that are uniquely linkable

**Example:**
- Dataset has N = 5,000 records
- Population P = 100,000
- 80% of records are singletons → Marketer_ReID_Rate = 0.80
- `Marketer_Success_Rate = (5000/100000) × 0.80 = 0.05 × 0.80 = 0.04`
- **Interpretation:** A random attacker from the population has a 4% chance of finding and correctly re-identifying any given person.

---

### 3.3 Attribute Disclosure Risk (Marketer-Specific)

Unlike the Prosecutor (who re-identifies a specific person and reads their sensitive attributes), the Marketer also exploits **attribute disclosure at scale** — learning sensitive attributes for **groups** of people even without individual re-identification.

#### 3.3.1 Group Attribute Inference Risk

For each sensitive attribute `SA` and each equivalence class `EC`:

```
# If all records in an EC share the same SA value:
attribute_disclosure_risk(EC, SA) = 1.0   # Attacker learns SA for every linked record

# If SA values vary within EC:
attribute_disclosure_risk(EC, SA) = max_freq_SA_in_EC
```

Where `max_freq_SA_in_EC` = proportion of the most common SA value within the EC.

```python
for each EC:
    for each SA:
        value_counts = EC[SA].value_counts(normalize=True)
        max_freq = value_counts.max()
        attribute_disclosure_risk[EC][SA] = max_freq
```

**Interpretation:** If `max_freq = 0.9`, an attacker who links any record in this EC to the dataset can correctly infer the sensitive attribute 90% of the time.

#### 3.3.2 Dataset-Level Attribute Disclosure Score (per SA)

```
Avg_Attr_Disclosure(SA) = (1/N) × Σ_r  attribute_disclosure_risk(EC(r), SA)
```

This is the average probability that a randomly chosen person's sensitive attribute is correctly inferred by the attacker.

---

### 3.4 Population Inference Risk (Marketer-Specific)

The Marketer can also make **population-level inferences** from the released data — learning that certain combinations of QIs are rare or unique in the real world, which can then be used for targeted profiling.

```
Population_Inference_Risk = num_singletons / N
```

**Interpretation:** Singleton records not only reveal the individual — they reveal that **this specific QI combination is rare or unique** in the broader population, which is itself sensitive information (e.g., very few people in a district have a certain occupation + religion combination).

---

### 3.5 Full Marketer Attack Algorithm (Step by Step)

```python
def marketer_attack(dataframe, quasi_identifiers, sensitive_attributes,
                    k, l, t, sample_size_pct, population_size=None):

    # Step 1: Sample
    df = dataframe.sample(frac=sample_size_pct/100, random_state=42)
    N = len(df)

    # Step 2: Set population size
    P = population_size if population_size else N * 10  # default: 10x dataset

    # Step 3: Build Equivalence Classes
    ec_groups = df.groupby(quasi_identifiers)

    # Step 4: Compute EC sizes
    ec_sizes = ec_groups.size().reset_index(name='ec_size')
    df = df.merge(ec_sizes, on=quasi_identifiers, how='left')

    # Step 5: Per-record link score (same formula as Prosecutor)
    df['link_score'] = 1.0 / df['ec_size']

    # Step 6: Marketer Re-ID Rate
    num_distinct_ecs = ec_groups.ngroups
    marketer_reid_rate = num_distinct_ecs / N

    # Step 7: Marketer Success Rate (with population prior)
    sampling_fraction = N / P
    marketer_success_rate = sampling_fraction * marketer_reid_rate

    # Step 8: Expected correct re-identifications
    expected_correct_reids = num_distinct_ecs  # = Σ 1 per EC

    # Step 9: At-risk flag (same as Prosecutor: ec_size < k)
    df['at_risk'] = df['ec_size'] < k

    # Step 10: Attribute Disclosure Risk per SA
    attr_disclosure = {}
    for sa in sensitive_attributes:
        # Per-EC max frequency
        ec_max_freq = ec_groups[sa].apply(
            lambda x: x.value_counts(normalize=True).max()
        ).reset_index(name='max_freq_sa')
        df = df.merge(ec_max_freq, on=quasi_identifiers, how='left',
                      suffixes=('', f'_{sa}_maxfreq'))
        avg_disclosure = df['max_freq_sa'].mean()
        attr_disclosure[sa] = {
            'avg_disclosure_risk': round(avg_disclosure, 4),
            'pct_ecs_full_disclosure': round(
                (ec_max_freq['max_freq_sa'] == 1.0).sum() / len(ec_max_freq) * 100, 2
            ),
            'min_disclosure_risk': round(ec_max_freq['max_freq_sa'].min(), 4),
            'max_disclosure_risk': round(ec_max_freq['max_freq_sa'].max(), 4),
        }

    # Step 11: Population Inference Risk
    num_singletons = (df['ec_size'] == 1).sum()
    population_inference_risk = num_singletons / N

    # Step 12: L-Diversity check (identical to Prosecutor)
    l_div_results = {}
    for sa in sensitive_attributes:
        l_vals = ec_groups[sa].nunique().reset_index(name='l_diversity')
        df = df.merge(l_vals, on=quasi_identifiers, how='left',
                      suffixes=('', f'_{sa}_ldiv'))
        l_div_results[sa] = {
            'min_l': l_vals['l_diversity'].min(),
            'violating_ecs': (l_vals['l_diversity'] < l).sum(),
            'total_ecs': len(l_vals)
        }

    # Step 13: T-Closeness check (identical to Prosecutor)
    t_close_results = {}
    for sa in sensitive_attributes:
        global_dist = df[sa].value_counts(normalize=True)
        max_distance = 0
        violating_ecs = 0
        for name, group in ec_groups:
            local_dist = group[sa].value_counts(normalize=True)
            all_values = set(global_dist.index) | set(local_dist.index)
            tvd = 0.5 * sum(
                abs(local_dist.get(v, 0) - global_dist.get(v, 0)) for v in all_values
            )
            max_distance = max(max_distance, tvd)
            if tvd > t:
                violating_ecs += 1
        t_close_results[sa] = {
            'max_distance': round(max_distance, 4),
            'violating_ecs': violating_ecs,
            'total_ecs': ec_groups.ngroups
        }

    # Step 14: Top vulnerable records (highest link score)
    top_vulnerable = df[df['link_score'] == 1.0].head(10)
    if len(top_vulnerable) < 10:
        top_vulnerable = df.nlargest(10, 'link_score')

    return {
        'N': N,
        'P': P,
        'sampling_fraction': round(sampling_fraction, 4),
        'num_distinct_ecs': num_distinct_ecs,
        'marketer_reid_rate': round(marketer_reid_rate, 4),
        'marketer_success_rate': round(marketer_success_rate, 4),
        'expected_correct_reids': expected_correct_reids,
        'num_singletons': int(num_singletons),
        'population_inference_risk': round(population_inference_risk, 4),
        'avg_ec_size': round(df['ec_size'].mean(), 2),
        'min_k': int(df['ec_size'].min()),
        'at_risk_count': int(df['at_risk'].sum()),
        'protected_count': int(N - df['at_risk'].sum()),
        'attr_disclosure': attr_disclosure,
        'l_diversity': l_div_results,
        't_closeness': t_close_results,
        'ec_distribution': ec_sizes['ec_size'].value_counts().sort_index().to_dict(),
        'link_score_distribution': df['link_score'].value_counts(
            bins=[0, 0.01, 0.25, 0.50, 0.75, 0.99, 1.0]
        ).to_dict(),
        'top_vulnerable': top_vulnerable[
            quasi_identifiers + ['ec_size', 'link_score']
        ].to_dict('records'),
        'all_records': df[
            quasi_identifiers + ['ec_size', 'link_score', 'at_risk']
        ].to_dict('records')
    }
```

---

## 4. What the Results Panel Should Actually Display

> **Replace the current mock charts with the following real output sections.** The goal is that a non-technical government officer can read this panel and understand exactly what a data broker could do with their released dataset.

---

### 4.1 Attack Summary Banner (Top)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🔴  MARKETER ATTACK RESULTS                              RISK LEVEL: HIGH   │
│  Dataset: [filename]  |  Rows analysed: [N]  |  QIs used: [list of QI names] │
│  Population assumption: [P]  |  Sampling fraction: [N/P × 100]%             │
└──────────────────────────────────────────────────────────────────────────────┘

Plain-English Summary:
"A data broker who obtained this dataset could correctly re-identify an 
estimated [expected_correct_reids] out of [N] people ([marketer_reid_rate × 100]%) 
by matching records against external databases. 
For every 100 people in the broader population of [P], roughly 
[marketer_success_rate × 100] can be successfully linked to their record here."
```

**Risk Level thresholds:**
| Marketer Re-ID Rate | Risk Level |
|---|---|
| > 20% | 🔴 HIGH |
| 5%–20% | 🟡 MEDIUM |
| < 5% | 🟢 LOW |

---

### 4.2 Key Metrics Row (6 Cards)

| Card | Value | Label | Status Colour |
|---|---|---|---|
| Marketer Re-ID Rate | `[marketer_reid_rate × 100]%` | % of dataset linkable in a bulk attack | 🔴 >20%, 🟡 5–20%, 🟢 <5% |
| Expected Re-IDs | `[expected_correct_reids]` | Number of people a data broker correctly identifies | 🔴 if > 0.05×N |
| Success Rate (vs Population) | `[marketer_success_rate × 100]%` | Chance any random person from population is linked | 🔴 >2%, 🟡 0.5–2%, 🟢 <0.5% |
| Unique Records | `[num_singletons]` | Records with no look-alike — highest value targets | 🔴 if > 0 |
| Avg EC Size | `[avg_ec_size]` | Average group size sharing same QI values | 🔴 if < k |
| Min-K | `[min_k]` | Smallest group found | 🔴 if < user_k |

---

### 4.3 Record-Level Attack Trace Table

**This is the most important output.** Show every record (paginated at 50 rows) with exactly what a data broker sees when attempting bulk linkage:

| Row # | [QI-1] | [QI-2] | [QI-3] | ... | Group Size | Link Score | Marketer Value | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | RC-4 | FSU-87881 | Round-2 | ... | 1 | 1.00 | HIGH | 🔴 UNIQUELY LINKABLE |
| 2 | RC-1 | FSU-32748 | Round-1 | ... | 1 | 1.00 | HIGH | 🔴 UNIQUELY LINKABLE |
| 47 | RC-2 | FSU-10021 | Round-3 | ... | 3 | 0.33 | MEDIUM | 🟡 PARTIALLY LINKABLE |
| 88 | RC-0 | FSU-55001 | Round-2 | ... | 7 | 0.14 | LOW | 🟢 PROTECTED |

**Column explanations (shown as tooltips or footnotes):**
- **Group Size**: Number of records in this dataset sharing the same QI combination. Size = 1 means no look-alike exists.
- **Link Score**: Probability the attacker correctly links this record to the right individual. 1.00 = certain. 0.14 = 1-in-7 chance.
- **Marketer Value**: The commercial value of this record to a data broker. HIGH = singleton (certain match). MEDIUM = small EC (profitable match). LOW = large EC (not worth targeting individually).
- **Status**: Based on k-anonymity threshold k = [user_k].

**Add a filter bar above the table:**
```
[ Show All ] [ 🔴 Uniquely Linkable ] [ 🟡 Partially Linkable ] [ 🟢 Protected ]   Search: [_____________]
```

**Add CSV Export button:** "Download Full Linkage Report (CSV)"

---

### 4.4 Attack Narrative — "How the Marketer Attack Works on YOUR Data"

Show as a step-by-step walkthrough using ACTUAL values from the dataset:

```
ATTACK SIMULATION — Step by Step

Step 1 — The Data Broker's Starting Point
  A commercial attacker acquires this dataset (purchased, leaked, or obtained
  via a freedom-of-information request).
  They do NOT know in advance who is in it.
  They have access to external databases: voter rolls, telecom directories,
  credit bureau records, social media profiles.

Step 2 — Bulk Matching
  The attacker runs an automated join:
  "Match all records where Round_Centre_Code + FSU_Serial_No + Round 
   aligns with records in the voter roll database."
  
  This dataset has [num_distinct_ecs] distinct QI combinations.
  Each distinct combination gives the attacker one expected correct match.

Step 3 — Scale of Success
  Expected correct re-identifications: [expected_correct_reids] out of [N] records.
  That is [marketer_reid_rate × 100]% of this dataset.

  Out of [num_singletons] singleton records:
    → Each can be matched with 100% certainty.
    → A data broker pays a premium for these "gold" records.

Step 4 — Attribute Harvesting
  Once linked, the attacker reads sensitive attributes from the dataset:
  [For each SA]:
    [SA name]: Average inference accuracy across all linked records = [avg_disclosure_risk × 100]%

Step 5 — Commercial Outcome
  A dataset of [N] records with [marketer_reid_rate × 100]% linkability 
  can yield [expected_correct_reids] verified profiles.
  At typical data broker prices ($0.05–$2.00 per verified record),
  this dataset's re-identification value is estimated at 
  $[expected_correct_reids × 0.05] – $[expected_correct_reids × 2.00].
```

---

### 4.5 Equivalence Class Distribution (Real Chart)

**Table:**
| EC Size | Number of ECs | Number of Records | % of Dataset |
|---|---|---|---|
| 1 (Unique) | [x] | [x] | [x%] |
| 2–4 | [x] | [x] | [x%] |
| 5–10 | [x] | [x] | [x%] |
| 11–20 | [x] | [x] | [x%] |
| >20 | [x] | [x] | [x%] |

**Chart:** Horizontal bar chart. Each bar = number of records at that EC size bucket. Colour: 🔴 red for size=1, 🟠 orange for 2–4, 🟡 yellow for 5–9, 🟢 green for ≥k.

**Marketer Annotation (unique to this attack):**
Add a second axis or annotation line showing **"Marketer value per bucket"** — singletons have the highest value, large ECs have the lowest.

```
Marketer Value by EC Size:
  EC = 1   → Link Score 1.00 → Certainty = 100% → Value: ★★★★★
  EC = 2–4 → Link Score 0.25–0.50 → Value: ★★★☆☆
  EC = 5–9 → Link Score 0.11–0.20 → Value: ★★☆☆☆
  EC ≥ 10  → Link Score ≤ 0.10 → Value: ★☆☆☆☆
```

---

### 4.6 Link Score Distribution (Real Chart)

| Score Range | Number of Records | Marketer Interpretation |
|---|---|---|
| 1.00 (certain) | [x] | Attacker is 100% certain — premium-value records |
| 0.51–0.99 (high) | [x] | More likely correct than not — profitable target |
| 0.26–0.50 (medium) | [x] | Coin-flip — marginal target |
| 0.01–0.25 (low) | [x] | < 25% chance — rarely targeted individually |
| 0.00 (safe) | [x] | Effectively anonymous — no value to attacker |

---

### 4.7 Attribute Disclosure Risk (Marketer-Specific Section)

> This section has **no equivalent** in the Prosecutor Attack spec. It is unique to the Marketer Attack because the Marketer exploits sensitive attributes at population scale, not just for one re-identified person.

```
ATTRIBUTE DISCLOSURE RISK (Marketer-Specific)

This measures how accurately a data broker can infer each sensitive attribute 
for records in this dataset, even when exact re-identification is not achieved.

─────────────────────────────────────────────────────────────────
Sensitive Attribute: [SA_NAME_1]
  Average inference accuracy (across all records): [avg_disclosure_risk × 100]%
  ECs where attacker is 100% certain of SA value:  [pct_ecs_full_disclosure]%
  Min inference accuracy (safest EC):               [min_disclosure_risk × 100]%
  Max inference accuracy (most exposed EC):         [max_disclosure_risk × 100]%
  Status: [🔴 FAIL if avg > 0.8 | 🟡 WARN if avg 0.5–0.8 | 🟢 PASS if avg < 0.5]

  Meaning: For [pct_ecs_full_disclosure]% of groups in this dataset, 
  every record in the group shares the SAME [SA_NAME_1] value. 
  An attacker who links any member of such a group immediately learns 
  [SA_NAME_1] for everyone in that group.

─────────────────────────────────────────────────────────────────
Sensitive Attribute: [SA_NAME_2]
  Average inference accuracy: [avg_disclosure_risk × 100]%
  ECs where attacker is 100% certain: [pct_ecs_full_disclosure]%
  ...
  Status: [🔴 / 🟡 / 🟢]
```

**Thresholds for Attribute Disclosure Status:**
| Avg Disclosure Risk | Status |
|---|---|
| > 80% | 🔴 FAIL — Sensitive attribute is effectively disclosed |
| 50%–80% | 🟡 WARN — Significant leakage risk |
| < 50% | 🟢 PASS — Acceptable diversity |

---

### 4.8 Population Inference Risk (Marketer-Specific Section)

> Another section unique to the Marketer Attack. The Prosecutor doesn't care about population-level inferences; the Marketer does.

```
POPULATION INFERENCE RISK

Dataset: [N] records drawn from an assumed population of [P]
Sampling fraction: [N/P × 100]%

Singleton records: [num_singletons] ([population_inference_risk × 100]% of dataset)

These [num_singletons] records reveal not just information about the individuals 
they represent — they reveal that these QI combinations are RARE OR UNIQUE 
in the broader population. This is itself sensitive information.

Examples from your data (top 3 singletons):
  Row [x]: [QI1_val], [QI2_val], [QI3_val] → unique in dataset → likely rare in population
  Row [x]: ...
  Row [x]: ...

Marketer Success Rate (with population prior):
  = (N / P) × Marketer Re-ID Rate
  = ([N] / [P]) × [marketer_reid_rate × 100]%
  = [marketer_success_rate × 100]%

Meaning: If a data broker randomly picks any person from the population of [P], 
there is a [marketer_success_rate × 100]% chance they can correctly find and 
link that person's record in this dataset.
```

---

### 4.9 L-Diversity Results (Per Sensitive Attribute)

```
L-DIVERSITY CHECK (threshold l = [user_l])

Sensitive Attribute: [SA_NAME]
  Min distinct values in any EC:       [min_l]
  ECs violating l-diversity:           [violating_ecs] out of [total_ecs] ([pct]%)
  Records in violating ECs:            [x] out of [N] ([pct]%)
  Meaning: In some groups, all records share the same [SA_NAME] value.
           A data broker who links any record from such a group learns 
           [SA_NAME] for the ENTIRE group — bulk attribute disclosure.
  Status: 🔴 FAIL / 🟡 WARN / 🟢 PASS
```

---

### 4.10 T-Closeness Results (Per Sensitive Attribute)

```
T-CLOSENESS CHECK (threshold t = [user_t])

Sensitive Attribute: [SA_NAME]
  Global distribution: {value1: x%, value2: y%, ...}
  Maximum EC deviation from global:    [max_distance]
  ECs violating t-closeness:           [violating_ecs] out of [total_ecs] ([pct]%)
  Meaning: The distribution of [SA_NAME] inside individual QI groups is very 
           different from its distribution in the overall dataset. 
           A data broker can use this skew to infer [SA_NAME] with higher 
           accuracy than guessing from the global average.
  Status: 🔴 FAIL / 🟡 WARN / 🟢 PASS
```

---

### 4.11 Risk Protection Donut (Real Numbers)

```
At Risk:   [at_risk_count] records ([at_risk_pct]%) — EC size < k OR link_score = 1.0
Protected: [protected_count] records ([protected_pct]%) — EC size ≥ k

Tooltip on hover:
  At Risk: "These records are commercially valuable to a data broker — 
            their QI combination is rare enough to allow confident linkage 
            to external databases."
  Protected: "These records share their QI combination with at least [k] 
              others, making individual linkage unprofitable for bulk attacks."
```

---

### 4.12 Top Vulnerable Records Table

Show the 10 highest-risk records with full QI values and a **Marketer Value rating**:

| Rank | QI Combination (full values) | Link Score | EC Size | Marketer Value | Why Vulnerable |
|---|---|---|---|---|---|
| 1 | RC-4, FSU-87881, Round-2, Dist-D04 | 1.00 | 1 | ★★★★★ | Singleton — uniquely linkable in bulk attack |
| 2 | RC-1, FSU-32748, Round-1, Dist-D02 | 1.00 | 1 | ★★★★★ | Singleton — uniquely linkable in bulk attack |
| 3 | RC-2, FSU-10021, Round-3, Dist-D07 | 0.50 | 2 | ★★★☆☆ | Only 2 look-alikes — 50% linkage probability |

**Add a note:** "These rows have the highest commercial re-identification value. They should be suppressed or generalised before releasing this dataset."

---

### 4.13 Recommendations Section (Auto-generated, Specific)

Generate dynamically based on actual results — NOT static text. Show only conditions that are actually violated.

```
RECOMMENDATIONS (based on Marketer Attack assessment)

🔴 CRITICAL — [num_singletons] singleton records detected
   Commercial value to attacker: HIGHEST (100% linkage certainty)
   Action: Apply record suppression — remove these [num_singletons] rows before release,
   OR generalise [highest-cardinality QI] to reduce singleton count to zero.
   Target: 0 singleton records after generalisation.

🔴 HIGH — Marketer Re-ID Rate is [marketer_reid_rate × 100]% (threshold: <5%)
   [expected_correct_reids] records are linkable in a bulk attack.
   Action: Apply k-anonymisation. Generalise [top contributing QI] to reduce 
   the number of distinct ECs. Aim for Min-K ≥ [user_k].

🔴 HIGH — Attribute Disclosure Risk for [SA_name] is [avg_disclosure_risk × 100]%
   A data broker who links records in this dataset can infer [SA_name] 
   with [avg_disclosure_risk × 100]% accuracy on average.
   Action: Ensure l-diversity ≥ [user_l] for [SA_name] within every EC. 
   Consider suppressing or coarsening [SA_name] before release.

🟡 MEDIUM — L-Diversity violated for [SA_name]
   [violating_ecs] ECs have fewer than [l] distinct values of [SA_name].
   Action: Apply local suppression or top-coding to increase SA diversity 
   within affected ECs.

🟡 MEDIUM — T-Closeness violated for [SA_name]
   [violating_ecs] ECs have distributions of [SA_name] that deviate 
   significantly from the dataset-wide distribution (max TVD = [max_distance]).
   Action: Consider value generalisation or post-randomisation on [SA_name].

ℹ️ POPULATION CONTEXT
   This dataset represents [N/P × 100]% of an assumed population of [P].
   Marketer success rate: [marketer_success_rate × 100]% per random target.
   If the population size estimate is wrong, update it in the settings panel 
   to see how risk changes.

ℹ️ NEXT STEP
   Go to "Privacy Enhancement" to apply these fixes automatically.
   After enhancement, re-run this assessment to verify improvement.
```

---

## 5. Attack Score for the Top Navigation Bar

The **Marketer badge score** shown in the header:

```
marketer_score = marketer_reid_rate × 100     # 0–100

Display as the Marketer badge score. Colour: 🔴 >20, 🟡 5–20, 🟢 <5.
```

**Combined Comparison Score (when multiple attacks are enabled):**
```
overall_score = mean(prosecutor_score, marketer_score, journalist_score, ...)
```

---

## 6. Key Differences: Prosecutor vs Marketer Results Panel

| Section | Prosecutor Attack | Marketer Attack |
|---|---|---|
| Attack Summary Banner | "Attacker knows target is in dataset" | "Data broker attempts bulk linkage" |
| Key Metrics Cards | Re-ID Risk, Unique Records, Avg EC Size, Min-K | Adds: Expected Re-IDs, Success Rate vs Population |
| Record Trace Table | Link Score + Status | Adds: Marketer Value rating (★ scale) |
| Attack Narrative | Single-target step-by-step | Bulk matching step-by-step + commercial value estimate |
| Attribute Disclosure Section | ❌ Not present | ✅ Present — group-level SA inference |
| Population Inference Risk | ❌ Not present | ✅ Present — includes population prior math |
| L-Diversity Results | ✅ Standard | ✅ With bulk-disclosure framing |
| T-Closeness Results | ✅ Standard | ✅ With skew-exploitation framing |
| Risk Donut | "At Risk / Protected" | Same but tooltip is commercially framed |
| Top Vulnerable Table | Link Score + Why Vulnerable | Adds: Marketer Value (★★★★★ scale) |
| Recommendations | K-anonymity, generalisation | Adds: Attribute disclosure, population context |

---

## 7. Data Flow Summary

```
User uploads CSV
       ↓
User selects QIs + SAs + sets k, l, t, sample_size, population_size
       ↓
[Run Assessment clicked — Marketer Attack tab]
       ↓
1.  Sample dataset (sample_size_pct)
2.  Set population size P (user input or default N×10)
3.  Build equivalence classes (groupby QIs)
4.  Compute ec_size per record
5.  Compute link_score = 1/ec_size per record
6.  Compute marketer_reid_rate = num_distinct_ecs / N
7.  Compute marketer_success_rate = (N/P) × marketer_reid_rate
8.  Compute expected_correct_reids = num_distinct_ecs
9.  Run k-anonymity check
10. Compute attribute_disclosure_risk per SA per EC
11. Compute population_inference_risk = num_singletons / N
12. Run l-diversity check per SA
13. Run t-closeness check per SA
14. Identify top vulnerable records (by link_score desc)
15. Generate recommendations (conditional on actual violations)
       ↓
Render results panel with ALL sections above (4.1–4.13)
```

---

## 8. Implementation Notes for Replit Agent

1. **Remove all hardcoded/mock data** from the Marketer Attack results panel. Every number must come from the algorithm output.
2. **Population size input field** must be added to the Marketer Attack configuration panel. Default = `N × 10`. Allow user override. Show live preview: "Sampling fraction: [N/P × 100]%".
3. **The Attribute Disclosure Risk section (§4.7) is mandatory and Marketer-specific** — it does not exist in the Prosecutor panel. Build it from `attr_disclosure` output.
4. **The Population Inference Risk section (§4.8) is mandatory and Marketer-specific** — include the estimated commercial value estimate using the $0.05–$2.00 range.
5. **The Attack Narrative (§4.4) must use real values** from the actual computation. Pull `expected_correct_reids`, `marketer_reid_rate`, `marketer_success_rate`, and the top 3 singletons.
6. **Marketer Value (★ scale) in the record trace table** must be computed as:
   - Link Score = 1.00 → ★★★★★
   - Link Score 0.50–0.99 → ★★★★☆
   - Link Score 0.25–0.49 → ★★★☆☆
   - Link Score 0.10–0.24 → ★★☆☆☆
   - Link Score < 0.10 → ★☆☆☆☆
7. **Recommendations (§4.13) must be conditional** — only show a recommendation if the condition is actually violated.
8. **All charts must be built from real computed distributions**, not dummy arrays.
9. **Status badges** (🔴/🟡/🟢) on the Marketer Attack tab in the top nav should update after each run.
10. **Export**: "Download Marketer Attack Report (CSV)" — full record-level table with link_score, ec_size, marketer_value, at_risk, and per-SA disclosure risk columns.
11. The plain-English summary paragraph (§4.1) must be **template-filled with actual numbers** on every run.
12. The EC distribution chart (§4.5) must include the **Marketer Value annotation** layer — this is unique to this attack's chart and should NOT appear in the Prosecutor Attack chart.

---

*Specification version: 1.0 | For MoSPI Statathon 2025 — SafeData Pipeline*
