export const locales = ["zh-CN", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export const otherLocale: Record<Locale, Locale> = {
  "zh-CN": "en",
  en: "zh-CN",
};

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

export function localeLabel(locale: Locale): string {
  return locale === "zh-CN" ? "中文" : "English";
}

const projectBase = "/graphics-portfolio/";
const protocolPattern = /^[a-z][a-z\d+.-]*:/i;

function splitSuffix(path: string): { pathname: string; suffix: string } {
  const match = path.match(/^([^?#]*)(.*)$/);
  return { pathname: match?.[1] ?? path, suffix: match?.[2] ?? "" };
}

function isExternal(path: string): boolean {
  return protocolPattern.test(path) || path.startsWith("//");
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";

  const { pathname, suffix } = splitSuffix(trimmed);
  const normalized = `/${pathname.replace(/^\/+/, "").replace(/\/{2,}/g, "/")}`;
  const route = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${route}${suffix}`;
}

function stripProjectBase(path: string): string {
  const { pathname, suffix } = splitSuffix(normalizePath(path));
  if (pathname === projectBase) return `/${suffix}`;
  if (pathname.startsWith(projectBase)) return `/${pathname.slice(projectBase.length)}${suffix}`;
  return `${pathname}${suffix}`;
}

function stripLocalePrefix(path: string): string {
  const { pathname, suffix } = splitSuffix(stripProjectBase(path));
  if (pathname === "/en/") return `/${suffix}`;
  if (pathname.startsWith("/en/")) return `/${pathname.slice(4)}${suffix}`;
  return `${pathname}${suffix}`;
}

/**
 * Returns a localised route without the GitHub Pages project base.
 * It accepts either an unbased route or `Astro.url.pathname`.
 */
export function localePath(path: string, locale: Locale = defaultLocale): string {
  if (isExternal(path) || path.startsWith("#")) return path;

  const stripped = stripLocalePrefix(path);
  const { pathname, suffix } = splitSuffix(stripped);

  if (locale === defaultLocale) return `${pathname}${suffix}`;
  if (pathname === "/") return `/en/${suffix}`;
  return `/en${pathname}${suffix}`;
}

/** Returns the equivalent route in the non-current language. */
export function otherLocalePath(path: string, locale: Locale): string {
  return localePath(path, otherLocale[locale]);
}
