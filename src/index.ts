/**
 * devenv — Dev environment framework.
 * Public API for programmatic use.
 */

import { resolve } from "node:path";
import { parseConfig, parseConfigFromString, type DevEnvConfig } from "./config.js";
import { setupSystem } from "./system.js";
import { startServices, stopServices, type ServiceOutputs } from "./services.js";
import { cloneProject, setupProject, runProject, stopProjects, sortByDependencies } from "./projects.js";
import { log } from "./logger.js";

export { parseConfig, parseConfigFromString, type DevEnvConfig } from "./config.js";
export { log } from "./logger.js";

export interface DevEnvOptions {
  /** Working directory for cloned repos. Defaults to current dir. */
  workDir?: string;
  /** GitHub token for private repos. */
  githubToken?: string;
  /** Skip system setup (packages/runtimes). */
  skipSystem?: boolean;
}

export class DevEnv {
  private config: DevEnvConfig;
  private workDir: string;
  private githubToken?: string;
  private skipSystem: boolean;
  private serviceOutputs: ServiceOutputs = {};
  private projectDirs: Record<string, string> = {};

  constructor(configOrPath: string | DevEnvConfig, options?: DevEnvOptions) {
    if (typeof configOrPath === "string") {
      // Check if it's YAML content or a file path
      if (configOrPath.includes("\n") || configOrPath.includes("projects:")) {
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

  /** Full setup: system → services → clone → build → run */
  async up(): Promise<void> {
    log.header(`🚀 devenv up: ${this.config.name}`);

    if (!this.skipSystem) {
      await this.system();
    }
    await this.services();
    await this.clone();
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

  /** Start all services */
  async services(): Promise<void> {
    if (this.config.services && Object.keys(this.config.services).length > 0) {
      log.header("🐳 Starting services");
      await startServices(this.config.services, this.serviceOutputs);
    }
  }

  /** Clone all project repos */
  async clone(): Promise<void> {
    log.header("📥 Cloning projects");
    for (const [name, proj] of Object.entries(this.config.projects)) {
      const dir = await cloneProject(name, proj, this.workDir, this.githubToken);
      this.projectDirs[name] = dir;
    }
  }

  /** Run setup commands for all projects (in dependency order) */
  async build(): Promise<void> {
    log.header("🔨 Building projects");
    const sorted = sortByDependencies(this.config.projects, this.config.services ?? {});
    for (const [name, proj] of sorted) {
      const dir = this.projectDirs[name];
      if (dir) {
        await setupProject(name, proj, dir, this.serviceOutputs);
      }
    }
  }

  /** Start all projects (in dependency order) */
  async start(): Promise<void> {
    log.header("▶️ Starting projects");
    const sorted = sortByDependencies(this.config.projects, this.config.services ?? {});
    for (const [name, proj] of sorted) {
      const dir = this.projectDirs[name];
      if (dir) {
        await runProject(name, proj, dir, this.serviceOutputs);
      }
    }
  }

  /** Stop everything */
  async down(): Promise<void> {
    log.header("⏹ Stopping everything");
    stopProjects();
    if (this.config.services) {
      await stopServices(this.config.services);
    }
    log.success("All stopped");
  }

  /** Print current status */
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

  /** Get resolved service outputs (URLs, keys, etc.) */
  getServiceOutputs(): ServiceOutputs {
    return this.serviceOutputs;
  }

  /** Get project directories */
  getProjectDirs(): Record<string, string> {
    return this.projectDirs;
  }
}
