# Graphics Portfolio

An Astro-powered, static personal portfolio for a graphics systems engineer. The site is Chinese-first with English core routes and presents rendering, engine architecture, GPU compute, multimedia, and neural-graphics work without publishing private job-search data.

## Requirements

- Node.js 24 or later
- pnpm 11 or later

Install dependencies once and commit the generated `pnpm-lock.yaml` before relying on CI:

```powershell
pnpm install
pnpm dev
```

The local development server serves the same `/graphics-portfolio/` base path used by GitHub Pages.

## Commands

| Command              | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`           | Start Astro development mode.                                             |
| `pnpm check`         | Type-check Astro and TypeScript.                                          |
| `pnpm lint`          | Lint source and tests.                                                    |
| `pnpm format`        | Check formatting without modifying files.                                 |
| `pnpm test`          | Run unit tests.                                                           |
| `pnpm build`         | Build a local static preview.                                             |
| `pnpm test:content`  | Validate the required content inventory and metadata.                     |
| `pnpm test:links`    | Validate built internal links and the Pages base path.                    |
| `pnpm test:e2e`      | Run Chromium checks against `dist/`.                                      |
| `pnpm resume:pdf`    | Generate the Chinese and English public résumé PDFs.                      |
| `pnpm build:release` | Build and enforce release privacy, placeholder, content, and link checks. |

## Content contract

Content collections are in `src/content/` and are validated by `src/content.config.ts`.

- `projects`: exactly four published Chinese entries at release.
- `demos`: exactly seven published Chinese entries at release.
- `writing`: exactly six published Chinese entries at release; each needs `englishTitle` and `englishDescription`.
- `experience`: at least one anonymous entry at release.

Every entry needs `locale`, `translationKey`, and the collection-specific metadata. `draft: true` entries stay out of the release inventory. Collection schemas permit additional presentation fields, but the required fields remain the stable route and card contract.

## Reviewed neural model

The repository includes a 62,986-byte, 8-convolution residual denoiser trained
only on deterministic procedural Monte Carlo pairs generated locally. On 16
held-out scenes it reduced L1 from 0.001054 to 0.000644 and improved PSNR from
45.40 dB to 50.85 dB. PyTorch/ONNX maximum absolute difference is 8.94e-8.
See `training/model-card.md` for provenance, exact commands, hashes, and strict
limitations; these results are not presented as production-scene performance.

For links, use the shared helpers rather than manually prepending the repository name:

```ts
import { localePath, withBase } from "@/lib/urls";

const href = withBase(localePath("/work/", "zh-CN"));
```

`localePath()` returns a localized site route without the repository base. `withBase()` adds `/graphics-portfolio/` once and leaves external URLs and anchors unchanged.

## Public identity and release policy

`src/data/profile.ts` is the only source for the public nickname, email, GitHub username, and contact links. Keep job-search phone numbers, salary, address, private employer information, internal code, and unlicensed media out of the repository.

Production builds require a public HTTPS `SITE_URL` and reject unfilled public-identity placeholders, unfinished markers, telephone links, Chinese mobile numbers, and salary fields. The GitHub Pages release workflow supplies `SITE_URL` as `https://<owner>.github.io`. A release cannot deploy until the profile's release guard is marked ready and all public values have been intentionally set.

The release workflow also reads the repository variables `PUBLIC_HANDLE` and
`PUBLIC_EMAIL`, uses the repository owner as `GITHUB_USERNAME`, and regenerates
both PDFs. Local PDFs intentionally show a red draft marker while any public
identity placeholder remains.

## Deployment

The project publishes only when a `v1.0.0` tag is pushed or the Pages workflow is manually dispatched. Pull requests run type checks, linting, formatting, unit tests, static build, content/link validation, and Chromium route checks but do not deploy.

GitHub Pages must be configured to use **GitHub Actions** as its source. The site is emitted under `/graphics-portfolio/`; use a custom domain only after updating `SITE_URL` and the documented Pages configuration.
