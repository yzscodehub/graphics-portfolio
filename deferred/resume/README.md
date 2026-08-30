# Deferred résumé module

The résumé implementation is intentionally excluded from the public preview.
Nothing under this directory is imported by Astro or copied into `dist`.

## Restore for a release

Move the archived paths back to their original repository locations:

```text
deferred/resume/src/pages/resume       -> src/pages/resume
deferred/resume/src/pages/en/resume    -> src/pages/en/resume
deferred/resume/src/views/ResumePage   -> src/views/ResumePage
deferred/resume/src/data/resume*       -> src/data/resume*
deferred/resume/scripts/resume         -> scripts/resume
```

Then enable `features.resume` and `features.emailContact`, provide the reviewed
public email, run `pnpm deferred:resume:pdf` to regenerate both ignored PDF outputs,
move the reviewed PDFs to `public/resume`, restore the release-route tests, and run the
full `verify:release` workflow. The archived page files intentionally retain
their original relative imports so they become valid again after restoration.

Local draft PDF generation remains available through `pnpm deferred:resume:pdf`;
generated PDFs are intentionally ignored and must not be committed during Preview.
