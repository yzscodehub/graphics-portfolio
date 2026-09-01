# Rendering asset ledger

This directory is intentionally small and auditable. The current Preview ships self-authored Research Courtyard placeholder data plus Calibration Rig and Cornell scene contracts recorded in `manifest.json`. The neural record points at the existing reviewed v2 model manifest without copying its held-out data.

`sources.lock.json` records the six planned Poly Haven meshes, four materials, and Courtyard HDRI as a v2 multi-file lock. Model records include the selected 1K glTF plus every referenced bin/texture; texture records select 1K base color, normal, and roughness; the HDRI selects the 1K HDR. They remain CC0 metadata, not downloaded inputs.

Before a future external replacement can enter the build, a reviewer must record the exact source SHA-256 in `sources.lock.json`, fetch it into the ignored `.cache/rendering-sources/`, run the locked conversion toolchain, and update output hashes and budgets in `manifest.json`.

The ledger has two fail-closed states. `preview-placeholder` requires an unhashed, non-downloaded source lock and an explicitly marked placeholder pack. `reviewed` requires every source to carry a direct HTTPS download URL and SHA-256, the packed scene to set `placeholder: false`, and the source-lock download state to be true. Release validation accepts only the second state.

Commands:

- `pnpm run assets:verify` checks the lock, licenses, output hashes, paths, budgets, and placeholder scene contract.
- `pnpm run assets:refresh-lock` explicitly refreshes official API metadata and direct URLs; it does not download source bytes.
- `pnpm run assets:rebuild` regenerates only the deterministic self-authored placeholder pack, then verifies it.
- `pnpm run assets:fetch` deliberately fails until every selected file has an independently reviewed SHA-256.
- `pnpm run assets:preflight:reviewed` reports missing per-file hashes and missing locked conversion tools before any reviewed rebuild can begin.

The recorded external tool versions are in `scripts/assets/toolchain.lock.json`; they are not installed in the website dependency graph because the public Preview does not use them yet.
