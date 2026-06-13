---
name: Federated Learning Module Spec
description: FedAvg + DP-FedAvg Tabular Autoencoder implementation in federated.ts
---

## Architecture (Tabular Autoencoder)
- Spec-labeled dims: Encoder d→128→64→32, Decoder 32→64→128→d
- Actual simulation dims: d→48→24→12→24→48→d (for browser performance)
- Activation: ReLU on all hidden layers; linear on output
- Input preprocessing: z-score normalization for numeric, one-hot for categorical

## Critical Bug Fixes (applied)
- **Gradient scaling + loss scale (FINAL)**: Reported loss uses per-element MSE Σ(out-x)²/(2Nd) — preserves ~0.067 scale, comparable across all runs and datasets regardless of d. Optimizer gradient uses (out-x)/N (NOT divided by d) — decoupled from reported loss so gradients have proper magnitude for convergence with large d. NEVER couple both to the same divisor: /Nd makes gradients too small; /N makes loss scale 167× too large.
- **Weight decay**: Added L2 weight decay λ=0.001 to sgdStep (weights only, not biases). Prevents weight norm from growing monotonically during FedAvg aggregation (client drift). Stable norm bound ≈ ‖grad‖/(N·λ).
- **Constant column skip**: buildSchema now checks rawStd===0 BEFORE applying the ||1 fallback, and skips σ=0 columns entirely. The ||1 fallback previously let blank/all-zero columns through, feeding undefined z-scores to the autoencoder.
- **compliancePassed**: Now requires dp !== null in addition to loss decline. FedAvg without DP does not satisfy DPDP Act §8(4) — tying compliance to convergence alone was incorrect.
- **Convergence badge**: Now requires ≥2% loss improvement (not just any decrease). Badge shows DP status separately: "CONVERGED — DP-FedAvg Active" vs "CONVERGED — No Formal DP Guarantee" vs "NOT CONVERGED".
- **Warning**: When DP disabled, explicit warning "⚠ No formal DP guarantee — enable DP-FedAvg to satisfy DPDP Act 2023 §8(4)" added to warnings array.

## FedAvg (McMahan 2017)
- Each node trains locally for `localEpochs` epochs on its shard
- Global update: W_{t+1} = Σ_k (n_k / n) × W_k (weighted by shard size)
- Partition strategies: IID (random shuffle) and Non-IID (sorted by first column)
- Shard cap: 50 records per node for browser performance

## DP-FedAvg
- Gradient clipping: ΔW̃_k = ΔW_k / max(1, ‖ΔW_k‖_F / C) where C = clipNorm
- Gaussian noise: ΔW̃_k += N(0, σ²C²) after clipping
- σ calibration: binary search to satisfy (ε, δ)-RDP via Rényi divergence accounting
- RDP→DP conversion: ε_DP = min over α of [ε_RDP(α) + log(1/δ)/(α-1)]

## Synthetic Generation
- Decoder takes z~N(0, I₃₂) samples and projects through decoder layers
- Denormalizes numeric columns; picks argmax category for categorical
- synthSize controls number of synthetic records generated

## FLParams Interface (exported from federated.ts)
```
{ nodes, rounds, localEpochs, localLR, batchSize, partition, dp, generateSynthetic, synthSize, seed }
```
- dp: { enabled, epsilon, delta, clipNorm }
- partition: "iid" | "non-iid"

## Privacy Page Integration
- 8 new state vars: fedLocalEpochs, fedLocalLR, fedBatchSize, fedPartition, fedDelta, fedClipNorm, fedSynthSize, fedSeed
- Dataset Summary panel in FL tab left sidebar: shows n, d, shards K, partition label
- Live σ display next to DP delta control
- All 8 vars added to handleRun useCallback dependency array

## Report
- 9-section HTML compliance report
- Includes model architecture, round-by-round loss, DP parameters, RDP accounting detail
