import process from "node:process";

const stages = ["preview", "release"];

/**
 * Resolve the only supported build-stage input. Preview is deliberately the
 * safe default so local builds never become indexable by accident.
 */
export function resolveSiteStage(input = process.env.SITE_STAGE) {
  const value = (input ?? "preview").trim().toLowerCase();
  if (!stages.includes(value)) {
    throw new Error(`SITE_STAGE must be one of: ${stages.join(", ")}. Received: ${input}`);
  }
  return value;
}

/**
 * This feature object is shared by Astro configuration and server-rendered UI.
 * Resume and email remain deliberately deferred in both currently supported
 * stages; their future release is a separate, explicit product decision.
 */
export function resolveSiteFeatures(input = process.env.SITE_STAGE) {
  const stage = resolveSiteStage(input);
  const release = stage === "release";
  return Object.freeze({
    stage,
    indexing: release,
    resume: false,
    emailContact: false,
    rss: true,
    sitemap: release,
  });
}

export const supportedSiteStages = Object.freeze([...stages]);
