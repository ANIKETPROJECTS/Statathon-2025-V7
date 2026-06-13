---
name: Crypto PETs Module Spec
description: Paillier HE + Shamir SMPC implementation details for crypto.ts
---

## Paillier Homomorphic Encryption (crypto.ts)
- Key gen: choose random safe primes p, q; n=p×q; λ=lcm(p-1,q-1); g=n+1 (simplification); μ=λ⁻¹ mod n
- Encrypt: c = (1+mn) · r^n mod n² (using g=n+1 trick to avoid full g^m mod n²)
- Decrypt: m = L(c^λ mod n²) · μ mod n, where L(x)=(x-1)/n
- Homomorphic add: E(m1)·E(m2) mod n² = E(m1+m2)
- Float encoding: PAILLIER_SCALE=1000n; negative via two's complement in Z_n
- Key size → prime bits: 512→20, 1024→26, 2048→32 (browser speed only — NOT those key sizes)
- Primality: Miller-Rabin with deterministic witnesses [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n]

## Three Correctness Fixes Applied to applyHomomorphicEncryption

### Fix 1 — Honest prime/key size labeling
- `actualNBits = keys.n.toString(2).length` computed after key gen; shown in all stats/report labels
- Stats now shows "Actual n Bit-Size: ${actualNBits}-bit (NOT ${keySize}-bit security)" explicitly
- Removed false "IND-CPA" claim; replaced with "IND-CPA structure (educational) — n=${actualNBits}-bit NOT secure"
- primeBitsFor() comments updated to clarify structural vs actual size
- Report §2 table shows both structural label and actual n; §7 explains why IND-CPA doesn't hold for small n

### Fix 2 — Per-column plaintext overflow guard
- `isSafeToEncode(v, n)` helper: checks `|v|×1000 < n/2` before any column is encrypted
- `overflowCols[]` / `safeEncCols[]` split done up front over the N-row subset
- Only `safeEncCols` are processed in the row-encrypt loop and the homomorphic sum demo
- Overflow columns appear in colStats with "⚠ OVERFLOW — col skipped" status
- Warnings array includes explicit overflow column list when non-empty
- `compliancePassed = roundTrip && decOk && overflowCols.length === 0`
- demoCol uses `safeEncCols[0] ?? encCols[0]` (falls back gracefully when all overflow)

### Fix 3 — 100% info loss + compliance badge
- Badge changed from "COMPLIANT" → "HE PROPERTIES VERIFIED (Educational Simulation)"
- Report §1 explains: "100% info loss is the CORRECT and expected outcome for encryption — it is a confidentiality control, not de-identification"
- Report §8 added "Information Loss Clarification" section explaining HE aggregate workflow
- Interpretation field explicitly explains: encrypt → compute on ciphertexts → decrypt aggregate only

## Removed unused `rn` variable
- Precomputed `rn = modpow(r, keys.n, keys.n2)` was unused; deleted to eliminate TS warning

## Shamir SMPC (crypto.ts) — unchanged
- P = 2^127 - 1 (Mersenne prime for mod arithmetic)
- SHAMIR_SCALE = 1000n for float encoding
- Polynomial: f(x) = s + a₁x + ... + a_{t-1}x^{t-1} mod P (t-1 random coefficients)
- Reconstruction: Lagrange interpolation at x=0 from any t shares
- Homomorphic sum: sum of shares from each party = share of sum

## Signatures
- `applyHomomorphicEncryption(data, targetCols, keySize)` → PrivacyResult
- `applySMPC(data, targetCols, numShares, threshold)` → PrivacyResult
- Both take only numeric targetCols (filtered in privacy-page)

## buildHEReport interface (updated)
- Added `actualNBits: number` and `overflowCols: string[]` params
- Removed `keyBits` (was bits*2 shorthand; replaced by actualNBits)
- 10-section report: §1 exec summary, §2 key params (actual), §3 encoding formula+range check,
  §4 decrypt verify, §5 HE demo, §6 column encoding safety table (safe + overflow rows),
  §7 honest security analysis, §8 info loss clarification, §9 compliance, §10 limitations

## Target Column Handling
- Left panel label: "Columns to Encrypt / Share" (amber border)
- Filtered to numeric non-DIRECT_ID columns only (numericCols)
- showTC_other = family === "crypto" (crypto tab shows target cols; federated does NOT)

## BigInt Requirement
- All BigInt literals (e.g. 0n, 1n, 1000n) require TypeScript target ES2020
- tsconfig.json must have "target": "ES2020"
- Vite/esbuild transpiles BigInt fine regardless; the tsc check was the blocker
