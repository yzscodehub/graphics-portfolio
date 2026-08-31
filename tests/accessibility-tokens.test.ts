import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

function token(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing color token --${name}.`);
  return value;
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("article paper color tokens", () => {
  it.each(["paper-muted", "paper-link", "paper-amber"])(
    "%s keeps small text above WCAG AA contrast",
    (name) => {
      expect(contrast(token(name), token("paper"))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps the paper focus indicator visibly distinct", () => {
    expect(contrast(token("paper-focus"), token("paper"))).toBeGreaterThanOrEqual(3);
  });

  it("binds the verified tokens to the actual paper selectors", () => {
    expect(css).toMatch(/\.writing-article-context__metrics dt,[\s\S]*color: var\(--paper-muted\)/);
    expect(css).toMatch(/\.writing-related-list span[\s\S]*color: var\(--paper-amber\)/);
    expect(css).toMatch(/\.article-paper :focus-visible[\s\S]*var\(--paper-focus\)/);
    expect(css).toMatch(/\.article-paper \.prose a[\s\S]*var\(--paper-link\)/);
  });
});
