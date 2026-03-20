#!/usr/bin/env node
/**
 * devenv CLI — bring up dev environments from a devenv.yml config.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { DevEnv } from "./index.js";
import { log, setLogLevel } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

const program = new Command()
  .name("devenv")
  .description("Dev environment framework — bare metal to running workspace")
  .version(pkg.version)
  .option("-v, --verbose", "Show detailed output (debug mode)")
  .hook("preAction", () => {
    if (program.opts().verbose) setLogLevel("debug");
  });

program
  .command("up")
  .description("Start the full environment (services + projects)")
  .option("-c, --config <path>", "Config file path", "devenv.yml")
  .option("-d, --dir <path>", "Working directory for cloned repos", ".")
  .option("-t, --token <token>", "GitHub token for private repos")
  .option("--skip-system", "Skip system package installation")
  .action(async (opts) => {
    try {
      const env = new DevEnv(opts.config, {
        workDir: opts.dir,
        githubToken: opts.token ?? process.env.GITHUB_TOKEN,
        skipSystem: opts.skipSystem,
      });
      await env.up();
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("down")
  .description("Stop all services and projects")
  .option("-c, --config <path>", "Config file path", "devenv.yml")
  .action(async (opts) => {
    try {
      const env = new DevEnv(opts.config);
      await env.down();
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("services")
  .description("Start services only (Docker containers + Supabase)")
  .option("-c, --config <path>", "Config file path", "devenv.yml")
  .action(async (opts) => {
    try {
      const env = new DevEnv(opts.config);
      await env.services();
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show environment status")
  .option("-c, --config <path>", "Config file path", "devenv.yml")
  .action(async (opts) => {
    try {
      const env = new DevEnv(opts.config);
      env.printStatus();
    } catch (err) {
      log.error(`Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program.parse();
