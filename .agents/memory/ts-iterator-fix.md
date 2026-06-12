---
name: TypeScript Iterator Spread Fix
description: tsconfig lacks downlevelIteration; spread on Map/Set fails at compile time
---

## Rule
Never use `[...map.keys()]`, `[...set.values()]`, or spread on any Map/Set iterator.
Always use `Array.from(map.keys())`, `Array.from(set.values())`, etc.

**Why:** The project tsconfig does not include `"downlevelIteration": true`, so the TypeScript compiler rejects spread on MapIterator/SetIterator with TS2802.

**How to apply:** Any time you touch files that group or aggregate data using Map/Set, use Array.from() throughout.
