import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kosan-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, contents: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, contents);
    return file;
  }

  it("loads a TypeScript config with a default export", async () => {
    const file = write(
      "kosan.config.ts",
      `const config: { master: string; migrationsPath: string; concurrency: number } = {
        master: 'sqlite::memory:',
        migrationsPath: './migrations',
        concurrency: 2,
      };
      export default config;`,
    );

    await expect(loadConfig(file)).resolves.toEqual({
      master: "sqlite::memory:",
      migrationsPath: "./migrations",
      concurrency: 2,
    });
  });

  it("accepts Sequelize options as master", async () => {
    const file = write(
      "kosan.config.mjs",
      `export default { master: { dialect: 'sqlite', storage: ':memory:' }, migrationsPath: 'm' };`,
    );

    const config = await loadConfig(file);
    expect(config.master).toEqual({ dialect: "sqlite", storage: ":memory:" });
  });

  it("rejects a config without master", async () => {
    const file = write("kosan.config.mjs", `export default { migrationsPath: 'm' };`);
    await expect(loadConfig(file)).rejects.toThrow(/"master"/);
  });

  it("rejects a config without migrationsPath", async () => {
    const file = write("kosan.config.mjs", `export default { master: 'sqlite::memory:' };`);
    await expect(loadConfig(file)).rejects.toThrow(/"migrationsPath"/);
  });

  it("passes a cipher through to the config", async () => {
    const file = write(
      "kosan.config.mjs",
      `export default {
        master: 'sqlite::memory:',
        migrationsPath: 'm',
        cipher: { encrypt: async (p) => p, decrypt: async (p) => p.toUpperCase() },
      };`,
    );
    const config = await loadConfig(file);
    await expect(config.cipher?.decrypt("pw")).resolves.toBe("PW");
  });

  it("rejects a cipher without encrypt/decrypt", async () => {
    const file = write(
      "kosan.config.mjs",
      `export default { master: 'sqlite::memory:', migrationsPath: 'm', cipher: {} };`,
    );
    await expect(loadConfig(file)).rejects.toThrow(/"cipher"/);
  });

  it("reports a missing file with its path", async () => {
    const missing = path.join(dir, "nope.config.ts");
    await expect(loadConfig(missing)).rejects.toThrow(/Failed to load config/);
  });
});
