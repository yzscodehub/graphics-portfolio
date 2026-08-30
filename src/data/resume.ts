import content from "./resume-content.json";
import { profile } from "./profile";

export const resume = {
  profile,
  summary: content.summary,
  skills: content.skills,
  experience: content.experience.map((entry) => ({
    id: entry.title.en
      .toLowerCase()
      .replace(/[^a-z]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    title: entry.title,
    period: entry.period,
    bullets: entry.bullets["zh-CN"].map((value, index) => ({
      "zh-CN": value,
      en: entry.bullets.en[index] ?? "",
    })),
    technologies: entry.technologies,
  })),
  portfolioHighlights: content.highlights["zh-CN"].map((value, index) => ({
    "zh-CN": value,
    en: content.highlights.en[index] ?? "",
  })),
  releaseGuard: {
    sourceOfTruth: "src/data/resume-content.json",
    pdfOutputs: ["public/resume/resume-zh-CN.pdf", "public/resume/resume-en.pdf"],
    requiredBeforeRelease: [
      "Set profile.displayName",
      "Set profile.publicEmail",
      "Set profile.githubUsername",
      "Review anonymous experience",
    ],
  },
} as const;

export type Resume = typeof resume;
