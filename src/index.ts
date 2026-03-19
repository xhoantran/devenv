/**
 * devenv — Dev environment framework.
 * Public API for programmatic use.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseConfig, parseConfigFromString, type DevEnvConfig, type RepoConfig } from "./config.js";
import { setupSystem } from "./system.js";
import { startServices, stopServices, type ServiceOutputs, type ServiceContext } from "./services.js";
import { setupProject, runProject, stopProjects, sortByDependencies } from "./projects.js";
import { log } from "./logger.js";

export { parseConfig, parseConfigFromString, type DevEnvConfig } from "./config.js";
export { log } from "./logger.js";

export interface DevEnvOptions {
  workDir?: string;
  githubToken?: string;
  skipSystem?: boolean;
}

export class DevEnv {
  private config: DevEnvConfig;
  private workDir: string;
  private githubToken?: string;
  private skipSystem: boolean;
  private serviceOutputs: ServiceOutputs = {};
  private repoPaths: Record<string, string> = {};

  constructor(configOrPath: string | DevEnvConfig, options?: DevEnvOptions) {
    if (typeof configOrPath === "string") {
      if (configOrPath.includes("\n") || configOrPath.includes("repos:")) {
        this.config = parseConfigFromString(configOrPath);
      } else {
        this.config = parseConfig(configOrPath);
      }
    } else {
      this.config = configOrPath;
    }

    this.workDir = resolve(options?.workDir ?? ".");
    this.githubToken = options?.githubToken;
    this.skipSystem = options?.skipSystem ?? false;
  }

  /** Full setup: system → repos → services → build → run */
  async up(): Promise<void> {
    log.header(`🚀 devenv up: ${this.config.name}`);

    if (!this.skipSystem && this.config.system) {
      await this.system();
    }
    await this.cloneRepos();
    await this.services();
    await this.build();
    await this.start();

    log.header("✅ Environment ready");
    this.printStatus();
  }

  /** Install system packages and runtimes */
  async system(): Promise<void> {
    if (this.config.system) {
      log.header("📦 System setup");
      await setupSystem(this.config.system);
    }
  }

  /** Clone all repos defined in the repos section */
  async cloneRepos(): Promise<void> {
    log.header("📥 Cloning repos");
    for (const [name, repo] of Object.entries(this.config.repos)) {
      const targetDir = join(this.workDir, name);

      if (existsSync(targetDir)) {
        log.info(`${name}: already exists at ${targetDir}`);
        this.repoPaths[name] = targetDir;
        continue;
      }

      log.step(`${name}: cloning ${repo.url}`);
      let repoUrl = repo.url;
      if (this.githubToken && repoUrl.startsWith("https://github.com/")) {
        repoUrl = repoUrl.replace("https://github.com/", `https://x-access-token:${this.githubToken}@github.com/`);
      }

      const branch = repo.branch ?? "main";
      execSync(`git clone --depth 1 --branch ${branch} ${repoUrl} ${targetDir}`, {
        timeout: 300_000,
        stdio: "pipe",
      });
      log.success(`${name}: cloned`);
      this.repoPaths[name] = targetDir;
    }
  }

  /** Start all services */
  async services(): Promise<void> {
    if (this.config.services && Object.keys(this.config.services).length > 0) {
      log.header("🐳 Starting services");
      const ctx: ServiceContext = {
        repoPaths: this.repoPaths,
        serviceOutputs: this.serviceOutputs,
      };
      await startServices(this.config.services, ctx);
    }
  }

  /** Run setup commands for all projects */
  async build(): Promise<void> {
    log.header("🔨 Building projects");
    const ctx: ServiceContext = { repoPaths: this.repoPaths, serviceOutputs: this.serviceOutputs };
    const sorted = sortByDependencies(this.config.projects, this.config.services ?? {});
    for (const [name, proj] of sorted) {
      const dir = this.repoPaths[proj.repo];
      if (!dir) {
        log.warn(`${name}: repo '${proj.repo}' not found in repos section — skipping`);
        continue;
      }
      await setupProject(name, proj, dir, ctx);
    }
  }

  /** Start all projects */
  async start(): Promise<void> {
    log.header("▶️  Starting projects");
    const ctx: ServiceContext = { repoPaths: this.repoPaths, serviceOutputs: this.serviceOutputs };
    const sorted = sortByDependencies(this.config.projects, this.config.services ?? {});
    for (const [name, proj] of sorted) {
      const dir = this.repoPaths[proj.repo];
      if (!dir) continue;
      await runProject(name, proj, dir, ctx);
    }
  }

  /** Stop everything */
  async down(): Promise<void> {
    log.header("⏹  Stopping everything");
    stopProjects();
    if (this.config.services) {
      await stopServices(this.config.services);
    }
    log.success("All stopped");
  }

  /** Print status */
  printStatus(): void {
    log.header("📊 Status");
    for (const [name, outputs] of Object.entries(this.serviceOutputs)) {
      log.info(`${name}: ${outputs.url ?? "running"}`);
    }
    for (const [name, proj] of Object.entries(this.config.projects)) {
      const status = proj.run === "skip" ? "skipped" : proj.port ? `http://localhost:${proj.port}` : "running";
      log.info(`${name}: ${status}`);
    }
  }

  getServiceOutputs(): ServiceOutputs { return this.serviceOutputs; }
  getRepoPaths(): Record<string, string> { return this.repoPaths; }
}
