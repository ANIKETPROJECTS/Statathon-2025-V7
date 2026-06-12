---
name: Differencing Attack Spec
description: Core formulas, interface shape, and runner signature for the Differencing Attack
---

## Core formula
diff_risk(ec_size, k):
  ec_size == 1  → 1.00   (exact reconstruction)
  ec_size == 2  → 0.75
  ec_size == 3  → 0.50
  ec_size < k   → 1/ec_size
  else          → max(0.05, 1/ec_size)

DDR = mean(diff_risk(r)) across all N records
riskScore = DDR

## Labels (distinct from all other attacks)
Exact Reconstruction / Near-Exact / Partial / Protected

## Badge thresholds (DDR)
> 0.20  → HIGH    🔴
0.05–0.20 → MEDIUM 🟡
< 0.05  → LOW     🟢

## Runner signature
runDifferencingAttack(data, quasiIdentifiers, sensitiveAttributes, kThreshold, lThreshold, tThreshold)

## Key result fields
riskScore, riskLevel, N, ddr, exactCount, nearExactCount, partialCount, protectedCount,
coverageRate, distinctEcs, minK, avgEcSize, quasiIdentifiers, sensitiveAttributes,
recordTable, ecSizeDistribution, saReconstruction, lDivResults, tCloseResults,
topVulnerable, queryPairs, mostVulnerableRecord, recommendations

## UI — 14 sections (§5.1–§5.13 + badge §5.14)
§5.1 Summary banner — risk badge + narrative + explicit "k-anon/l-div do NOT protect"
§5.2 KPI row — DDR, Exact Recon, Near-Exact, Total Reconstructable, Min EC, Avg EC
§5.3 Vulnerability donut (4 segments: Exact/Near-Exact/Partial/Protected)
§5.4 Record trace table — paginated 50/page, 4-filter bar + search, CSV export
§5.5 Attack simulation narrative — actual SQL-like queries + reconstruction arithmetic
§5.6 EC size distribution — table + bar chart (5 buckets: 1/2-3/4-k/k-10/>10)
§5.7 SA Reconstruction Analysis — numeric: error table (σ/√n) + required noise; categorical: count-based
§5.8 DP Noise Sufficiency Check — per-SA table of SA sensitivity + required Laplace noise std
§5.9 L-Diversity PASS/FAIL per SA (note: does NOT block differencing)
§5.10 T-Closeness PASS/FAIL per SA (note: does NOT block differencing)
§5.11 Top 10 vulnerable records — with Why Vulnerable column
§5.12 Query Pair Catalogue — top 5, actual SQL query A/B + reconstruction formula
§5.13 Conditional recommendations

## Comparison table metric (risk-page.tsx)
Updated from `leakyPct% leaky queries` → `DDR ${ddr*100}%`

## Why
Old stub used leave-one-out leakage on numeric columns (wrong model).
Spec requires EC-based risk identical to Prosecutor/Record Linkage BUT adds:
- SA Reconstruction Analysis distinguishing numeric vs categorical
- DP Noise Sufficiency Check (unique to this attack)
- Query Pair Catalogue with real SQL-like pairs (makes attack concrete for stakeholders)
