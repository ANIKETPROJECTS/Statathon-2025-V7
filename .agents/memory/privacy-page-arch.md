---
name: Privacy Enhancement Page Architecture
description: All 15 privacy techniques are computed client-side; lib files location
---

## Rule
- All privacy computation is client-side in client/src/lib/privacy/
- sdc.ts: Mondrian k-anon, entropy L-div, T-close EMD, rank swap, MDAV, PRAM, top/bottom coding
- dp.ts: Laplace, Gaussian, Exponential mechanisms
- synthetic.ts: Statistical SDG, DP-SDG
- crypto.ts: Paillier HE simulation, SMPC secret sharing
- federated.ts: FedAvg, DP-FedAvg
- attackMatrix.ts: 15×10 mitigation matrix

**Why:** Server-side computation was too slow for interactive use; all algorithms are deterministic enough for client-side execution.
