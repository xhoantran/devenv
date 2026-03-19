/**
 * Project manager — clone, setup, and run projects.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectConfig } from "./config.js";
import { resolveEnvMap } from "./config.js";
import type { ServiceOutputs } from "./services.js";
import { log } from "./logger.js";

const runningProcesses: Map<string, ChildProcess> = new Map();

// ─── Runtime command builders ───────────────────────────────

function buildCommand(runtime: string, cmd: string, projectDir: string): string {
  const rt = runtime.toLowerCase();

  // Node — run directly
  if (rt === "node" || rt.startsWith("node:")) {
    return cmd;
  }

  // Java — use Docker Maven image
  if (rt === "java" || rt.startsWith("java:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "25";
    return `docker run --rm --network host -v ${projectDir}:/app -w /app maven:3.9-amazoncorretto-${version} ${cmd}`;
  }

  // Python — use Docker Python image
  if (rt === "python" || rt.startsWith("python:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "3.12";
    return `docker run --rm --network host -v ${projectDir}:/app -w /app python:${version} ${cmd}`;
  }

  // Go — use Docker Go image
  if (rt === "go" || rt.startsWith("go:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "1.23";
    return `docker run --rm --network host -v ${projectDir}:/app -w /app golang:${version} ${cmd}`;
  }

  // Docker — use project's Dockerfile
  if (rt === "docker") {
    return cmd;
  }

  // Terraform, make, etc. — run directly
  return cmd;
}

// ─── Clone ──────────────────────────────────────────────────

export async function cloneProject(
  name: string,
  project: ProjectConfig,
  workDir: string,
  token?: string
): Promise<string> {
  const targetDir = join(workDir, name);

  if (existsSync(targetDir)) {
    log.info(`${name}: already cloned at ${targetDir}`);
    return targetDir;
  }

  log.step(`${name}: cloning ${project.repo}`);

  let repoUrl = project.repo;
  if (token && repoUrl.startsWith("https://github.com/")) {
    repoUrl = repoUrl.replace("https://github.com/", `https://x-access-token:${token}@github.com/`);
  }

  const branch = project.branch ?? "main";
  execSync(`git clone --depth 1 --branch ${branch} ${repoUrl} ${targetDir}`, {
    timeout: 300_000,
    stdio: "pipe",
  });

  log.success(`${name}: cloned`);
  return targetDir;
}

// ─── Setup ──────────────────────────────────────────────────

export async function setupProject(
  name: string,
  project: ProjectConfig,
  projectDir: string,
  serviceOutputs: ServiceOutputs
): Promise<void> {
  if (!project.setup || project.setup === "skip") {
    log.info(`${name}: no setup command — skipping`);
    return;
  }

  log.step(`${name}: running setup — ${project.setup}`);

  const envMap = resolveEnvMap(project.env, serviceOutputs);

  // Load env_file if specified
  if (project.env_file) {
    const envFilePath = join(projectDir, project.env_file);
    if (existsSync(envFilePath)) {
      const content = readFileSync(envFilePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          envMap[key] = rest.join("=").replace(/^["']|["']$/g, "");
        }
      }
    }
  }

  const cmd = buildCommand(project.runtime, project.setup, projectDir);

  try {
    execSync(cmd, {
      cwd: projectDir,
      timeout: 600_000, // 10 min for builds
      env: { ...process.env, ...envMap },
      stdio: "inherit",
      maxBuffer: 50 * 1024 * 1024,
    });
    log.success(`${name}: setup completed`);
  } catch (err) {
    log.error(`${name}: setup failed — ${err instanceof Error ? err.message.slice(0, 300) : err}`);
    throw err;
  }
}

// ─── Run ────────────────────────────────────────────────────

export async function runProject(
  name: string,
  project: ProjectConfig,
  projectDir: string,
  serviceOutputs: ServiceOutputs
): Promise<void> {
  if (!project.run || project.run === "skip") {
    log.info(`${name}: no run command — skipping`);
    return;
  }

  log.step(`${name}: starting — ${project.run}`);

  const envMap = resolveEnvMap(project.env, serviceOutputs);
  const cmd = buildCommand(project.runtime, project.run, projectDir);

  const child = spawn("sh", ["-c", cmd], {
    cwd: projectDir,
    detached: true,
    env: { ...process.env, ...envMap },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningProcesses.set(name, child);
  child.unref();

  // Wait briefly and check it's running
  await sleep(3000);
  const running = !child.killed && child.exitCode === null;

  if (running) {
    log.success(`${name}: running (PID ${child.pid})`);
    if (project.port) {
      log.info(`  → http://localhost:${project.port}`);
    }
  } else {
    log.warn(`${name}: process exited with code ${child.exitCode}`);
  }
}

// ─── Stop ───────────────────────────────────────────────────

export function stopProjects(): void {
  for (const [name, child] of runningProcesses) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      log.info(`${name}: stopped`);
    } catch { /* ignore */ }
  }
  runningProcesses.clear();
}

// ─── Dependency sort ────────────────────────────────────────

export function sortByDependencies(
  projects: Record<string, ProjectConfig>,
  services: Record<string, unknown>
): Array<[string, ProjectConfig]> {
  const entries = Object.entries(projects);
  const resolved = new Set<string>(Object.keys(services ?? {}));
  const sorted: Array<[string, ProjectConfig]> = [];
  const remaining = new Map(entries);

  let iterations = 0;
  while (remaining.size > 0 && iterations < 100) {
    for (const [name, proj] of remaining) {
      const deps = proj.depends_on ?? [];
      if (deps.every((d) => resolved.has(d))) {
        sorted.push([name, proj]);
        resolved.add(name);
        remaining.delete(name);
      }
    }
    iterations++;
  }

  // Add any remaining (circular deps or missing deps)
  for (const entry of remaining) {
    sorted.push(entry);
  }

  return sorted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
