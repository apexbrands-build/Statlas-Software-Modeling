import { describe, expect, it } from "vitest";
import { saveButtonState } from "./save-state";

describe("saveButtonState", () => {
  it("cannot save while the history is loading, because the weekday pattern and event lifts would be built from nothing", () => {
    expect(saveButtonState({ saving: false, needsSave: true, historyLoading: true })).toEqual({ disabled: true, label: "Loading history…" });
  });
  it("saves when there are changes and the history is in", () => {
    expect(saveButtonState({ saving: false, needsSave: true, historyLoading: false })).toEqual({ disabled: false, label: "Save plan" });
  });
  it("shows Saved, disabled, when there is nothing to save", () => {
    expect(saveButtonState({ saving: false, needsSave: false, historyLoading: false })).toEqual({ disabled: true, label: "Saved" });
  });
  it("shows Saving… while a save runs, whatever else is true", () => {
    expect(saveButtonState({ saving: true, needsSave: true, historyLoading: false })).toEqual({ disabled: true, label: "Saving…" });
    expect(saveButtonState({ saving: true, needsSave: true, historyLoading: true })).toEqual({ disabled: true, label: "Saving…" });
  });
});
