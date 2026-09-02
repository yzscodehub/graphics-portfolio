# Rendering asset ledger

This directory is intentionally small and auditable. The current Preview still ships the self-authored Research Courtyard placeholder plus the Calibration Rig and Cornell scene contracts in `manifest.json`. Poly Haven bytes remain outside `public/` until human review, deterministic conversion, budget checks, and integration receipts all pass.

`sources.lock.json` is the v3 source-set lock for six meshes, four material sets, and one 1K Courtyard HDRI. It records official Poly Haven URLs, authors, CC0 licensing, API metadata, file sizes, MD5 values, exact selections, and a stable `sourceSetSha256`. Mutable machine state such as `downloaded` is deliberately not part of the lock.

The current tracked state is `sources-reviewed`, bound to the human evidence descriptor for `20260901-research-courtyard-v3b`. It is not `integrated`: the public Preview must continue to identify and render the procedural placeholder until the processed scene and runtime manifests pass their separate gates.

The source state is fail-closed:

- `metadata-locked`: official metadata is fixed, but every source SHA-256 remains null.
- `sources-reviewed`: an explicit human evidence descriptor and all 49 reviewed SHA-256 values are present. Preview still uses the placeholder.
- `integrated`: the scene recipe, fixed toolchain, runtime manifest, processed files, and public budgets are all hash-bound.

## Human review workflow

1. `pnpm run assets:download-candidates -- --review-id <id>` downloads into a sibling staging directory, verifies bytes and MD5, computes SHA-256, and atomically publishes an ignored quarantine receipt. It never edits the formal lock.
2. Existing reviewed bytes can instead be migrated without network access with `pnpm run assets:rebind-review -- --legacy-review <v1-review.json> --review-id <new-id>`.
3. `pnpm run assets:review-packet -- --review .cache/rendering-quarantine/<id>/review.json` fully decodes images, validates glTF references, renders six real model views and one HDRI view in local Chromium/Three.js, and writes an ignored packet containing `README.md`, `machine.json`, and hashed visuals.
4. A human must inspect that packet and explicitly confirm the exact review id. Until then, do not create evidence, approve, or materialize anything.
5. After confirmation only, `pnpm run assets:create-review-evidence -- --review-id <id> --reviewer <public-reviewer> --reviewed-at <ISO-8601>` writes the tracked `public/assets/rendering/reviews/<id>.json` descriptor bound to the packet SHA-256. It still does not promote the lock.
6. `pnpm run assets:approve-review -- --review <review.json> --evidence <public-review.json>` writes an ignored reviewed-lock proposal. Inspect it first; add `--apply` only for the separately authorized formal promotion.
7. After promotion, `pnpm run assets:materialize-reviewed` copies the exact approved quarantine bytes into ignored `.cache/rendering-sources/` through a complete staging-and-rename transaction.

`pnpm run assets:fetch` is a separate network reproducibility check. It downloads the reviewed URLs into an atomic cache, but it is not the approval materialization path and cannot replace the exact bytes a human inspected.

## Verification and conversion tools

- `pnpm run assets:verify` validates licenses, source-set state, evidence receipts, paths, hashes, output budgets, and the current placeholder contract.
- `pnpm run assets:refresh-lock` refreshes only a v3 `metadata-locked` source set from official APIs and atomically replaces the lock. Reviewed or integrated locks are immutable.
- `pnpm run assets:preflight:reviewed` combines reviewed-source checks with the installed local toolchain receipt.
- `pnpm run assets:rebuild` currently regenerates only the deterministic self-authored placeholder. It does not claim to compile the final courtyard.

`scripts/assets/toolchain.lock.json` binds glTF Transform CLI 4.4.2, `gltfpack` 1.1, KTX-Software `toktx` 4.4.2, Web `libktx` artifacts, and Sharp 0.35.4 to official provenance, byte counts, and SHA-256 values. Node 24.x and pnpm 11.x are required.

`pnpm run toolchain:verify` is the CI-safe schema check and never downloads tools. `pnpm run toolchain:install` is an explicit local operation that installs into ignored `.tools/rendering/` via staging, consumes the verified npm tarball, checks native archives and versions, and writes an absolute-path local receipt. `pnpm run toolchain:verify:local` rechecks runtime versions, command/executable/archive hashes, dependency-lock binding, Sharp integrity, path containment, and symlink rejection. The tool directory must not be added to system `PATH`.
