import { buildEquivalenceClasses, getRiskLevel, type DataRow, type RiskLevel } from "./utils";

export interface RecordLinkageResult {
  riskScore: number;
  riskLevel: RiskLevel;
  totalRecords: number;
  linkedRecords: number;
  perfectLinks: number;
  ambiguousLinks: number;
  unlinkedRecords: number;
  avgMatchSize: number;
  linkRiskHistogram: { bucket: string; count: number }[];
  externalMatchDistribution: { matches: string; count: number; risk: string }[];
  topVulnerable: { qiCombo: string; matchCount: number; linkScore: number }[];
  riskDonut: { name: string; value: number }[];
  recommendations: string[];
}

/**
 * Record Linkage Attack
 *
 * Objective: Determine whether anonymized records can be re-identified by
 * linking against a simulated external dataset.
 *
 * Simulation: We split the dataset in half. One half plays the role of the
 * "anonymized release"; the other half is the "external public dataset" an
 * attacker possesses (e.g., a voter roll, census table, or social-media dump).
 * We then compute, for every record r in the anonymized half:
 *
 *   M(r) = { e ∈ External | e.QI = r.QI }
 *
 *   P(re-id | r) = 1 / |M(r)|   if |M(r)| ≥ 1
 *                 0              otherwise
 *
 * Dataset-level risk:
 *   Risk = Σ P(re-id | r) / N
 *
 * This is the Sweeney/Samarati record-linkage threat model (VLDB 2002).
 */
export function runRecordLinkageAttack(
  data: DataRow[],
  quasiIdentifiers: string[]
): RecordLinkageResult {
  if (data.length === 0 || quasiIdentifiers.length === 0) {
    return emptyResult();
  }

  // ── Simulate External Dataset ──────────────────────────────────────────────
  // Shuffle then split: first half = anonymized release, second half = external
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const splitAt = Math.max(1, Math.floor(shuffled.length / 2));
  const anonymized = shuffled.slice(0, splitAt);
  const external = shuffled.slice(splitAt);

  // Build QI → frequency map from the external dataset
  const externalQIMap = new Map<string, number>();
  external.forEach((row) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    externalQIMap.set(key, (externalQIMap.get(key) || 0) + 1);
  });

  // ── Per-Record Linkage Risk ────────────────────────────────────────────────
  const perRecord: { key: string; matchCount: number; linkScore: number }[] = [];
  let totalRisk = 0;
  let perfectLinks = 0;
  let ambiguousLinks = 0;
  let unlinked = 0;
  const matchCountFreq = new Map<number, number>();

  anonymized.forEach((row) => {
    const key = quasiIdentifiers.map((qi) => String(row[qi] ?? "")).join("|");
    const matches = externalQIMap.get(key) || 0;
    let linkScore = 0;
    if (matches === 0) {
      unlinked++;
    } else if (matches === 1) {
      linkScore = 1.0;
      perfectLinks++;
    } else {
      linkScore = 1 / matches;
      ambiguousLinks++;
    }
    totalRisk += linkScore;
    perRecord.push({ key, matchCount: matches, linkScore });
    matchCountFreq.set(matches, (matchCountFreq.get(matches) || 0) + 1);
  });

  const N = anonymized.length;
  const riskScore = totalRisk / N;
  const linkedRecords = perfectLinks + ambiguousLinks;
  const avgMatchSize = linkedRecords > 0
    ? perRecord.filter((r) => r.matchCount > 0).reduce((s, r) => s + r.matchCount, 0) / linkedRecords
    : 0;

  // ── Link Risk Histogram (bucket by link score) ─────────────────────────────
  const buckets = [
    { label: "0% (No link)", min: 0, max: 0 },
    { label: "1-25%", min: 0.001, max: 0.25 },
    { label: "26-50%", min: 0.251, max: 0.5 },
    { label: "51-75%", min: 0.501, max: 0.75 },
    { label: "76-99%", min: 0.751, max: 0.999 },
    { label: "100% (Unique)", min: 1.0, max: 1.0 },
  ];
  const linkRiskHistogram = buckets.map(({ label, min, max }) => ({
    bucket: label,
    count: perRecord.filter((r) =>
      max === 1.0 ? r.linkScore === 1.0 :
      min === 0 ? r.linkScore === 0 :
      r.linkScore >= min && r.linkScore <= max
    ).length,
  }));

  // ── External Match Distribution ────────────────────────────────────────────
  const matchLabels = [0, 1, 2, 3, 4, 5];
  const externalMatchDistribution = matchLabels.map((m) => ({
    matches: m === 5 ? "5+" : String(m),
    count: m === 5
      ? perRecord.filter((r) => r.matchCount >= 5).length
      : perRecord.filter((r) => r.matchCount === m).length,
    risk: m === 0 ? "SAFE" : m === 1 ? "CRITICAL" : m <= 3 ? "HIGH" : "MEDIUM",
  }));

  // ── Top Vulnerable (highest link score) ────────────────────────────────────
  const topVulnerable = [...perRecord]
    .filter((r) => r.matchCount > 0)
    .sort((a, b) => b.linkScore - a.linkScore)
    .slice(0, 10)
    .map((r) => ({
      qiCombo: r.key.slice(0, 60),
      matchCount: r.matchCount,
      linkScore: parseFloat((r.linkScore * 100).toFixed(1)),
    }));

  const riskDonut = [
    { name: "Perfectly Linked", value: perfectLinks },
    { name: "Ambiguously Linked", value: ambiguousLinks },
    { name: "Unlinked", value: unlinked },
  ];

  const recommendations = buildRecommendations(riskScore, perfectLinks, N, avgMatchSize, quasiIdentifiers.length);

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    totalRecords: N,
    linkedRecords,
    perfectLinks,
    ambiguousLinks,
    unlinkedRecords: unlinked,
    avgMatchSize,
    linkRiskHistogram,
    externalMatchDistribution,
    topVulnerable,
    riskDonut,
    recommendations,
  };
}

