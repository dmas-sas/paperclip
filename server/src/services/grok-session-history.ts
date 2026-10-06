import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { agentTaskSessions, type Db } from "@paperclipai/db";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import type { StoredSecretVersionMaterial } from "../secrets/types.js";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const FIELD = "paperclipGrokHistory";
class GrokHistoryLimitError extends Error {}
type Entry = { name: string; bytes: string };

function validName(name: string) {
  return name.split("/").length <= 3 && name.split("/").every(part =>
    /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
}

/** Called only after managed connection authorization. No retained host path is exposed to a CLI. */
export async function prepareGrokSessionHistory(db: Db, input: {
  companyId: string; agentId: string; taskKey?: string | null;
  sessionIdentity: string; providerHome: string;
}) {
  const directory = path.join(input.providerHome, "sessions");
  await mkdir(directory, { mode: 0o700 });
  if (!input.taskKey) return async (): Promise<Record<string, unknown> | undefined> => undefined;
  const scope = createHash("sha256").update(JSON.stringify([
    input.companyId, input.agentId, input.taskKey, input.sessionIdentity,
  ])).digest("hex");
  const where = and(eq(agentTaskSessions.companyId, input.companyId),
    eq(agentTaskSessions.agentId, input.agentId), eq(agentTaskSessions.adapterType, "grok_local"),
    eq(agentTaskSessions.taskKey, input.taskKey));
  const [row] = await db.select({ params: agentTaskSessions.sessionParamsJson }).from(agentTaskSessions).where(where).limit(1);
  const retained = row?.params?.[FIELD] as { scope?: unknown; material?: StoredSecretVersionMaterial } | undefined;
  if (retained?.scope === scope && retained.material) {
    const value = await localEncryptedProvider.resolveVersion({ material: retained.material, externalRef: null });
    if (Buffer.byteLength(value) > MAX_BYTES * 2) throw new Error("Grok history exceeds its storage bound");
    const archive = JSON.parse(value) as { scope: string; entries: Entry[] };
    // Authenticate the scope inside the ciphertext as well as in the row metadata.
    if (archive.scope !== scope || !Array.isArray(archive.entries) || archive.entries.length > MAX_ENTRIES)
      throw new Error("Grok history scope is invalid");
    let size = 0;
    for (const entry of archive.entries) {
      if (typeof entry.name !== "string" || !validName(entry.name) || typeof entry.bytes !== "string")
        throw new Error("Grok history entry is invalid");
      const bytes = Buffer.from(entry.bytes, "base64");
      size += bytes.length;
      if (size > MAX_BYTES) throw new Error("Grok history exceeds its storage bound");
      const target = path.join(directory, entry.name);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
    }
  }
  return async (): Promise<Record<string, unknown> | undefined> => {
    const root = await realpath(directory);
    const entries: Entry[] = [];
    let size = 0;
    let count = 0;
    async function collect(relative = "") {
      for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        if (++count > MAX_ENTRIES) throw new GrokHistoryLimitError("Grok history exceeds its entry bound");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (!validName(name) || entry.isSymbolicLink()) continue;
        const source = path.join(root, name);
        if (entry.isDirectory()) { await collect(name); continue; }
        if (!entry.isFile() || !(await realpath(source)).startsWith(`${root}${path.sep}`)) continue;
        const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1) continue;
          if (size + stat.size > MAX_BYTES) throw new GrokHistoryLimitError("Grok history exceeds its storage bound");
          const bytes = await file.readFile();
          size += bytes.length;
          if (size > MAX_BYTES) throw new GrokHistoryLimitError("Grok history exceeds its storage bound");
          entries.push({ name, bytes: bytes.toString("base64") });
        } finally { await file.close(); }
      }
    }
    try { await collect(); }
    catch (error) {
      if (!(error instanceof GrokHistoryLimitError)) throw error;
      // Save provider metadata normally, but explicitly discard the unusable
      // transcript. The adapter starts with a fresh task handoff next time.
      return { [FIELD]: null, paperclipGrokHistoryStatus: "fresh_session_required" };
    }
    if (entries.length === 0) return;
    const prepared = await localEncryptedProvider.createVersion({ value: JSON.stringify({ scope, entries }) });
    // The heartbeat writes this with the provider session's checkpoint before
    // releasing execution ownership. Cleanup must not race a subsequent resume.
    return { [FIELD]: { scope, material: prepared.material }, paperclipGrokHistoryStatus: "retained" };
  };
}
