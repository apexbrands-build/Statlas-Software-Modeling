/** The plan editor's Save button: never enabled before the history has loaded (a save then drops the weekday pattern and event lifts). */
export function saveButtonState(a: { saving: boolean; needsSave: boolean; historyLoading: boolean }): { disabled: boolean; label: string } {
  if (a.saving) return { disabled: true, label: "Saving…" };
  if (a.historyLoading) return { disabled: true, label: "Loading history…" };
  return a.needsSave ? { disabled: false, label: "Save plan" } : { disabled: true, label: "Saved" };
}
