/**
 * Project manager — setup and run projects using pre-cloned repos.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "./config.js";
import { resolveEnvMap } from "./config.js";
import type { ServiceContext } from "./services.js";
import { log } from "./logger.js";

const runningProcesses: Map<string, ChildProcess> = new Map();

// ─── Runtime command builders ───────────────────────────────

function buildCommand(runtime: string, cmd: string, projectDir: string): string {
  const rt = runtime.toLowerCase();
  // Resolve cache dir relative to workDir (parent of projectDir) for persistence
  const cacheBase = join(projectDir, "..");

  if (rt === "node" || rt.startsWith("node:")) return cmd;

  if (rt === "java" || rt.startsWith("java:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "25";
    return `docker run --rm --network host -v ${projectDir}:/app -v ${cacheBase}/.m2:/root/.m2 -w /app maven:3.9-amazoncorretto-${version} ${cmd}`;
  }

  if (rt === "python" || rt.startsWith("python:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "3.12";
    return `docker run --rm --network host -v ${projectDir}:/app -v ${cacheBase}/.pip-cache:/root/.cache/pip -w /app python:${version} ${cmd}`;
  }

  if (rt === "go" || rt.startsWith("go:")) {
    const version = rt.includes(":") ? rt.split(":")[1] : "1.23";
    return `docker run --rm --network host -v ${projectDir}:/app -v ${cacheBase}/.go-cache:/go/pkg -w /app golang:${version} ${cmd}`;
  }

  return cmd;
}

// ─── Setup ──────────────────────────────────────────────────

export async function setupProject(
  name: string,
  project: ProjectConfig,
  projectDir: string,
  ctx: ServiceContext
): Promise<void> {
  if (!project.setup || project.setup === "skip") {
    log.info(`${name}: no setup — skipping`);
    return;
  }

  log.step(`${name}: setup — ${project.setup}`);

  const envMap = resolveEnvMap(project.env, ctx);

  if (project.env_file) {
    const envFilePath = join(projectDir, project.env_file);
    if (existsSync(envFilePath)) {
      for (const line of readFileSync(envFilePath, "utf-8").split("\n")) {
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
      timeout: 600_000,
      env: { ...process.env, ...envMap },
      stdio: "inherit",
      maxBuffer: 50 * 1024 * 1024,
    });
    log.success(`${name}: setup done`);
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
  ctx: ServiceContext
): Promise<void> {
  if (!project.run || project.run === "skip") {
    log.info(`${name}: no run command — skipping`);
    return;
  }

  log.step(`${name}: starting — ${project.run}`);

  const envMap = resolveEnvMap(project.env, ctx);
  const cmd = buildCommand(project.runtime, project.run, projectDir);

  const child = spawn("sh", ["-c", cmd], {
    cwd: projectDir,
    detached: true,
    env: { ...process.env, ...envMap },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningProcesses.set(name, child);
  child.unref();

  await sleep(3000);
  const running = !child.killed && child.exitCode === null;

  if (running) {
    log.success(`${name}: running (PID ${child.pid})`);
    if (project.port) log.info(`  → http://localhost:${project.port}`);
  } else {
    log.warn(`${name}: exited with code ${child.exitCode}`);
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
  const resolved = new Set<string>(Object.keys(services ?? {}));
  const sorted: Array<[string, ProjectConfig]> = [];
  const remaining = new Map(Object.entries(projects));

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

  for (const entry of remaining) sorted.push(entry);
  return sorted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
