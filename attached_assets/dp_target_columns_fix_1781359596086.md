# Target Columns Panel — Fix for Differential Privacy Tab
> For Replit Agent: The "Target Columns" left sidebar panel is now REDUNDANT and CONFLICTING with the new Column Configuration panel. Here is exactly what to do.

---

## THE PROBLEM

Two panels now control column selection for DP:

| Panel | Location | Shows | Status |
|-------|----------|-------|--------|
| **Target Columns** | Left sidebar | Round_Centre_Code, FSU_Serial_No, Round, Sch_No, Sample (WRONG — these are categorical/ID cols) | ❌ BROKEN / MISLEADING |
| **NUMERIC COLS (PERTURBABLE)** | Middle panel | HH_Size, No_NREG_Card, MLT, MLT_SR, Multiplier_comb (CORRECT — auto-detected numerics) | ✅ CORRECT |

The old "Target Columns" panel is:
1. Showing the wrong columns (IDs and categoricals, not the numerics DP actually perturbs)
2. Duplicating what the new Column Configuration panel does
3. Confusing to the user — checking a box there does nothing visible

---

## THE FIX — Two Options

### Option A: REMOVE "Target Columns" from DP tab entirely (RECOMMENDED)

The DP tab should NOT show the generic "Target Columns" panel.
Column selection is fully handled by the new **NUMERIC COLS (PERTURBABLE)** and **CATEGORICAL COLS** sections inside the mechanism panel.

```
LEFT SIDEBAR for DP tab:
  ┌─────────────────────┐
  │ Dataset             │  ← keep
  │ 100 rows | 43 cols  │
  └─────────────────────┘
  
  ❌ REMOVE "Target Columns" panel entirely from DP tab
  
  ┌─────────────────────┐
  │ Recent Operations   │  ← keep
  └─────────────────────┘
```

The column checkboxes now live inside the mechanism panel (middle section), where they already correctly show NUMERIC COLS (PERTURBABLE) with sensitivity values.

---

### Option B: REPURPOSE "Target Columns" as a COLUMN OVERVIEW (if you want to keep the left panel)

If you want to keep something in that left sidebar slot, replace "Target Columns" with a **read-only Column Type Summary**:

```
┌─────────────────────────────────┐
│  COLUMN OVERVIEW                │
│                                 │
│  Total Columns: 43              │
│  ● Numeric (DP perturbable): 5  │
│  ● Categorical (Exp. Mech.): 38 │
│  ● Direct-ID (skip): 0          │
│                                 │
│  → Column selection is managed  │
│    in the mechanism panel →     │
└─────────────────────────────────┘
```

This is purely informational — no checkboxes, no duplicate controls.

---

## WHAT THE NUMERIC COLS PANEL (MIDDLE) SHOULD DO

The **NUMERIC COLS (PERTURBABLE)** section is the correct place for column selection. Ensure it has:

1. **Checkbox per column** — to include/exclude from DP perturbation
2. **Sensitivity (Δf)** shown — auto-computed, editable on click
3. **Colour dot** — 🔴 noise > 10× mean, 🟡 noise 1-10× mean, 🟢 noise < mean
4. **MED/HIGH/LOW badge** — noise impact level
5. **"Select All / Deselect All"** button

```
NUMERIC COLS (PERTURBABLE)   5 cols         [Select All]

☑ 🟡 HH_Size          Δf = 11.000    MED
☑ 🟡 No_NREG_Card     Δf = 5.000     MED
☑ 🟡 MLT              Δf = 4,42,434  MED
☑ 🟡 MLT_SR           Δf = 7,82,511  MED
☑ 🟡 Multiplier_comb  Δf = 1,789     MED

🔴 noise > 10× mean   🟡 1–10×   🟢 < 1×
```

---

## SUMMARY FOR REPLIT AGENT

- **Delete** the "Target Columns" card from the DP tab's left sidebar
- The SDC tab can KEEP its own Target Columns / QI panel (that one works correctly)
- Each tab should have its own sidebar configuration — do NOT share the generic "Target Columns" component across SDC and DP tabs
- The DP tab's column selection lives in the **middle panel → NUMERIC COLS (PERTURBABLE)** and **CATEGORICAL COLS** sections
- Make sure the checkboxes in NUMERIC COLS are functional and actually control which columns get perturbed when Apply Technique is clicked
