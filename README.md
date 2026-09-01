# Graphics Portfolio

An Astro-powered static portfolio for a graphics systems engineer. The site is Chinese-first with English core routes and presents rendering, engine architecture, GPU compute, multimedia, and neural-graphics work without publishing private job-search data.

## Requirements

- Node.js 24 or later
- pnpm 11 or later

```powershell
pnpm install
pnpm dev
```

The local development server uses the `/graphics-portfolio/` base path required by GitHub Pages.

## Commands

| Command                    | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                 | Start Astro development mode.                                           |
| `pnpm check`               | Type-check Astro and TypeScript.                                        |
| `pnpm lint`                | Lint source and tests.                                                  |
| `pnpm format`              | Check formatting without modifying files.                               |
| `pnpm test`                | Run unit tests.                                                         |
| `pnpm build`               | Build the static site without preview artifact validation.              |
| `pnpm build:preview`       | Build the guarded preview, then validate content, links, and output.    |
| `pnpm test:content`        | Validate the required content inventory and metadata.                   |
| `pnpm test:links`          | Validate built internal links and the Pages base path.                  |
| `pnpm test:e2e`            | Run Chromium checks against `dist/`.                                    |
| `pnpm assets:verify`       | Verify rendering asset hashes, licenses, budgets, and Demo bindings.    |
| `pnpm assets:rebuild`      | Deterministically rebuild the self-authored placeholder scene pack.     |
| `pnpm assets:fetch`        | Fetch only externally reviewed sources with locked SHA-256 values.      |
| `pnpm verify:preview`      | Verify preview privacy, noindex, robots, model, and deferred artifacts. |
| `pnpm deferred:resume:pdf` | Regenerate deferred resume PDFs after release materials return.         |
| `pnpm build:release`       | Run the future release privacy, content, and link checks.               |

## Content contract

Content collections live in `src/content/` and are validated by `src/content.config.ts`.

- `projects`: exactly four published Chinese entries.
- `demos`: exactly eight published Chinese entries, including Clustered/Deferred Lighting.
- `writing`: twelve published Chinese technical articles organized into six graphics tracks plus one adjacent multimedia track; each includes an English title and abstract.
- `experience`: anonymous capability entries only.

Every entry needs `locale`, `translationKey`, and its collection-specific metadata. `draft: true` entries do not enter the preview inventory.

Every Demo also declares its runtime modes, public source URL, asset IDs, and optional shared reference scene. The asset IDs must resolve through `public/assets/rendering/manifest.json`; original Poly Haven downloads remain outside Git and `dist` until each direct URL and SHA-256 has been reviewed.

Writing follows an explicit learning map:

1. `rendering`
2. `engine-systems`
3. `gpu-compute`
4. `ray-tracing`
5. `debugging`
6. `neural-graphics`
7. `multimedia` as an adjacent systems track

Each published article declares its module/order, level, prerequisites, learning outcomes, related projects/Demos/articles, reading time, and bilingual abstract metadata. The content guard also requires substantial body depth, H2 structure, code or data-flow evidence, a reproducible experiment, and an explicit boundary/limitation/checklist.

For internal links, use the shared helpers rather than manually prepending the repository name:

```ts
import { localePath, withBase } from "@/lib/urls";

const href = withBase(localePath("/work/", "zh-CN"));
```

`localePath()` returns a localized route without the repository base. `withBase()` adds `/graphics-portfolio/` once and leaves external URLs and anchors unchanged.

## Public preview policy

`SITE_STAGE` is the only stage input. `src/data/site-stage.mjs` resolves it to the shared feature object used by Astro, UI, validation, and deployment:

```ts
resolveSiteFeatures("preview"); // noindex, no sitemap, GitHub-only
resolveSiteFeatures("release"); // indexable, sitemap + RSS, still GitHub-only
```

`src/data/profile.ts` is the only source for the public nickname and GitHub link. The preview exposes only `yzscodehub` and `https://github.com/yzscodehub`; it has no email, contact form, telephone link, resume route, or PDF artifact. Keep phone numbers, salary, address, private employer information, internal code, and unlicensed media out of the repository.

`pnpm verify:preview` rejects public-email placeholders, phone and salary data, mail or telephone links, resume routes, PDF artifacts in `dist`, tracked PDF drafts anywhere in the repository, missing or oversize neural models, missing `noindex,nofollow` metadata, and an unblocked `robots.txt`.

The former resume implementation is preserved under `deferred/resume/` and remains outside Astro routes and Pages artifacts in both Preview and Release. Publishing a resume or email requires a separate future product decision.

## Reviewed neural model

The repository includes a small residual denoiser trained only on deterministic procedural Monte Carlo pairs generated locally. See `training/model-card.md` for provenance, exact commands, hashes, and strict limitations. These results are not presented as production-scene performance.

The reviewed reproduction command fixes the published 16-channel, 50-epoch
configuration rather than relying on training defaults:

```powershell
python training/train_denoiser.py `
  --data-root D:/datasets/portfolio-procedural-v1 `
  --output training/checkpoints/denoiser.pt `
  --patch-size 256 `
  --features 16 `
  --batch-size 4 `
  --epochs 50 `
  --learning-rate 0.0002 `
  --seed 7 `
  --workers 0 `
  --device cpu

python training/export_onnx.py `
  --checkpoint training/checkpoints/denoiser.pt `
  --output public/models/neural-denoiser.onnx `
  --opset 17

python training/export_web_pair.py `
  --dataset-root D:/datasets/portfolio-procedural-v1 `
  --source-stem scene-0064 `
  --asset-stem scene-0001 `
  --scene-seed 91103 `
  --output-root public/models/heldout

python training/write_model_manifest.py `
  --model public/models/neural-denoiser.onnx `
  --heldout-manifest public/models/heldout/manifest.json `
  --output public/models/neural-denoiser.manifest.json `
  --input-name noisy_rgb `
  --output-name denoised_rgb `
  --opset 17
```

`training/README.md` documents the matching ONNX export, versioned held-out
pair export, and `neural-denoiser.manifest.json` generation. The browser and
preview/release gates verify the manifest's model and held-out SHA-256 values.

## Deployment

Pushes to `main` always run type checks, linting, formatting, unit tests, guarded Preview build, link checks, and Chromium checks. While the persistent repository variable `ENABLE_PREVIEW_PAGES` is not `false`, `.github/workflows/preview-pages.yml` also deploys the Preview to:

`https://yzscodehub.github.io/graphics-portfolio/`

Preview pages send `noindex,nofollow` and `robots.txt` uses `Disallow: /`; Astro enables Sitemap only when `SITE_STAGE=release`. The release PR must set `ENABLE_PREVIEW_PAGES=false` before tagging so later `main` pushes remain verify-only and cannot overwrite an indexed release. GitHub Pages must use **GitHub Actions** as its source.

`.github/workflows/release-pages.yml` accepts only stable SemVer tags such as `v1.0.0`, verifies that the tagged commit belongs to `main`, and deploys with `SITE_STAGE=release`. Do not create `v1.0.0` until the reviewed Preview satisfies the full acceptance gate.
