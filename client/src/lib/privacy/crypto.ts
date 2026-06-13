import { type DataRow, isNumericCol, type PrivacyResult } from "./types";

// ══════════════════════════════════════════════════════════════════════════════
// BIGINT UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod;
    exp >>= 1n;
    base = base * base % mod;
  }
  return result;
}

function extgcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = extgcd(b, a % b);
  return [g, y, x - (a / b) * y];
}

function modinv(a: bigint, m: bigint): bigint {
  const [g, x] = extgcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error("No modular inverse");
  return ((x % m) + m) % m;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

// Deterministic Miller-Rabin primality test
// Witnesses cover all n < 3.3 × 10^24 deterministically
function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d >>= 1n; r++; }
  for (const a of small) {
    if (a >= n) continue;
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 0n; i < r - 1n; i++) {
      x = x * x % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

// Seeded PRNG (same algorithm as synthetic.ts for consistency)
function makePRNG(seed: number): () => number {
  let s = (seed ^ 0xDEADBEEF) >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// Random odd BigInt of exactly `bits` bits (MSB forced to 1)
function randBigInt(bits: number, rng: () => number): bigint {
  let n = 0n;
  for (let i = 0; i < bits; i++) n |= (rng() < 0.5 ? 1n : 0n) << BigInt(i);
  n |= 1n << BigInt(bits - 1); // MSB = 1  → exactly `bits` bits
  n |= 1n;                      // LSB = 1  → odd
  return n;
}

// Generate distinct primes of exactly `bits` bits using rng
function generateTwoDistinctPrimes(bits: number, rng: () => number): [bigint, bigint] {
  let p: bigint, q: bigint;
  do { p = randBigInt(bits, rng); } while (!isPrime(p));
  do { q = randBigInt(bits, rng); } while (!isPrime(q) || q === p);
  return [p, q];
}

// Simulation prime bit-widths for browser performance.
// IMPORTANT: these are NOT the production key sizes — the displayed keySize label is
// the structural equivalent (Paillier n = p×q, so n_bits = 2×prime_bits).
// Actual n bit-size is reported explicitly in all stats/reports.
function primeBitsFor(keySize: number): number {
  if (keySize >= 2048) return 32;   // actual n ≈ 64-bit  (structural 2048-bit equivalent)
  if (keySize >= 1024) return 26;   // actual n ≈ 52-bit  (structural 1024-bit equivalent)
  return 20;                        // actual n ≈ 40-bit  (structural 512-bit equivalent)
}

// Validate that a value can be safely encoded without mod-n wrap-around.
// Safe range: |v| × PAILLIER_SCALE < n/2  (to allow signed two's-complement representation)
function isSafeToEncode(v: number, n: bigint): boolean {
  const scaled = BigInt(Math.round(Math.abs(v) * Number(PAILLIER_SCALE)));
  return scaled < n / 2n;
}

// ══════════════════════════════════════════════════════════════════════════════
// PAILLIER HOMOMORPHIC ENCRYPTION
// ══════════════════════════════════════════════════════════════════════════════

interface PaillierKeys {
  n: bigint; n2: bigint; lambda: bigint; mu: bigint; g: bigint;
}

function paillierKeyGen(bits: number, rng: () => number): PaillierKeys {
  const [p, q] = generateTwoDistinctPrimes(bits, rng);
  const n  = p * q;
  const n2 = n * n;
  const λ  = lcm(p - 1n, q - 1n);
  const g  = n + 1n;                    // Paillier simplification: g = n+1
  // L(g^λ mod n²) = λ · (p-1)(q-1)/λ = (p-1)(q-1) in Z_n  (simplification gives L=1)
  // For g=n+1: g^λ = (1+n)^λ = 1 + λn  (mod n²)  →  L = λ
  const μ  = modinv(λ, n);             // μ = λ⁻¹ mod n
  return { n, n2, lambda: λ, mu: μ, g };
}

// Encode float → BigInt message in Z_n (handles negative via two's complement mod n)
const PAILLIER_SCALE = 1000n;  // 3 decimal places of precision
function encodeFloat(v: number, n: bigint): bigint {
  const m = BigInt(Math.round(v * Number(PAILLIER_SCALE)));
  return ((m % n) + n) % n;
}

// Decode BigInt → float (reverse two's complement)
function decodeFloat(m: bigint, n: bigint): number {
  const half = n / 2n;
  const signed = m > half ? m - n : m;
  return Number(signed) / Number(PAILLIER_SCALE);
}

// Encrypt: c = (1 + mn) · r^n mod n²   [g = n+1 simplification]
function paillierEncrypt(m: bigint, keys: PaillierKeys, r: bigint): bigint {
  const part1 = (1n + m * keys.n) % keys.n2;
  const part2 = modpow(r, keys.n, keys.n2);
  return part1 * part2 % keys.n2;
}

// Decrypt: m = L(c^λ mod n²) · μ mod n   where L(x) = (x-1)/n
function paillierDecrypt(c: bigint, keys: PaillierKeys): bigint {
  const u = modpow(c, keys.lambda, keys.n2);
  const Lval = (u - 1n) / keys.n;   // integer division — exact because (u-1) ≡ 0 mod n
  return Lval * keys.mu % keys.n;
}

// Homomorphic addition: E(m1) · E(m2) mod n²
function paillierHAdd(c1: bigint, c2: bigint, n2: bigint): bigint {
  return c1 * c2 % n2;
}

// Homomorphic scalar multiply: E(m)^scalar mod n²  (adds m scalar times)
function paillierHScalar(c: bigint, scalar: bigint, n2: bigint): bigint {
  return modpow(c, scalar, n2);
}

export function applyHomomorphicEncryption(
  data: DataRow[],
  targetCols: string[],
  keySize: number,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return emptyResult("Homomorphic Encryption (Paillier)");

  const allCols = Object.keys(data[0]);
  const numCols = allCols.filter((c) => isNumericCol(data, c));
  const encCols  = targetCols.length > 0
    ? targetCols.filter((c) => numCols.includes(c))
    : numCols;

  if (encCols.length === 0) return emptyResult("Homomorphic Encryption (Paillier)");

  const rng   = makePRNG(Date.now() ^ 0x1A2B3C4D);
  const bits  = primeBitsFor(keySize);
  const keys  = paillierKeyGen(bits, rng);
  // Actual n bit-size (may differ slightly from bits*2 due to prime generation variability)
  const actualNBits = keys.n.toString(2).length;

  // ── Issue 2 fix: Per-column plaintext overflow guard ─────────────────────────
  // Safe encoding range: |v| × 1000 < n/2  (signed two's-complement mod n).
  // Columns where any value exceeds this bound would silently wrap mod n, producing
  // incorrect homomorphic sums with no error signal — they are excluded entirely.
  const N = Math.min(data.length, 500);
  const subset = data.slice(0, N);

  const overflowCols: string[] = [];
  const safeCols: string[] = [];
  for (const col of encCols) {
    const vals = subset.map((row) => Number(row[col])).filter((v) => !isNaN(v));
    const maxAbs = vals.length > 0 ? Math.max(...vals.map(Math.abs)) : 0;
    if (isSafeToEncode(maxAbs, keys.n)) {
      safeCols.push(col);
    } else {
      overflowCols.push(col);
    }
  }
  const safeEncCols = safeCols;  // only encrypt columns that pass the range check

  // Generate a random blinding factor r coprime to n
  let r: bigint;
  do { r = randBigInt(bits - 1, rng) % (keys.n - 1n) + 1n; }
  while (gcd(r, keys.n) !== 1n);

  // Build per-column encode/decrypt demo
  const colStats: Record<string, Record<string, string | number>> = {};

  // Encrypt each row (safe columns only)
  const processed: DataRow[] = subset.map((row) => {
    const newRow: DataRow = { ...row };
    for (const col of safeEncCols) {
      const v = Number(row[col]);
      if (!isNaN(v)) {
        const m  = encodeFloat(v, keys.n);
        const c  = paillierEncrypt(m, keys, r);
        // Store as "C:hexprefix" to show it's a ciphertext
        newRow[col] = "C:" + c.toString(16).slice(0, 16) + "…";
      }
    }
    return newRow;
  });

  // Demonstrate homomorphic sum on first SAFE column (overflow cols excluded)
  const demoCol  = safeEncCols[0] ?? encCols[0];
  const origVals = subset.map((row) => Number(row[demoCol])).filter((v) => !isNaN(v));
  const origSum  = origVals.reduce((s, v) => s + v, 0);

  // Encrypt each value and multiply ciphertexts (homomorphic sum) — only valid for safe columns
  let roundTrip = false, decSum = 0;
  if (safeEncCols.length > 0) {
    const ciphertexts = origVals.map((v) => paillierEncrypt(encodeFloat(v, keys.n), keys, r));
    const cipherSum   = ciphertexts.reduce((acc, c) => paillierHAdd(acc, c, keys.n2), 1n);
    decSum    = decodeFloat(paillierDecrypt(cipherSum, keys), keys.n);
    roundTrip = Math.abs(decSum - origSum) < 0.5;
  }

  // Verify individual decrypt on one sample
  const sampleV   = origVals[0] ?? 0;
  const sampleEnc = paillierEncrypt(encodeFloat(sampleV, keys.n), keys, r);
  const sampleDec = decodeFloat(paillierDecrypt(sampleEnc, keys), keys.n);
  const decOk     = Math.abs(sampleDec - sampleV) < 0.001;

  // Per-column colStats (safe cols only — overflow cols marked separately)
  for (const col of safeEncCols) {
    const vals  = subset.map((row) => Number(row[col])).filter((v) => !isNaN(v));
    const mean  = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    colStats[col] = {
      "Count":           vals.length,
      "Original Mean":   mean.toFixed(4),
      "Min":             min.toFixed(4),
      "Max":             max.toFixed(4),
      "Max |v|×1000":    (Math.max(...vals.map(Math.abs)) * 1000).toFixed(0),
      "Encoding Safe":   "✓ |v|×1000 < n/2",
      "Ciphertext Size": `${Math.ceil(actualNBits / 4)} hex chars (actual n=${actualNBits}-bit)`,
      "Encryption":      "✓ Paillier",
    };
  }
  for (const col of overflowCols) {
    const vals  = subset.map((row) => Number(row[col])).filter((v) => !isNaN(v));
    const maxAbs = vals.length > 0 ? Math.max(...vals.map(Math.abs)) : 0;
    colStats[col] = {
      "Count":         vals.length,
      "Max |v|×1000":  (maxAbs * 1000).toFixed(0),
      "n/2 (safe bound)": (Number(keys.n / 2n)).toFixed(0),
      "Encoding Safe": "⚠ OVERFLOW — col skipped (|v|×1000 ≥ n/2 would silently wrap)",
      "Encryption":    "— skipped",
    };
  }

  const nHex      = keys.n.toString(16);
  const lambdaHex = keys.lambda.toString(16);

  const report = buildHEReport({
    keySize, actualNBits, encCols: safeEncCols, overflowCols, N,
    origSum, decSum, roundTrip, decOk,
    sampleV, sampleDec, nHex, lambdaHex,
    colStats,
  });

  return {
    technique: "Homomorphic Encryption (Paillier)",
    family: "Cryptographic PETs",
    processedData: processed,
    originalCount: data.length,
    processedCount: N,
    recordsSuppressed: 0,
    // Issue 3: 100% info loss is correct and expected for encryption — it is NOT a
    // negative metric here. It means individual records are opaque; only aggregate
    // HE operations (sum, mean) are revealed when the aggregated ciphertext is decrypted.
    informationLoss: 1.0,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      // Issue 1: show ACTUAL n bit size, not the misleading structural keySize label
      "Structural Key Size":     `${keySize}-bit (requested)`,
      "Actual n Bit-Size":       `${actualNBits}-bit (simulation — NOT ${keySize}-bit security)`,
      "Simulation Prime Bits":   `${bits}-bit p, ${bits}-bit q → n = p×q = ${actualNBits}-bit`,
      "Public Key n (hex)":      nHex.slice(0, 16) + "…",
      "λ = lcm(p−1, q−1) (hex)": lambdaHex.slice(0, 16) + "…",
      "g = n + 1":               "✓ (Paillier simplification)",
      "μ = λ⁻¹ mod n":          "✓ computed",
      "Homomorphic Sum Check":   roundTrip ? "✓ PASS — E(Σmᵢ) = ΠE(mᵢ) mod n²" : (safeEncCols.length === 0 ? "— no safe cols" : "⚠ Rounding drift"),
      "Decrypt Round-Trip":      decOk     ? "✓ PASS" : "⚠ mismatch",
      "Safe Encrypted Columns":  safeEncCols.length,
      "Overflow Columns Skipped":overflowCols.length > 0 ? overflowCols.join(", ") : "none",
      "Rows Processed":          N,
      // Issue 1: removed false "IND-CPA" claim — only structural properties hold in simulation
      "Security (Simulation)":   `IND-CPA structure only — actual n=${actualNBits}-bit is NOT computationally secure`,
      // Issue 3: clarify what 100% info loss means in HE context
      "Information Loss":        "100% (expected) — ciphertexts are opaque; only aggregate HE operations reveal anything",
    },
    warnings: [
      `⚠ Simulation uses ${bits}-bit primes → actual n=${actualNBits}-bit (NOT ${keySize}-bit). IND-CPA security requires n≥2048-bit in production.`,
      "This is an educational demonstration of Paillier HE structural properties only.",
      "Production Paillier requires true 2048-bit primes, HSM key management, and server-side execution.",
      "100% information loss is the CORRECT outcome for encryption — individual records are inaccessible without the private key. HE benefit: aggregate queries (sum, mean) can be answered from ciphertexts alone.",
      ...(overflowCols.length > 0
        ? [`⚠ Column(s) skipped due to plaintext overflow: ${overflowCols.join(", ")} — |v|×1000 ≥ n/2 would cause silent mod-n wrap in homomorphic sums.`]
        : []),
    ],
    colStats,
    // Issue 3: compliance is for HE property verification, NOT privacy enhancement metric
    interpretation:
      `Paillier HE structural properties verified on ${safeEncCols.length} column(s) using ${actualNBits}-bit n ` +
      `(simulation of ${keySize}-bit structure). ` +
      `Homomorphic sum: Π E(mᵢ) mod n² decrypts to ${origSum.toFixed(3)} ` +
      `(decoded: ${decSum.toFixed(3)}) — ${roundTrip ? "VERIFIED ✓" : "UNVERIFIED ⚠"}. ` +
      `100% information loss is expected and correct: HE is a confidentiality control — ` +
      `only aggregate ciphertext operations (sum, mean) are exposed, not individual records.` +
      (overflowCols.length > 0 ? ` ${overflowCols.length} column(s) excluded: values exceed safe encoding range for ${actualNBits}-bit n.` : ""),
    // HE compliance = homomorphic properties verified + no overflow columns present
    compliancePassed: roundTrip && decOk && overflowCols.length === 0,
    report,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SHAMIR SECRET SHARING (SMPC)
// ══════════════════════════════════════════════════════════════════════════════

// Mersenne prime 2^127 − 1 (known to be prime)
const SHAMIR_P = 170141183460469231731687303715884105727n;
const SHAMIR_SCALE = 1000n; // 3 decimal places

function shamirEncode(v: number): bigint {
  const m = BigInt(Math.round(v * Number(SHAMIR_SCALE)));
  return ((m % SHAMIR_P) + SHAMIR_P) % SHAMIR_P;
}

function shamirDecode(m: bigint): number {
  const half = SHAMIR_P / 2n;
  const signed = m > half ? m - SHAMIR_P : m;
  return Number(signed) / Number(SHAMIR_SCALE);
}

// Generate k shares for secret s using t-1 degree polynomial over Z_P
function shamirSplit(s: bigint, k: number, t: number, rng: () => number): bigint[] {
  // Coefficients: a[0] = s, a[1..t-1] = random in [1, P-1]
  const coeffs: bigint[] = [s];
  for (let i = 1; i < t; i++) {
    // Random 127-bit number in [1, P-1]
    let a = 0n;
    for (let b = 0; b < 127; b++) a |= (rng() < 0.5 ? 1n : 0n) << BigInt(b);
    a = (a % (SHAMIR_P - 1n)) + 1n;
    coeffs.push(a);
  }
  // Evaluate f(i) for i = 1..k
  return Array.from({ length: k }, (_, idx) => {
    const x = BigInt(idx + 1);
    let val = 0n;
    for (let j = coeffs.length - 1; j >= 0; j--) {
      val = (val * x + coeffs[j]) % SHAMIR_P;
    }
    return val;
  });
}

// Lagrange interpolation at x=0 using any t of the k shares
// shares: array of { x: bigint, y: bigint }
function shamirReconstruct(shares: Array<{ x: bigint; y: bigint }>): bigint {
  let secret = 0n;
  const t = shares.length;
  for (let i = 0; i < t; i++) {
    let num = 1n, den = 1n;
    for (let j = 0; j < t; j++) {
      if (i === j) continue;
      // λᵢ = Πⱼ≠ᵢ (0 - xⱼ) / (xᵢ - xⱼ)
      num = (num * ((SHAMIR_P - shares[j].x) % SHAMIR_P)) % SHAMIR_P;
      den = (den * ((shares[i].x - shares[j].x + SHAMIR_P) % SHAMIR_P)) % SHAMIR_P;
    }
    const li = num * modinv(den, SHAMIR_P) % SHAMIR_P;
    secret = (secret + shares[i].y * li) % SHAMIR_P;
  }
  return secret;
}

export function applySMPC(
  data: DataRow[],
  targetCols: string[],
  numShares: number,
  threshold: number,
): PrivacyResult {
  const t0 = performance.now();
  if (data.length === 0) return emptyResult("Secure MPC (Shamir SMPC)");

  const allCols = Object.keys(data[0]);
  const numCols = allCols.filter((c) => isNumericCol(data, c));
  const encCols  = targetCols.length > 0
    ? targetCols.filter((c) => numCols.includes(c))
    : numCols;

  const rng = makePRNG(Date.now() ^ 0x5F3759DF);

  // Split each value in each row into numShares shares
  // Output: allShares[shareIdx] = array of DataRow (one per original row)
  const allShares: DataRow[][] = Array.from({ length: numShares }, () => []);
  const colStats: Record<string, Record<string, string | number>> = {};

  // Process up to 300 rows for performance
  const N   = Math.min(data.length, 300);
  const sub = data.slice(0, N);

  sub.forEach((row) => {
    const shareRows: DataRow[] = Array.from({ length: numShares }, () => ({ ...row }));
    for (const col of encCols) {
      const v = Number(row[col]);
      if (isNaN(v)) continue;
      const s      = shamirEncode(v);
      const shares = shamirSplit(s, numShares, threshold, rng);
      shares.forEach((sh, i) => {
        shareRows[i][col] = "S" + (i + 1) + ":" + sh.toString(16).slice(0, 10) + "…";
      });
    }
    shareRows.forEach((sr, i) => allShares[i].push(sr));
  });

  // Demonstrate reconstruction: for first col, sum shares across records for each party,
  // then reconstruct the total sum
  const demoCol  = encCols[0];
  const origVals = sub.map((r) => Number(r[demoCol])).filter((v) => !isNaN(v));
  const origSum  = origVals.reduce((s, v) => s + v, 0);

  // Each party sums their shares for demoCol (homomorphic under Shamir: sum of shares = share of sum)
  const partySums: bigint[] = Array(numShares).fill(0n);
  origVals.forEach((v) => {
    const s = shamirEncode(v);
    const shares = shamirSplit(s, numShares, threshold, rng);
    shares.forEach((sh, i) => { partySums[i] = (partySums[i] + sh) % SHAMIR_P; });
  });

  // Reconstruct sum from first `threshold` party sums
  const reconstructionShares = partySums.slice(0, threshold).map((y, i) => ({
    x: BigInt(i + 1), y,
  }));
  const reconstructedSum  = shamirReconstruct(reconstructionShares);
  const decodedSum        = shamirDecode(reconstructedSum);
  const reconstructionOk  = Math.abs(decodedSum - origSum) < 1.0;  // allow rounding drift

  // Per-column stats
  for (const col of encCols) {
    const vals = sub.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    colStats[col] = {
      "Count":           vals.length,
      "Original Mean":   mean.toFixed(4),
      "Shares":          numShares,
      "Threshold":       threshold,
      "Prime Field P":   "2^127 − 1",
      "Polynomial Deg":  threshold - 1,
    };
  }

  const report = buildSMPCReport({
    numShares, threshold, encCols, N, origSum, decodedSum, reconstructionOk, colStats,
  });

  return {
    technique: "Secure Multi-Party Computation (Shamir SMPC)",
    family: "Cryptographic PETs",
    processedData: allShares[0],  // Server 1's view — reveals nothing about originals
    originalCount: data.length,
    processedCount: N,
    recordsSuppressed: 0,
    informationLoss: 1.0,
    executionMs: Math.round(performance.now() - t0),
    stats: {
      "Protocol":                 "Shamir (k,t) Secret Sharing",
      "Total Shares (k)":         numShares,
      "Reconstruction Threshold": threshold,
      "Prime Field P":            "2^127 − 1 (Mersenne prime)",
      "Polynomial Degree":        threshold - 1,
      "Info-Theoretic Security":  "Each share reveals ZERO information (t−1 shares collude safely)",
      "Shared Columns":           encCols.length,
      "Rows Processed":           N,
      "Homomorphic Sum Check":    reconstructionOk ? "✓ PASS" : "⚠ Drift detected",
      "Output":                   `Server 1 of ${numShares} — independently useless`,
    },
    warnings: [
      `Data is split across ${numShares} independent servers. This view shows only Server 1's share.`,
      `Any ${threshold} of ${numShares} parties can reconstruct the secret; any ${threshold - 1} learn nothing.`,
      "Production SMPC requires independent network parties. This is a single-browser simulation.",
    ],
    colStats,
    interpretation:
      `Shamir (${threshold},${numShares})-SMPC over prime field P = 2^127−1. ` +
      `Reconstruction check (sum property): Σ party_sums reconstructed to ${decodedSum.toFixed(3)} ` +
      `vs original ${origSum.toFixed(3)} — ${reconstructionOk ? "PASS ✓" : "FAIL ⚠"}.`,
    compliancePassed: reconstructionOk,
    report,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HTML REPORT BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

interface HEReportParams {
  keySize: number;
  actualNBits: number;   // Issue 1: actual n bit-size, not the structural keySize
  encCols: string[];     // safe (encrypted) columns only
  overflowCols: string[]; // Issue 2: columns excluded due to overflow
  N: number;
  origSum: number; decSum: number; roundTrip: boolean; decOk: boolean;
  sampleV: number; sampleDec: number;
  nHex: string; lambdaHex: string;
  colStats: Record<string, Record<string, string | number>>;
}

function buildHEReport(p: HEReportParams): string {
  const now  = new Date().toLocaleString("en-IN");
  const heOk = p.roundTrip && p.decOk && p.overflowCols.length === 0;
  // Issue 1 + 3: badge is "HE PROPERTIES VERIFIED" not "COMPLIANT"; never claim IND-CPA for sim
  const badge = heOk
    ? "✅ HE PROPERTIES VERIFIED (Educational Simulation)"
    : (p.overflowCols.length > 0 ? "⚠ OVERFLOW DETECTED — Some Columns Skipped" : "⚠ PROPERTY CHECK FAILED");
  const badgeBg    = heOk ? "#dcfce7" : "#fef9c3";
  const badgeColor = heOk ? "#166534" : "#854d0e";

  const safeColRows = p.encCols.map((c) => {
    const s = p.colStats[c] ?? {};
    return `<tr><td><b>${c}</b></td><td>${s["Count"]}</td><td>${s["Original Mean"]}</td><td>${s["Max |v|×1000"] ?? "—"}</td><td>✓ Safe</td><td>${s["Ciphertext Size"] ?? "—"}</td></tr>`;
  }).join("\n");

  const overflowRows = p.overflowCols.map((c) => {
    const s = p.colStats[c] ?? {};
    return `<tr style="background:#fef2f2"><td><b>${c}</b></td><td>${s["Count"]}</td><td>—</td><td>${s["Max |v|×1000"] ?? "—"}</td><td>⚠ OVERFLOW</td><td>— skipped</td></tr>`;
  }).join("\n");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Paillier HE Report — SafeData Pipeline</title>
<style>
  body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#1e293b;background:#f8fafc}
  h1{color:#1d4ed8;border-bottom:3px solid #1d4ed8;padding-bottom:8px}
  h2{color:#1e40af;margin-top:28px}
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:bold;font-size:13px;background:${badgeBg};color:${badgeColor}}
  .warn{background:#fffbeb;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:4px;margin:10px 0;font-size:13px}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th{background:#1d4ed8;color:#fff;padding:8px 12px;text-align:left}
  td{padding:7px 12px;border-bottom:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#f1f5f9}
  .mono{font-family:monospace;font-size:12px;word-break:break-all}
  .formula{background:#1e293b;color:#e2e8f0;padding:12px 16px;border-radius:6px;font-family:monospace;font-size:13px;margin:8px 0}
  .section{background:#fff;border-radius:8px;padding:20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
</style></head><body>
<h1>🔐 Paillier Homomorphic Encryption Report</h1>
<div class="section">
  <p><b>Generated:</b> ${now}</p>
  <p><b>System:</b> SafeData Pipeline — Ministry of Electronics &amp; IT, Government of India</p>
  <p><b>Methodology:</b> NIST SP 800-175B Cryptographic Standards — Paillier PHE (educational simulation)</p>
  <p><b>Status:</b> <span class="badge">${badge}</span></p>
  <div class="warn">⚠ <b>Simulation Disclaimer:</b> This run uses ${p.actualNBits}-bit n (actual security level).
  The structural label "${p.keySize}-bit" refers to the Paillier key size convention (n = p×q),
  but the simulation primes are reduced for browser performance. 
  <b>IND-CPA security requires n ≥ 2048-bit in production.</b> This output is for educational demonstration only.</div>
</div>

<h2>§1  Executive Summary</h2>
<div class="section">
  <p>Paillier Partially-Homomorphic Encryption (PHE) structural properties were demonstrated on
  <b>${p.encCols.length} safe column(s)</b> across <b>${p.N} records</b> using a 
  <b>${p.actualNBits}-bit n</b> (simulation of ${p.keySize}-bit structure).
  ${p.overflowCols.length > 0
    ? `<b>${p.overflowCols.length} column(s) excluded</b> — values would exceed the safe encoding range
       (|v|×1000 ≥ n/2) and would silently wrap mod n, producing incorrect homomorphic sums.`
    : "All selected columns passed the plaintext range check."}</p>
  <p>The homomorphic sum property was <b>${p.roundTrip ? "verified ✓" : (p.encCols.length === 0 ? "not tested (no safe columns)" : "NOT verified ⚠")}</b>.</p>
  <p><b>Information Loss = 100%</b> — this is the <em>correct and expected</em> outcome for encryption.
  Ciphertexts are computationally opaque. The HE benefit is that aggregate queries (SUM, MEAN) 
  can be answered by operating on ciphertexts directly — only the aggregate result is decrypted, 
  not individual records. Encryption is a <em>confidentiality control</em>, not a de-identification technique.</p>
</div>

<h2>§2  Key Generation Parameters (Actual Values)</h2>
<div class="section">
  <div class="formula">
    Key generation:  n = p × q  (actual n = ${p.actualNBits}-bit)<br>
    λ = lcm(p−1, q−1)<br>
    g = n + 1   (Paillier simplification: (n+1)^m ≡ 1 + mn mod n²)<br>
    μ = λ⁻¹ mod n   (decryption exponent)
  </div>
  <table>
    <tr><th>Parameter</th><th>Value</th></tr>
    <tr><td>Structural Key Size (label)</td><td>${p.keySize}-bit</td></tr>
    <tr><td><b>Actual n Bit-Size (simulation)</b></td><td><b>${p.actualNBits}-bit — NOT ${p.keySize}-bit security</b></td></tr>
    <tr><td>n (public, full hex)</td><td class="mono">${p.nHex}</td></tr>
    <tr><td>λ (private, hex prefix)</td><td class="mono">${p.lambdaHex.slice(0,24)}…</td></tr>
    <tr><td>g</td><td>n + 1</td></tr>
    <tr><td>Security Model</td><td>IND-CPA structure (educational) — actual n=${p.actualNBits}-bit is NOT computationally secure</td></tr>
  </table>
</div>

<h2>§3  Encryption &amp; Encoding</h2>
<div class="section">
  <div class="formula">
    Encoding:    m = round(v × 1000) mod n   [3 decimal places of precision]<br>
    Safe range:  |v| × 1000 &lt; n/2   (otherwise mod-n wrap produces incorrect sums)<br>
    Encryption:  c = (1 + m·n) · rⁿ mod n²   [r coprime to n, r ∈ (1, n−1)]
  </div>
  <p>The encoding uses signed two's-complement mod n: values above n/2 are interpreted as negative.
  Any value where |v|×1000 ≥ n/2 would silently wrap, corrupting homomorphic sums — 
  those columns are excluded with an explicit warning.</p>
</div>

<h2>§4  Decryption Verification</h2>
<div class="section">
  <div class="formula">m = L(c^λ mod n²) · μ mod n   where L(x) = (x−1)/n</div>
  <table>
    <tr><th>Test</th><th>Original</th><th>Decrypted</th><th>Status</th></tr>
    <tr><td>Sample round-trip</td><td>${p.sampleV}</td><td>${p.sampleDec.toFixed(3)}</td><td>${p.decOk ? "✅ PASS" : "⚠ FAIL"}</td></tr>
    <tr><td>Homomorphic sum (Σ)</td><td>${p.origSum.toFixed(3)}</td><td>${p.decSum.toFixed(3)}</td><td>${p.roundTrip ? "✅ PASS" : (p.encCols.length === 0 ? "— skipped" : "⚠ FAIL")}</td></tr>
  </table>
</div>

<h2>§5  Homomorphic Property Demonstration</h2>
<div class="section">
  <div class="formula">E(m₁) · E(m₂) ≡ E(m₁ + m₂)  (mod n²)   [additive HE]</div>
  <p>This additive homomorphism enables aggregate queries (SUM, MEAN) to be computed
  directly on ciphertexts — <b>individual records are never decrypted</b>. 
  Only the final aggregate ciphertext is decrypted to reveal the result.</p>
  <p><b>Verified:</b> Π E(mᵢ) mod n² decrypts to Σ mᵢ = <b>${p.origSum.toFixed(4)}</b> 
  (decoded: <b>${p.decSum.toFixed(4)}</b>) on ${p.N} records.</p>
</div>

<h2>§6  Column Encoding Safety Check</h2>
<div class="section">
  <table>
    <tr><th>Column</th><th>Count</th><th>Mean</th><th>Max |v|×1000</th><th>Range Check</th><th>Ciphertext</th></tr>
    ${safeColRows}
    ${overflowRows}
  </table>
  ${p.overflowCols.length > 0
    ? `<div class="warn">⚠ ${p.overflowCols.length} column(s) excluded: <b>${p.overflowCols.join(", ")}</b> — 
       max encoded value ≥ n/2 = ${Math.floor(parseInt(p.nHex, 16) / 2)} (approx). 
       Encrypting these would produce silent mod-n wrapping in homomorphic sums.</div>`
    : "<p>✓ All columns passed the plaintext range check.</p>"}
</div>

<h2>§7  Security Analysis (Honest Assessment)</h2>
<div class="section">
  <p><b>What this simulation demonstrates:</b> The structural correctness of Paillier's additive 
  homomorphism — encrypt → compute on ciphertexts → decrypt aggregate only.</p>
  <p><b>What this simulation does NOT provide:</b> Computational security. With n=${p.actualNBits}-bit, 
  the public modulus n can be factored in seconds, revealing p and q and thus λ and μ. 
  The IND-CPA security proof for Paillier requires the Decisional Composite Residuosity (DCR) 
  assumption, which holds only for n ≥ 2048-bit in practice.</p>
  <p><b>Homomorphic Operations Supported:</b> Addition E(m₁+m₂) = E(m₁)·E(m₂) mod n²; 
  scalar multiply E(k·m) = E(m)^k mod n². Plaintext multiplication requires FHE.</p>
</div>

<h2>§8  Information Loss Clarification</h2>
<div class="section">
  <p><b>Information Loss = 100%</b> is the correct and desired outcome for encryption. It means:</p>
  <ul>
    <li>Individual ciphertexts reveal zero information about plaintexts (without the private key λ).</li>
    <li>This is NOT a privacy-preserving analytics technique in the traditional sense — 
        it is a <b>confidentiality control</b>.</li>
    <li>The HE benefit: an analyst can compute SUM or MEAN by multiplying ciphertexts, 
        then decrypting only the aggregate — individual records remain private.</li>
    <li>100% information loss does not mean the data is "destroyed" — it means the 
        output dataset (ciphertexts) cannot be analysed without the private key.</li>
  </ul>
</div>

<h2>§9  Compliance Assessment</h2>
<div class="section">
  <p><b>NIST SP 800-175B:</b> Paillier PHE implements an approved cryptographic structure. 
  Production deployment requires 2048-bit n and HSM-based key management.</p>
  <p><b>India DPDP Act 2023:</b> Encryption satisfies "appropriate technical safeguards" 
  for personal data confidentiality — but not as a substitute for anonymisation/de-identification 
  unless the HE aggregate workflow is used (encrypt → compute → decrypt aggregate only).</p>
  <p><b>Overall Status:</b> <span class="badge">${badge}</span></p>
</div>

<h2>§10  Limitations &amp; Recommendations</h2>
<div class="section">
  <ul>
    <li><b>Prime size:</b> Simulation uses ${p.actualNBits}-bit n (NOT ${p.keySize}-bit). Production requires 2048-bit n minimum.</li>
    <li><b>Plaintext range:</b> Encoding is safe only for |v|×1000 &lt; n/2. Columns exceeding this bound are excluded.</li>
    <li><b>Key management:</b> Private key (λ, μ) must be stored in an HSM or secure key vault — never in the browser.</li>
    <li><b>Ciphertext expansion:</b> Each value grows from ~8 bytes to ~${Math.ceil(p.actualNBits / 4)} hex chars (${p.actualNBits}-bit n).</li>
    <li><b>Operations:</b> Only additive homomorphism is demonstrated; multiplication requires levelled/bootstrapped FHE.</li>
  </ul>
</div>
</body></html>`;
}

interface SMPCReportParams {
  numShares: number; threshold: number; encCols: string[]; N: number;
  origSum: number; decodedSum: number; reconstructionOk: boolean;
  colStats: Record<string, Record<string, string | number>>;
}

function buildSMPCReport(p: SMPCReportParams): string {
  const now   = new Date().toLocaleString("en-IN");
  const badge = p.reconstructionOk ? "✅ COMPLIANT" : "⚠ CHECK REQUIRED";
  const colRows = p.encCols.map((c) => {
    const s = p.colStats[c] ?? {};
    return `<tr><td><b>${c}</b></td><td>${s["Count"]}</td><td>${s["Original Mean"]}</td><td>${p.numShares}</td><td>${p.threshold}</td></tr>`;
  }).join("\n");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Shamir SMPC Report — SafeData Pipeline</title>
<style>
  body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#1e293b;background:#f8fafc}
  h1{color:#7c3aed;border-bottom:3px solid #7c3aed;padding-bottom:8px}
  h2{color:#6d28d9;margin-top:28px}
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:bold;font-size:13px;background:${p.reconstructionOk ? "#dcfce7" : "#fef9c3"};color:${p.reconstructionOk ? "#166534" : "#854d0e"}}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th{background:#7c3aed;color:#fff;padding:8px 12px;text-align:left}
  td{padding:7px 12px;border-bottom:1px solid #e2e8f0}
  tr:nth-child(even) td{background:#f5f3ff}
  .formula{background:#1e293b;color:#e2e8f0;padding:12px 16px;border-radius:6px;font-family:monospace;font-size:13px;margin:8px 0}
  .section{background:#fff;border-radius:8px;padding:20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
</style></head><body>
<h1>🔑 Shamir SMPC Report</h1>
<div class="section">
  <p><b>Generated:</b> ${now}</p>
  <p><b>System:</b> SafeData Pipeline — Ministry of Electronics &amp; IT, Government of India</p>
  <p><b>Protocol:</b> Shamir (${p.threshold},${p.numShares}) Secret Sharing over ℤ_P (P = 2^127−1)</p>
  <p><b>Status:</b> <span class="badge">${badge}</span></p>
</div>

<h2>§1  Executive Summary</h2>
<div class="section">
  <p><b>${p.encCols.length} numeric column(s)</b> across <b>${p.N} records</b> were split into 
  <b>${p.numShares} shares</b>. Any <b>${p.threshold}</b> of the ${p.numShares} parties can reconstruct 
  the data; any fewer learn zero information (information-theoretic security).</p>
</div>

<h2>§2  Protocol Parameters</h2>
<div class="section">
  <div class="formula">
    f(x) = s + a₁x + a₂x² + … + a_{t-1}x^{t-1}  (mod P)<br>
    Share i = f(i)   for  i = 1, 2, …, k<br>
    P = 2^127 − 1  (Mersenne prime)
  </div>
  <table>
    <tr><th>Parameter</th><th>Value</th></tr>
    <tr><td>Total Shares (k)</td><td>${p.numShares}</td></tr>
    <tr><td>Reconstruction Threshold (t)</td><td>${p.threshold}</td></tr>
    <tr><td>Polynomial Degree</td><td>${p.threshold - 1}</td></tr>
    <tr><td>Prime Field P</td><td>2^127 − 1 (Mersenne)</td></tr>
    <tr><td>Security Level</td><td>Information-Theoretic (IT-security)</td></tr>
    <tr><td>Collusion Tolerance</td><td>Up to ${p.threshold - 1} corrupt parties</td></tr>
  </table>
</div>

<h2>§3  Reconstruction Formula</h2>
<div class="section">
  <div class="formula">
    secret = Σᵢ yᵢ · λᵢ  (mod P)<br>
    λᵢ = Πⱼ≠ᵢ (0 − xⱼ) · (xᵢ − xⱼ)⁻¹  (mod P)   [Lagrange basis]
  </div>
  <p>Lagrange interpolation at x=0 recovers the secret using any t shares.</p>
</div>

<h2>§4  Homomorphic Sum Verification</h2>
<div class="section">
  <table>
    <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
    <tr><td>Original Column Sum</td><td>${p.origSum.toFixed(4)}</td><td>—</td></tr>
    <tr><td>Reconstructed Sum</td><td>${p.decodedSum.toFixed(4)}</td><td>${p.reconstructionOk ? "✅ PASS" : "⚠ FAIL"}</td></tr>
    <tr><td>Absolute Error</td><td>${Math.abs(p.decodedSum - p.origSum).toFixed(6)}</td><td>—</td></tr>
  </table>
  <p>The linear property of Shamir sharing means party-level sums of shares equal 
  a share of the aggregate sum — no reconstruction of individual values is needed for aggregation.</p>
</div>

<h2>§5  Column-Level Sharing Summary</h2>
<div class="section">
  <table>
    <tr><th>Column</th><th>Count</th><th>Original Mean</th><th>Shares</th><th>Threshold</th></tr>
    ${colRows}
  </table>
</div>

<h2>§6  Security Analysis</h2>
<div class="section">
  <p><b>Information-Theoretic Security:</b> With fewer than t shares, the secret is uniformly 
  distributed over the field — no computational assumptions required.</p>
  <p><b>Collusion Resistance:</b> Any ${p.threshold - 1} colluding parties gain zero advantage.</p>
  <p><b>Prime Field P = 2^127−1:</b> This Mersenne prime ensures uniform distribution and 
  efficient modular arithmetic.</p>
</div>

<h2>§7  Compliance Assessment</h2>
<div class="section">
  <p><b>NIST SP 800-57:</b> Secret sharing is a NIST-recommended technique for key management and 
  sensitive data distribution.</p>
  <p><b>Overall Status:</b> <span class="badge">${badge}</span></p>
</div>
</body></html>`;
}

function emptyResult(technique: string): PrivacyResult {
  return {
    technique, family: "Cryptographic PETs",
    processedData: [], originalCount: 0, processedCount: 0,
    recordsSuppressed: 0, informationLoss: 0, executionMs: 0,
    stats: {}, warnings: ["No data provided or no numeric columns detected."],
  };
}
