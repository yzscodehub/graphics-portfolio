import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveSourceReview,
  parseApproveSourceReviewArguments,
  writeApprovedSourceReview,
} from "../scripts/assets/approve-source-review.mjs";
import {
  downloadSourceCandidates,
  parseDownloadSourceCandidateArguments,
} from "../scripts/assets/download-source-candidates.mjs";
import { findFetchBlockers } from "../scripts/assets/fetch-sources.mjs";
import { refreshPolyHavenSourceLock } from "../scripts/assets/refresh-polyhaven-lock.mjs";

function hash(bytes: Uint8Array, algorithm: "md5" | "sha256"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function fixtureLock(bytes: Uint8Array) {
  return {
    version: 2,
    policy: {
      license: "CC0",
      downloaded: false,
      stage: "metadata-locked",
      rawCache: ".cache/rendering-sources",
    },
    defaults: {
      license: "CC0",
      status: "metadata-locked",
      sourceUrl: "https://polyhaven.com/a/",
    },
    sources: [
      {
        id: "fixture-model",
        kind: "mesh",
        page: "fixture_model",
        sourceUrl: "https://polyhaven.com/a/fixture_model",
        license: "CC0",
        authors: ["Fixture"],
        files: [
          {
            role: "gltf",
            relativePath: "fixture.gltf",
            directUrl: "https://dl.polyhaven.org/file/fixture/fixture.gltf",
            bytes: bytes.byteLength,
            md5: hash(bytes, "md5"),
            sha256: null,
            status: "metadata-locked",
            cachePath: ".cache/rendering-sources/fixture-model/fixture.gltf",
          },
        ],
        usedBy: ["clustered-lighting"],
      },
    ],
  };
}

describe("Poly Haven candidate review workflow", () => {
  it("downloads into quarantine and produces a deterministic, non-promoting review", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-review-"));
    const bytes = new TextEncoder().encode("reviewed candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const fetchImpl = async () => new Response(bytes, { status: 200 });
      const result = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-001",
        fetchImpl,
      });
      expect(result.review.files).toEqual([
        expect.objectContaining({
          sourceId: "fixture-model",
          relativePath: "fixture.gltf",
          sha256: hash(bytes, "sha256"),
        }),
      ]);
      expect(existsSync(result.reviewPath)).toBe(true);
      expect(sourceLock.sources[0].files[0].sha256).toBeNull();
      await expect(
        downloadSourceCandidates(sourceLock, {
          root,
          reviewId: "review-001",
          fetchImpl,
        }),
      ).rejects.toThrow(/already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("revalidates the complete quarantine set before writing a proposal or applying", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-approval-"));
    const bytes = new TextEncoder().encode("approved candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const { review } = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-002",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const approved = approveSourceReview(sourceLock, review, { root });
      expect(approved.policy).toMatchObject({
        downloaded: false,
        stage: "sources-reviewed",
      });
      expect(approved.sources[0].files[0]).toMatchObject({
        sha256: hash(bytes, "sha256"),
        status: "reviewed",
      });

      const proposal = writeApprovedSourceReview(sourceLock, review, { root });
      expect(proposal.output).toContain("sources.reviewed.lock.json");
      expect(existsSync(path.join(root, "public/assets/rendering/sources.lock.json"))).toBe(false);

      const applied = writeApprovedSourceReview(sourceLock, review, { root, apply: true });
      expect(applied.output).toBe(path.join(root, "public/assets/rendering/sources.lock.json"));
      expect(JSON.parse(readFileSync(applied.output, "utf8")).policy.stage).toBe(
        "sources-reviewed",
      );
      const reapplied = writeApprovedSourceReview(sourceLock, review, { root, apply: true });
      expect(reapplied.output).toBe(applied.output);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-official URLs, checksum drift, and incomplete reviews", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-review-failure-"));
    const bytes = new TextEncoder().encode("candidate");
    try {
      const unsafe = fixtureLock(bytes);
      unsafe.sources[0].files[0].directUrl = "https://example.com/fixture.gltf";
      await expect(
        downloadSourceCandidates(unsafe, {
          root,
          reviewId: "review-003",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/allowlist/);

      const lock = fixtureLock(bytes);
      const { review } = await downloadSourceCandidates(lock, {
        root,
        reviewId: "review-004",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const incomplete = structuredClone(review);
      incomplete.files = [];
      expect(() => approveSourceReview(lock, incomplete, { root })).toThrow(/inventory/);
      writeFileSync(path.join(root, review.files[0].quarantinePath), "tampered");
      expect(() => approveSourceReview(lock, review, { root })).toThrow(
        /wrong size|MD5 mismatch|SHA-256 mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never refreshes over a source-reviewed lock", async () => {
    const bytes = new TextEncoder().encode("candidate");
    const sourceLock = fixtureLock(bytes);
    (sourceLock.policy as { stage: string }).stage = "sources-reviewed";
    await expect(refreshPolyHavenSourceLock(sourceLock)).rejects.toThrow(/Refusing to refresh/);
  });

  it("rejects Windows and POSIX path escapes before download, approval, or fetch", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-path-boundary-"));
    const bytes = new TextEncoder().encode("candidate");
    const unsafePaths = [
      "../escape.gltf",
      "..\\\\escape.gltf",
      "/absolute.gltf",
      "\\\\absolute.gltf",
      "C:\\\\escape.gltf",
      "C:relative.gltf",
      "safe/file:stream.gltf",
      "\\\\server\\\\share\\\\escape.gltf",
      "safe\\0escape.gltf",
    ];
    unsafePaths[unsafePaths.length - 1] = `safe${String.fromCharCode(0)}escape.gltf`;
    try {
      for (const [index, unsafePath] of unsafePaths.entries()) {
        const relativeLock = fixtureLock(bytes);
        relativeLock.sources[0].files[0].relativePath = unsafePath;
        await expect(
          downloadSourceCandidates(relativeLock, {
            root,
            reviewId: `relative-${index}`,
            fetchImpl: async () => new Response(bytes, { status: 200 }),
          }),
        ).rejects.toThrow(/unsafe source relative path/);
        expect(findFetchBlockers(relativeLock)).toEqual(
          expect.arrayContaining([expect.stringContaining("safe source/cache path")]),
        );

        const cacheLock = fixtureLock(bytes);
        cacheLock.sources[0].files[0].cachePath = unsafePath;
        await expect(
          downloadSourceCandidates(cacheLock, {
            root,
            reviewId: `cache-${index}`,
            fetchImpl: async () => new Response(bytes, { status: 200 }),
          }),
        ).rejects.toThrow(/cache path/);
        expect(findFetchBlockers(cacheLock)).toEqual(
          expect.arrayContaining([expect.stringContaining("safe source/cache path")]),
        );
      }

      const mismatched = fixtureLock(bytes);
      mismatched.sources[0].files[0].cachePath =
        ".cache/rendering-sources/fixture-model/other.gltf";
      await expect(
        downloadSourceCandidates(mismatched, {
          root,
          reviewId: "cache-mismatch",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/exactly match/);
      expect(findFetchBlockers(mismatched)).toEqual(
        expect.arrayContaining([expect.stringContaining("safe source/cache path")]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps review promotion one-way and accepts pnpm's leading argument separator", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-stage-boundary-"));
    const bytes = new TextEncoder().encode("candidate");
    try {
      for (const stage of ["sources-reviewed", "integrated"]) {
        const sourceLock = fixtureLock(bytes);
        (sourceLock.policy as { stage: string }).stage = stage;
        sourceLock.policy.downloaded = stage === "integrated";
        sourceLock.defaults.status = "sources-reviewed";
        await expect(
          downloadSourceCandidates(sourceLock, {
            root,
            reviewId: `stage-${stage}`,
            fetchImpl: async () => new Response(bytes, { status: 200 }),
          }),
        ).rejects.toThrow(/metadata-locked/);
        expect(() => approveSourceReview(sourceLock, {}, { root })).toThrow(/metadata-locked/);
        expect(() => writeApprovedSourceReview(sourceLock, {}, { root, apply: true })).toThrow(
          /metadata-locked/,
        );
      }
      expect(existsSync(path.join(root, "public/assets/rendering/sources.lock.json"))).toBe(false);
      expect(parseDownloadSourceCandidateArguments(["--", "--review-id", "review-123"])).toBe(
        "review-123",
      );
      expect(
        parseApproveSourceReviewArguments([
          "--",
          "--review",
          ".cache/rendering-quarantine/review-123/review.json",
          "--apply",
        ]),
      ).toEqual({
        reviewFile: ".cache/rendering-quarantine/review-123/review.json",
        apply: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