function buildRecommendations(
  risk: number,
  perfectLinks: number,
  total: number,
  avgMatchSize: number,
  qiCount: number
): string[] {
  const recs: string[] = [];
  const perfectPct = total > 0 ? (perfectLinks / total) * 100 : 0;

  if (perfectPct > 20) {
    recs.push(`${perfectPct.toFixed(0)}% of records are uniquely linkable to external data — apply generalization or suppression to reduce uniqueness.`);
  }
  if (risk > 0.5) {
    recs.push("Overall linkage risk is HIGH. Consider coarsening quasi-identifier values (e.g., age ranges instead of exact ages, district instead of city).");
  }
  if (avgMatchSize < 3 && avgMatchSize > 0) {
    recs.push(`Low average match size (${avgMatchSize.toFixed(1)}) — increase k-anonymity to at least k=5 to spread records across more equivalence classes.`);
  }
  if (qiCount >= 4) {
    recs.push(`${qiCount} quasi-identifiers selected — each additional QI increases linkage precision. Consider suppressing low-information QIs.`);
  }
  recs.push("Publish only aggregate statistics or use differential privacy mechanisms when external datasets may be available to adversaries.");
  if (risk < 0.2) {
    recs.push("Record linkage risk is LOW. Current generalization provides good protection against external database attacks.");
  }
  return recs;
}

function emptyResult(): RecordLinkageResult {
  return {
    riskScore: 0, riskLevel: "LOW", totalRecords: 0, linkedRecords: 0,
    perfectLinks: 0, ambiguousLinks: 0, unlinkedRecords: 0, avgMatchSize: 0,
    linkRiskHistogram: [], externalMatchDistribution: [], topVulnerable: [],
    riskDonut: [], recommendations: [],
  };
}
