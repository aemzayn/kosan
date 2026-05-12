import path from 'node:path';
import { createJiti } from 'jiti';
import type { HuniConfig } from './types.js';

/**
 * Loads a `huni.config.ts` (or `.js` / `.mjs`) file from the given path.
 *
 * Uses `jiti` so TypeScript config files are supported without a separate
 * build step.
 */
export async function loadConfig(configPath: string): Promise<HuniConfig> {
  const absolutePath = path.resolve(configPath);
  const jiti = createJiti(import.meta.url, { interopDefault: true });

  let mod: unknown;
  try {
    mod = await jiti.import(absolutePath);
  } catch (err) {
    throw new Error(`Failed to load config from "${absolutePath}": ${String(err)}`);
  }

  if (mod === null || typeof mod !== 'object') {
    throw new Error(
      `Config file "${absolutePath}" must export a default object. Got: ${typeof mod}`,
    );
  }

  const config = mod as Record<string, unknown>;
  if (typeof config['master'] === 'undefined') {
    throw new Error(`Config is missing required field: "master"`);
  }
  if (typeof config['migrationsPath'] !== 'string') {
    throw new Error(`Config is missing required field: "migrationsPath" (string)`);
  }

  return config as unknown as HuniConfig;
}
