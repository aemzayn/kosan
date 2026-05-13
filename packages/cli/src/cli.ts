#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { printResults, runMigrate } from './commands/migrate.js';

const program = new Command();

program
  .name('kosan')
  .description('Kosan CLI — multi-tenant database tooling')
  .version('0.1.0');

program
  .command('migrate')
  .description('Run pending migrations across all active tenants (or a specific one)')
  .requiredOption('-c, --config <path>', 'Path to kosan.config.ts / .js', 'kosan.config.ts')
  .option('-n, --concurrency <n>', 'Max parallel tenant migrations', '4')
  .option('-t, --tenant <slug>', 'Migrate only this tenant slug')
  .action(async (opts: { config: string; concurrency: string; tenant?: string }) => {
    let config;
    try {
      config = await loadConfig(opts.config);
    } catch (err) {
      console.error(`[kosan] Config error: ${String(err)}`);
      process.exit(1);
    }

    const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 4);
    const configDir = path.dirname(path.resolve(opts.config));
    const migrationsDir = path.resolve(configDir, config.migrationsPath);

    const results = await runMigrate({
      config,
      migrationsDir,
      concurrency,
      tenant: opts.tenant,
    });

    if (results.length > 0) {
      printResults(results);
    }

    const failed = results.filter((r) => r.outcome === 'failed').length;
    process.exit(failed > 0 ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`[kosan] Unexpected error: ${String(err)}`);
  process.exit(1);
});
