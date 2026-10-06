import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDurableDirectory } from "../lib/durable-directory.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("durable directory creation", () => {
  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-durable-directory-"));
    roots.push(root);
    return { root, directory: path.join(root, "instance", "recovery", "company") };
  }

  function observeSyncs(failOn?: string) {
    const synced: string[] = [];
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        if (args[0] === failOn) throw new Error("Injected directory fsync failure");
        await sync();
        synced.push(String(args[0]));
      });
      return handle;
    });
    return synced;
  }

  it("flushes every created path entry and avoids ancestor fsyncs on subsequent writes", async () => {
    const { root, directory } = await fixture();
    const synced = observeSyncs();
    await ensureDurableDirectory(directory);
    expect(synced.slice(0, 4)).toEqual([directory, path.dirname(directory), path.join(root, "instance"), root]);
    synced.length = 0;
    await ensureDurableDirectory(directory);
    expect(synced).toEqual([]);
    await fs.rm(directory, { recursive: true });
    await ensureDurableDirectory(directory);
    expect(synced.slice(0, 4)).toEqual([directory, path.dirname(directory), path.join(root, "instance"), root]);
  });

  it("allows an existing storage root beneath a parent that cannot be opened for reading", async () => {
    const { root, directory } = await fixture();
    const storage = path.join(root, "instance");
    await fs.mkdir(storage);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === root) throw Object.assign(new Error("execute-only ancestor"), { code: "EACCES" });
      return open(...args);
    });
    await expect(ensureDurableDirectory(directory)).resolves.toBeUndefined();
    expect((await fs.stat(directory)).isDirectory()).toBe(true);
  });

  it("requires permission to flush a newly created entry's parent, including on retry", async () => {
    const { root, directory } = await fixture();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === root) throw Object.assign(new Error("write-only creation parent"), { code: "EACCES" });
      return open(...args);
    });
    await expect(ensureDurableDirectory(directory)).rejects.toMatchObject({ code: "EACCES" });
    // mkdir now succeeds without creating anything. Its first attempt still
    // owes a parent flush, so a retry cannot silently acknowledge that path.
    await expect(ensureDurableDirectory(directory)).rejects.toMatchObject({ code: "EACCES" });
    vi.restoreAllMocks();
    const synced = observeSyncs();
    await ensureDurableDirectory(directory);
    expect(synced).toContain(root);
  });

  it("retries all ancestors after a failed flush even though mkdir already succeeded", async () => {
    const { root, directory } = await fixture();
    observeSyncs(root);
    await expect(ensureDurableDirectory(directory)).rejects.toThrow("Injected directory fsync failure");
    expect((await fs.stat(directory)).isDirectory()).toBe(true);
    vi.restoreAllMocks();
    const synced = observeSyncs();
    await ensureDurableDirectory(directory);
    expect(synced).toContain(root);
    expect(synced).toContain(path.dirname(root));
  });

  it.each([false, true])("keeps a shared parent flush required for sibling writes (first call pending: %s)", async (concurrent) => {
    const { root, directory } = await fixture();
    const sibling = path.join(path.dirname(directory), "other-company");
    const open = fs.open.bind(fs);
    let releaseFirst!: () => void;
    let reachedParent!: () => void;
    const held = new Promise<void>(resolve => { releaseFirst = resolve; });
    const reached = new Promise<void>(resolve => { reachedParent = resolve; });
    let firstParent = true;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === root) {
        if (firstParent) {
          firstParent = false;
          reachedParent();
          if (concurrent) await held;
        }
        throw Object.assign(new Error("unflushed shared parent"), { code: "EACCES" });
      }
      return open(...args);
    });
    const first = ensureDurableDirectory(directory).then(() => null, error => error);
    try {
      await reached;
      if (!concurrent) expect(await first).toMatchObject({ code: "EACCES" });
      await expect(ensureDurableDirectory(sibling)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      releaseFirst();
      await first;
    }
    vi.restoreAllMocks();
    const synced = observeSyncs();
    await ensureDurableDirectory(sibling);
    expect(synced).toContain(root);
    await ensureDurableDirectory(directory);
    synced.length = 0;
    await ensureDurableDirectory(sibling);
    await ensureDurableDirectory(directory);
    expect(synced).toEqual([]);
  });
});
