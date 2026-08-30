import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";
import { describe, expect, it } from "vitest";

const verifier = fileURLToPath(new URL("./verify-production.mjs", import.meta.url));

describe("production privacy policy", () => {
  it("does not interpret decimal model metrics as Chinese mobile numbers", async () => {
    const policy = (await import("./verify-production.mjs")) as {
      findPolicyViolations(text: string, relativePath: string): Array<{ code: string }>;
    };
    const violations = policy.findPolicyViolations(
      '{"mse":0.00000821846506288617,"psnr":50.852092867136605}',
      "model.metrics.json",
    );
    expect(violations.some((violation) => violation.code === "phone-number")).toBe(false);
  });

  it("blocks the unchecked public-identity placeholders before a release", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "graphics-portfolio-policy-"));
    const profileDirectory = path.join(fixtureRoot, "src", "data");
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(
      path.join(profileDirectory, "profile.ts"),
      "export const handle = 'YOUR_HANDLE';\n",
    );

    const result = (() => {
      try {
        execFileSync(process.execPath, [verifier, fixtureRoot], {
          env: { ...process.env, SITE_URL: "https://octo.github.io" },
          encoding: "utf8",
          stdio: "pipe",
        });
        return "";
      } catch (error) {
        const processError = error as { stdout?: string; stderr?: string };
        return `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
      }
    })();

    try {
      expect(result).toContain("[placeholder]");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
