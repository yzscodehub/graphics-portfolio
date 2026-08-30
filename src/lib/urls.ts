export { localePath, otherLocalePath } from "./i18n";

/**
 * Keep this value aligned with the GitHub Pages project repository name.
 * Page code should call `withBase(localePath(path, locale))` for internal URLs.
 */
export const siteBase = "/graphics-portfolio/";

const protocolPattern = /^[a-z][a-z\d+.-]*:/i;

function splitSuffix(path: string): { pathname: string; suffix: string } {
  const match = path.match(/^([^?#]*)(.*)$/);
  return { pathname: match?.[1] ?? path, suffix: match?.[2] ?? "" };
}

function isExternal(path: string): boolean {
  return protocolPattern.test(path) || path.startsWith("//");
}

/**
 * Adds the static GitHub Pages project base to an internal route or asset.
 * External links and in-page anchors remain untouched.
 */
export function withBase(path: string): string {
  if (!path || path === "/") return siteBase;
  if (isExternal(path) || path.startsWith("#")) return path;

  const { pathname, suffix } = splitSuffix(path);
  const normalized = pathname.replace(/^\/+/, "");
  const baseWithoutLeadingSlash = siteBase.slice(1, -1);
  if (
    normalized === baseWithoutLeadingSlash ||
    normalized.startsWith(`${baseWithoutLeadingSlash}/`)
  ) {
    return `/${normalized}${suffix}`;
  }
  return `${siteBase}${normalized}${suffix}`;
}
