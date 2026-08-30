# Resume generation input

`resume-input.json` is the policy and output contract for the bilingual
resume renderer. Resume content lives in `src/data/resume.ts`, so the web
resume and the printed PDFs can share one source of truth.

The renderer should:

1. Load the `zh-CN` or `en` branch of `resume`.
2. Resolve the public identity values from `src/data/profile.ts`.
3. Fail in release mode if `YOUR_HANDLE`, `PUBLIC_EMAIL`, or
   `GITHUB_USERNAME` remains anywhere in the rendered document.
4. Reject private fields such as phone numbers, salary, addresses, or
   unapproved employer material.
5. Write the two paths declared in `resume-input.json` only after rendering.

Run `generate_resumes.py` to create local draft PDFs. Drafts visibly carry a
public-identity warning while placeholders remain. A release build must supply
the three public identity environment variables and regenerate the PDFs.
