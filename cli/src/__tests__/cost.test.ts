import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCostCommands } from "../commands/client/cost.js";

function program() {
  const result = new Command().exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerCostCommands(result);
  return result;
}
const context = ["--company-id", "test-company", "--api-base", "http://paperclip.test", "--api-key", "test-key", "--json"];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("cost report date options", () => {
  it.each([["cost", "summary", "costs/summary"], ["finance", "events", "costs/finance-events"]])("forwards bounds and all-time for %s %s", async (group, name, path) => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({})));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await program().parseAsync([group, name, ...context, "--all-time"], { from: "user" });
    expect(fetch.mock.calls[0][0]).toBe(`http://paperclip.test/api/companies/test-company/${path}?period=all`);
    await program().parseAsync([group, name, ...context, "--from", "2026-09-01", "--to", "2026-09-02"], { from: "user" });
    expect(fetch.mock.calls[1][0]).toBe(`http://paperclip.test/api/companies/test-company/${path}?from=2026-09-01&to=2026-09-02`);
  });
  it.each([["accounting", "health"], ["accounting", "inspect"], ["accounting", "invoices"], ["budget", "overview"], ["cost", "window-spend"], ["cost", "quota-windows"]])("rejects unsupported date flags for %s %s", async (group, name) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const args of [["--all-time"], ["--from", "2026-09-01"], ["--to", "2026-09-02"]]) {
      await expect(program().parseAsync([group, name, ...context, ...args], { from: "user" })).rejects.toThrow("unknown option");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
