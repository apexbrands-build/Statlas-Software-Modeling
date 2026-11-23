/** Which Home view a client was last looked at with: "site" (the own site), "business" (the whole business) or the key of another sales channel. Remembered per client in this browser. */
export const SITE_VIEW = "site";
export const BUSINESS_VIEW = "business";

const key = (clientId: string) => `apex.homeView.${clientId}`;
const browserStorage = (): Storage | undefined => (typeof window === "undefined" ? undefined : window.localStorage);

/** The remembered view when it is still one the client has, else the own site. */
export function readViewChoice(clientId: string, valid: string[], storage: Pick<Storage, "getItem"> | undefined = browserStorage()): string {
  try {
    const v = storage?.getItem(key(clientId));
    return v && valid.includes(v) ? v : SITE_VIEW;
  } catch {
    return SITE_VIEW;
  }
}

export function writeViewChoice(clientId: string, view: string, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(key(clientId), view);
  } catch {
    // Blocked or full storage: the choice just is not remembered.
  }
}
