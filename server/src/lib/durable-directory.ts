import { promises as fs } from "node:fs";
import path from "node:path";

// These application-owned directories are stable after creation. Check their
// identity on reuse, so deleting/recreating one cannot reuse its durability proof.
const durableDirectories = new Map<string, string>();
// Track every entry in a newly created path, including shared ancestors, before
// mkdir. Retries and sibling writes must retain an unfinished parent flush.
const pendingAncestors = new Map<string, string>();

function pendingAncestor(directory: string) {
  let required: string | undefined;
  for (let current = directory; ; current = path.dirname(current)) {
    const pending = pendingAncestors.get(current);
    if (pending && (!required || pending.length < required.length)) required = pending;
    if (path.dirname(current) === current) return required;
  }
}

function rememberPendingPath(directory: string, ancestor: string) {
  const remember = (entry: string) => {
    const pending = pendingAncestors.get(entry);
    if (!pending || ancestor.length < pending.length) pendingAncestors.set(entry, ancestor);
  };
  for (let current = directory; ; current = path.dirname(current)) {
    remember(current);
    if (current === ancestor || path.dirname(current) === ancestor) break;
  }
}

export async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function existingAncestor(directory: string) {
  for (let current = directory; ; current = path.dirname(current)) {
    try { return { directory: current, stat: await fs.stat(current, { bigint: true }) }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(current) === current) throw error;
    }
  }
}

/** Flush every newly created path entry before acknowledging a file write.
 * Existing accessible ancestors are also flushed after failed/interrupted work,
 * but an execute-only ancestor above the creation boundary needs no read access. */
export async function ensureDurableDirectory(directory: string) {
  const resolved = path.resolve(directory);
  if (process.platform === "win32") {
    await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
    return;
  }
  const existing = await existingAncestor(resolved);
  const identity = (stat: typeof existing.stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  const pending = pendingAncestor(resolved);
  if (!pending && existing.directory === resolved && durableDirectories.get(resolved) === identity(existing.stat)) return;
  let requiredAncestor = pending && pending.length < existing.directory.length ? pending : existing.directory;
  rememberPendingPath(resolved, requiredAncestor);
  const created = await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
  if (created && path.dirname(created).length < requiredAncestor.length) {
    requiredAncestor = path.dirname(created);
    rememberPendingPath(resolved, requiredAncestor);
  }
  const stat = await fs.stat(resolved, { bigint: true });
  let requiredFlushed = false;
  const flushed = new Set<string>();
  for (let current = resolved; ; current = path.dirname(current)) {
    try { await syncDirectory(current); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Never skip the parent of a newly created entry (or its failed retry).
      // Only pre-existing ancestors outside that tree may be execute-only.
      if (requiredFlushed && (code === "EACCES" || code === "EPERM")) break;
      throw error;
    }
    flushed.add(current);
    if (current === requiredAncestor) requiredFlushed = true;
    if (path.dirname(current) === current) break;
  }
  for (let current = resolved; ; current = path.dirname(current)) {
    const required = pendingAncestors.get(current);
    if (required && flushed.has(required)) pendingAncestors.delete(current);
    if (path.dirname(current) === current) break;
  }
  // Bound successful-path bookkeeping across companies and custom spool paths.
  if (durableDirectories.size >= 1024) durableDirectories.delete(durableDirectories.keys().next().value!);
  durableDirectories.set(resolved, identity(stat));
}
