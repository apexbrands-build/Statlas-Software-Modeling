import { describe, expect, it, vi } from "vitest";
import { verifyKlaviyo } from "./klaviyo";

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const account = (organization_name?: string) => ({ data: [{ type: "account", id: "AcCt12", attributes: { contact_information: organization_name === undefined ? {} : { organization_name }, timezone: "Europe/London", preferred_currency: "GBP" } }] });
const input = { accountId: "", apiKey: "pk_secret_1" };

describe("verifyKlaviyo", () => {
  it("returns the organization name and the account id from the key", async () => {
    const f = vi.fn(async () => answer(account("Acme Co")));
    expect(await verifyKlaviyo(input, f)).toEqual({ accountName: "Acme Co", accountId: "AcCt12" });
  });

  it("sends a read-only call with the Private key and a revision", async () => {
    const f = vi.fn(async () => answer(account("Acme Co")));
    await verifyKlaviyo(input, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method?: string; headers: Record<string, string> }];
    expect(url).toBe("https://a.klaviyo.com/api/accounts");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers.Authorization).toBe("Klaviyo-API-Key pk_secret_1");
    expect(init.headers.revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to a generic name when the account has no organization name", async () => {
    expect((await verifyKlaviyo(input, async () => answer(account()))).accountName).toBe("Klaviyo account");
  });

  it("treats an empty account list as a failed verification", async () => {
    await expect(verifyKlaviyo(input, async () => answer({ data: [] }))).rejects.toThrow("Klaviyo returned no account for this key");
  });

  it("explains a rejected key and a key without permission in plain words", async () => {
    await expect(verifyKlaviyo(input, async () => answer({}, 401))).rejects.toThrow("Klaviyo rejected the API key. Create a new Private API key in Klaviyo (Settings, API keys) and paste it here.");
    await expect(verifyKlaviyo(input, async () => answer({}, 403))).rejects.toThrow("This Klaviyo key cannot read the account. Give the key the Accounts, Campaigns, Flows, Metrics and Events read scopes, or use Read-Only access.");
  });

  it("asks for a key when there is none, and never repeats the key in an error", async () => {
    await expect(verifyKlaviyo({ accountId: "" }, async () => answer({}))).rejects.toThrow("API key is required");
    const err = await verifyKlaviyo(input, async () => { throw new Error("socket hang up pk_secret_1"); }, { retries: 0 }).catch((e) => e);
    expect(String(err.message)).not.toContain("pk_secret_1");
  });
});
