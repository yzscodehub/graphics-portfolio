import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveSourceReview,
  parseApproveSourceReviewArguments,
  reviewEvidencePath,
  writeApprovedSourceReview,
} from "../scripts/assets/approve-source-review.mjs";
import {
  downloadSourceCandidates,
  parseDownloadSourceCandidateArguments,
} from "../scripts/assets/download-source-candidates.mjs";
import { fetchReviewedSources, findFetchBlockers } from "../scripts/assets/fetch-sources.mjs";
import { materializeReviewedSources } from "../scripts/assets/materialize-reviewed-sources.mjs";
import {
  createReviewEvidenceDescriptor,
  parseCreateReviewEvidenceArguments,
} from "../scripts/assets/create-review-evidence.mjs";
import {
  parseRebindSourceReviewArguments,
  rebindLegacySourceReview,
} from "../scripts/assets/rebind-source-review.mjs";
import { calculateSourceSetSha256 } from "../scripts/assets/manifest.mjs";
import { refreshPolyHavenSourceLock } from "../scripts/assets/refresh-polyhaven-lock.mjs";

function hash(bytes: Uint8Array, algorithm: "md5" | "sha256" = "sha256"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function fixtureLock(bytes: Uint8Array) {
  const sources = [
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
  ];
  return {
    version: 3,
    policy: {
      license: "CC0",
      stage: "metadata-locked",
      rawCache: ".cache/rendering-sources",
      disallowedExtensions: [".zip"],
    },
    sourceSetSha256: calculateSourceSetSha256(sources),
    sources,
  };
}

function createPacketAndEvidence(
  root: string,
  sourceLock: ReturnType<typeof fixtureLock>,
  review: { reviewId: string },
) {
  const packetPath = `.cache/rendering-quarantine/${review.reviewId}/review-packet/machine.json`;
  const packetFile = path.join(root, packetPath);
  mkdirSync(path.dirname(packetFile), { recursive: true });
  const packet = Buffer.from(
    JSON.stringify({
      version: 1,
      kind: "graphics-portfolio-source-review-packet",
      review: { reviewId: review.reviewId, sourceSetSha256: sourceLock.sourceSetSha256 },
      approval: { state: "awaiting-human-approval" },
    }),
  );
  writeFileSync(packetFile, packet);
  const relativeEvidence = reviewEvidencePath(review.reviewId);
  const evidenceFile = path.join(root, relativeEvidence);
  mkdirSync(path.dirname(evidenceFile), { recursive: true });
  writeFileSync(
    evidenceFile,
    JSON.stringify(
      {
        version: 1,
        reviewId: review.reviewId,
        sourceSetSha256: sourceLock.sourceSetSha256,
        reviewer: "reviewer",
        reviewedAt: "2026-09-02T12:00:00.000Z",
        packet: { path: packetPath, sha256: hash(packet) },
      },
      null,
      2,
    ) + "\n",
  );
  return relativeEvidence;
}

describe("Source Lock v3 candidate review workflow", () => {
  it("downloads a v2 receipt from a v3 metadata lock without promoting source hashes", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-review-"));
    const bytes = new TextEncoder().encode("reviewed candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const result = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-001",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      expect(result.review).toMatchObject({
        version: 2,
        reviewId: "review-001",
        sourceSetSha256: sourceLock.sourceSetSha256,
      });
      expect(result.review.files[0]).toMatchObject({
        sourceId: "fixture-model",
        relativePath: "fixture.gltf",
        sha256: hash(bytes),
      });
      expect(sourceLock.sources[0].files[0].sha256).toBeNull();
      await expect(
        downloadSourceCandidates(sourceLock, {
          root,
          reviewId: "review-001",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/already exists/);
      await expect(
        downloadSourceCandidates(sourceLock, {
          root,
          reviewId: "review-failed",
          fetchImpl: async () => new Response("failed", { status: 500 }),
        }),
      ).rejects.toThrow(/HTTP 500/);
      expect(existsSync(path.join(root, ".cache/rendering-quarantine/review-failed"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("offline-rebinds existing v1 quarantine bytes into a v2 source-set receipt", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-rebind-"));
    const bytes = new TextEncoder().encode("legacy candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const downloaded = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "legacy-001",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const legacy = {
        version: 1,
        reviewId: downloaded.review.reviewId,
        sourceLockSha256: "a".repeat(64),
        files: downloaded.review.files,
      };
      writeFileSync(downloaded.reviewPath, JSON.stringify(legacy, null, 2) + "\n");

      const rebound = rebindLegacySourceReview(sourceLock, legacy, {
        root,
        reviewId: "rebound-001",
      });
      expect(rebound.review).toMatchObject({
        version: 2,
        reviewId: "rebound-001",
        sourceSetSha256: sourceLock.sourceSetSha256,
      });
      expect(readFileSync(rebound.reviewPath, "utf8")).toContain("rebound-001");
      expect(readFileSync(path.join(root, rebound.review.files[0].quarantinePath))).toEqual(
        Buffer.from(bytes),
      );
      expect(sourceLock.policy.stage).toBe("metadata-locked");
      expect(() =>
        rebindLegacySourceReview(sourceLock, legacy, { root, reviewId: "rebound-001" }),
      ).toThrow(/already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires an actual public evidence descriptor and packet hash before producing a reviewed proposal", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-approval-"));
    const bytes = new TextEncoder().encode("approved candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const { review } = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-002",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      expect(() => approveSourceReview(sourceLock, review, { root })).toThrow(
        /evidence descriptor is missing/,
      );
      const evidencePath = createPacketAndEvidence(root, sourceLock, review);
      const approved = approveSourceReview(sourceLock, review, { root, evidencePath });
      expect(approved.policy.stage).toBe("sources-reviewed");
      expect(approved.review).toMatchObject({
        reviewId: "review-002",
        evidencePath,
        reviewer: "reviewer",
      });
      expect(approved.sources[0].files[0]).toMatchObject({
        sha256: hash(bytes),
        status: "reviewed",
      });

      const proposal = writeApprovedSourceReview(sourceLock, review, { root, evidencePath });
      expect(proposal.output).toContain("sources.reviewed.lock.json");
      expect(existsSync(path.join(root, "public/assets/rendering/sources.lock.json"))).toBe(false);
      expect(() => writeApprovedSourceReview(sourceLock, review, { root, evidencePath })).toThrow(
        /already exists/,
      );
      const applied = writeApprovedSourceReview(sourceLock, review, {
        root,
        evidencePath,
        apply: true,
      });
      expect(readFileSync(applied.output, "utf8")).toContain('"stage": "sources-reviewed"');
      expect(
        writeApprovedSourceReview(sourceLock, review, { root, evidencePath, apply: true }).output,
      ).toBe(applied.output);

      writeFileSync(
        path.join(
          root,
          `.cache/rendering-quarantine/${review.reviewId}/review-packet/machine.json`,
        ),
        "tampered",
      );
      expect(() => approveSourceReview(sourceLock, review, { root, evidencePath })).toThrow(
        /packet receipt SHA-256 mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically materializes only receipt-bound bytes and refuses overwrite", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-materialize-"));
    const bytes = new TextEncoder().encode("materialized candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const { review } = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-003",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const evidencePath = createPacketAndEvidence(root, sourceLock, review);
      const approved = approveSourceReview(sourceLock, review, { root, evidencePath });
      const result = materializeReviewedSources(approved, { root });
      expect(result.count).toBe(1);
      expect(readFileSync(path.join(root, approved.sources[0].files[0].cachePath))).toEqual(
        Buffer.from(bytes),
      );
      expect(() => materializeReviewedSources(approved, { root })).toThrow(/refusing to overwrite/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not publish a reproducibility cache when its staged network fetch fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-fetch-"));
    const bytes = new TextEncoder().encode("reproducible candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const { review } = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-009",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const evidencePath = createPacketAndEvidence(root, sourceLock, review);
      const approved = approveSourceReview(sourceLock, review, { root, evidencePath });
      await expect(
        fetchReviewedSources(approved, root, {
          fetchImpl: async () => new Response("failed", { status: 500 }),
        }),
      ).rejects.toThrow(/HTTP 500/);
      expect(existsSync(path.join(root, ".cache/rendering-sources"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a tracked human evidence descriptor from an awaiting-human packet without promotion", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-evidence-"));
    const bytes = new TextEncoder().encode("evidence candidate");
    const sourceLock = fixtureLock(bytes);
    try {
      const { review } = await downloadSourceCandidates(sourceLock, {
        root,
        reviewId: "review-008",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      createPacketAndEvidence(root, sourceLock, review);
      rmSync(path.join(root, reviewEvidencePath(review.reviewId)), { force: true });
      const result = createReviewEvidenceDescriptor(sourceLock, {
        root,
        reviewId: review.reviewId,
        reviewer: "human-reviewer",
        reviewedAt: "2026-09-02T12:00:00.000Z",
      });
      expect(result.output).toBe(path.join(root, reviewEvidencePath(review.reviewId)));
      expect(sourceLock.policy.stage).toBe("metadata-locked");
      expect(() =>
        createReviewEvidenceDescriptor(sourceLock, {
          root,
          reviewId: review.reviewId,
          reviewer: "human-reviewer",
          reviewedAt: "2026-09-02T12:00:00.000Z",
        }),
      ).toThrow(/already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-official URLs, packet-less promotions, and path escapes", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-review-failure-"));
    const bytes = new TextEncoder().encode("candidate");
    try {
      const unsafe = fixtureLock(bytes);
      unsafe.sources[0].files[0].directUrl = "https://example.com/fixture.gltf";
      unsafe.sourceSetSha256 = calculateSourceSetSha256(unsafe.sources);
      await expect(
        downloadSourceCandidates(unsafe, {
          root,
          reviewId: "review-004",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/allowlist/);

      const lock = fixtureLock(bytes);
      const { review } = await downloadSourceCandidates(lock, {
        root,
        reviewId: "review-005",
        fetchImpl: async () => new Response(bytes, { status: 200 }),
      });
      const incomplete = structuredClone(review);
      incomplete.files = [];
      expect(() => approveSourceReview(lock, incomplete, { root })).toThrow(/inventory/);
      expect(findFetchBlockers(lock)).toContain(
        "source lock: v3 reviewed stage and source-set receipt",
      );

      const unsafePath = fixtureLock(bytes);
      unsafePath.sources[0].files[0].relativePath = "../escape.gltf";
      unsafePath.sourceSetSha256 = calculateSourceSetSha256(unsafePath.sources);
      await expect(
        downloadSourceCandidates(unsafePath, {
          root,
          reviewId: "review-006",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/unsafe source relative path/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps promotion one-way, refreshes only metadata locks, and parses explicit approval inputs", async () => {
    const bytes = new TextEncoder().encode("candidate");
    const sourceLock = fixtureLock(bytes);
    const root = mkdtempSync(path.join(os.tmpdir(), "rendering-stage-"));
    try {
      sourceLock.policy.stage = "sources-reviewed";
      await expect(refreshPolyHavenSourceLock(sourceLock)).rejects.toThrow(/Refusing to refresh/);
      await expect(
        downloadSourceCandidates(sourceLock, {
          root,
          reviewId: "review-007",
          fetchImpl: async () => new Response(bytes, { status: 200 }),
        }),
      ).rejects.toThrow(/metadata-locked/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(parseDownloadSourceCandidateArguments(["--", "--review-id", "review-123"])).toBe(
      "review-123",
    );
    expect(
      parseRebindSourceReviewArguments([
        "--",
        "--legacy-review",
        ".cache/rendering-quarantine/legacy-001/review.json",
        "--review-id",
        "rebound-123",
      ]),
    ).toEqual({
      legacyReview: ".cache/rendering-quarantine/legacy-001/review.json",
      reviewId: "rebound-123",
    });
    expect(
      parseApproveSourceReviewArguments([
        "--",
        "--review",
        ".cache/rendering-quarantine/review-123/review.json",
        "--evidence",
        "public/assets/rendering/reviews/review-123.json",
      ]),
    ).toEqual({
      reviewFile: ".cache/rendering-quarantine/review-123/review.json",
      evidencePath: "public/assets/rendering/reviews/review-123.json",
      apply: false,
    });
    expect(
      parseCreateReviewEvidenceArguments([
        "--",
        "--review-id",
        "review-123",
        "--reviewer",
        "human-reviewer",
        "--reviewed-at",
        "2026-09-02T12:00:00.000Z",
      ]),
    ).toEqual({
      reviewId: "review-123",
      reviewer: "human-reviewer",
      reviewedAt: "2026-09-02T12:00:00.000Z",
    });
  });
});
