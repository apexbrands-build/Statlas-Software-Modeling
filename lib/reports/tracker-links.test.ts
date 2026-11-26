import { describe, expect, it } from "vitest";
import { trackerLinks } from "./tracker-links";

describe("trackerLinks: the trackers a report can link to", () => {
  it("lists the trackers that are built, with their page and the platform's name", () => {
    expect(trackerLinks()).toEqual([
      { id: "meta", label: "Meta", title: "Meta Tracker", href: "/reporting/facebook-tracker" },
      { id: "google", label: "Google", title: "Google Tracker", href: "/reporting/google-tracker" },
    ]);
  });
});
