export type SiteStage = "preview" | "release";

export interface SiteFeatures {
  stage: SiteStage;
  indexing: boolean;
  resume: false;
  emailContact: false;
  rss: boolean;
  sitemap: boolean;
}

export function resolveSiteStage(input?: string): SiteStage;
export function resolveSiteFeatures(input?: string): Readonly<SiteFeatures>;
export const supportedSiteStages: readonly SiteStage[];
