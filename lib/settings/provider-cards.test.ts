import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderCards } from "@/components/settings/ProviderCards";

const html = renderToStaticMarkup(createElement(ProviderCards, { clientId: "c1", onChanged: async () => {}, onClose: () => {}, setMsg: () => {} }));
const card = (label: string) => {
  const start = html.indexOf(`>${label}<`);
  // Each card is a block of markup from its title to the next card's rounded border.
  const from = html.lastIndexOf('<div class="space-y-2 rounded-xl', start);
  // The card ends where the next card, the next group heading or the next "Soon" row begins.
  const ends = ['<div class="space-y-2 rounded-xl', '<h3 class="text-xs', '<div class="flex items-center justify-between rounded-xl'].map((m) => html.indexOf(m, start)).filter((i) => i !== -1);
  return html.slice(from, ends.length ? Math.min(...ends) : undefined);
};

describe("Add Connection cards for the messaging platforms", () => {
  it("shows Klaviyo, Postscript and Omnisend as live cards with their logos, not as Soon rows", () => {
    for (const [label, logo] of [["Klaviyo", "klaviyo.png"], ["Postscript", "postscript.png"], ["Omnisend", "omnisend.png"]]) {
      const c = card(label);
      expect(c, label).toContain("Connect");
      expect(c, label).not.toContain("Soon");
      expect(c, label).toContain(logo);
    }
  });

  it("asks only for the key on Klaviyo, and for a name and a key on Postscript and Omnisend", () => {
    expect(card("Klaviyo")).not.toContain('aria-label="Account name"');
    expect(card("Klaviyo")).toContain("Read-only API key");
    expect(card("Postscript")).toContain('aria-label="Shop name"');
    expect(card("Omnisend")).toContain('aria-label="Brand name"');
  });

  it("explains where to find each key and that data sync comes next", () => {
    expect(card("Klaviyo")).toContain("Private API key");
    expect(card("Postscript")).toContain("not the Public one");
    expect(card("Omnisend")).toContain("Integrations and API");
    for (const label of ["Klaviyo", "Postscript", "Omnisend"]) expect(card(label)).toContain("comes next");
  });

  it("keeps the other platforms that are not built yet as Soon rows", () => {
    expect(html).toContain("Soon");
  });
});
