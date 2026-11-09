import path from "node:path";
import type { Cipher } from "@kosan/core";
import { createJiti } from "jiti";
import type { KosanConfig } from "./types.js";

/**
 * Loads a `kosan.config.ts` (or `.js` / `.mjs`) file from the given path.
 *
 * Uses `jiti` so TypeScript config files are supported without a separate
 * build step.
 */
export async function loadConfig(configPath: string): Promise<KosanConfig> {
  const absolutePath = path.resolve(configPath);
  const jiti = createJiti(import.meta.url);

  let mod: unknown;
  try {
    mod = await jiti.import(absolutePath, { default: true });
  } catch (err) {
    throw new Error(`Failed to load config from "${absolutePath}": ${String(err)}`);
  }

  if (mod === null || typeof mod !== "object") {
    throw new Error(
      `Config file "${absolutePath}" must export a default object. Got: ${typeof mod}`,
    );
  }

  if (!("master" in mod) || (typeof mod.master !== "string" && !isObject(mod.master))) {
    throw new Error(`Config is missing required field: "master" (string or Sequelize options)`);
  }
  if (!("migrationsPath" in mod) || typeof mod.migrationsPath !== "string") {
    throw new Error(`Config is missing required field: "migrationsPath" (string)`);
  }

  const config: KosanConfig = { master: mod.master, migrationsPath: mod.migrationsPath };
  if ("migrationsTableName" in mod && typeof mod.migrationsTableName === "string") {
    config.migrationsTableName = mod.migrationsTableName;
  }
  if ("concurrency" in mod && typeof mod.concurrency === "number") {
    config.concurrency = mod.concurrency;
  }
  if ("cipher" in mod && mod.cipher !== undefined) {
    if (!isCipher(mod.cipher)) {
      throw new Error(`Config field "cipher" must have encrypt() and decrypt() functions`);
    }
    config.cipher = mod.cipher;
  }
  return config;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCipher(value: unknown): value is Cipher {
  return (
    isObject(value) && typeof value.encrypt === "function" && typeof value.decrypt === "function"
  );
}
