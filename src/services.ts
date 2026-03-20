/**
 * Service manager — start Docker containers and Supabase.
 */

import { execSync } from "node:child_process";
import type { ServiceConfig, DockerServiceConfig, SupabaseServiceConfig } from "./config.js";
import { isSupabaseService, isDockerService, resolveVars } from "./config.js";
import { log } from "./logger.js";

export type ServiceOutputs = Record<string, Record<string, string>>;

export interface ServiceContext {
  repoPaths: Record<string, string>;
  serviceOutputs: ServiceOutputs;
}

export async function startServices(
  services: Record<string, ServiceConfig>,
  ctx: ServiceContext
): Promise<void> {
  for (const [name, svc] of Object.entries(services)) {
    if (isSupabaseService(svc)) {
      await startSupabase(name, svc, ctx);
    } else if (isDockerService(svc)) {
      await startDockerService(name, svc, ctx);
    } else {
      log.warn(`Unknown service type for '${name}' — skipping`);
    }
  }
}

async function startDockerService(
  name: string,
  svc: DockerServiceConfig,
  ctx: ServiceContext
): Promise<void> {
  log.step(`Starting service: ${name} (${svc.image})`);

  const ports = (svc.ports ?? [])
    .map((p) => {
      const ps = String(p);
      return ps.includes(":") ? `-p ${ps}` : `-p ${ps}:${ps}`;
    })
    .join(" ");

  const envFlags = Object.entries(svc.env ?? {})
    .map(([k, v]) => `-e ${k}=${resolveVars(v, ctx)}`)
    .join(" ");

  const volumeFlags = (svc.volumes ?? []).map((v) => `-v ${v}`).join(" ");

  try {
    execSync(`docker rm -f ${name} 2>/dev/null`, { stdio: "ignore" });
  } catch { /* ignore */ }

  const cmd = `docker run -d --name ${name} ${ports} ${envFlags} ${volumeFlags} ${svc.image}`;
  try {
    execSync(cmd, { timeout: 60_000 });
    log.success(`${name}: container started`);
  } catch (err) {
    log.error(`${name}: failed to start — ${err instanceof Error ? err.message : err}`);
    throw err;
  }

  if (svc.ready) {
    log.step(`${name}: waiting for health check...`);
    for (let i = 0; i < 30; i++) {
      try {
        execSync(`docker exec ${name} ${svc.ready}`, { timeout: 5000, stdio: "ignore" });
        log.success(`${name}: healthy`);
        const outputs: Record<string, string> = {};
        for (const p of svc.ports ?? []) {
          const ps = String(p);
          const port = ps.includes(":") ? ps.split(":")[0] : ps;
          outputs.port = port;
          outputs.url = `localhost:${port}`;
        }
        ctx.serviceOutputs[name] = outputs;
        return;
      } catch {
        await sleep(1000);
      }
    }
    log.warn(`${name}: health check timed out`);
  }
}

async function startSupabase(
  name: string,
  svc: SupabaseServiceConfig,
  ctx: ServiceContext
): Promise<void> {
  // Resolve the config path (may contain ${repos.name} references)
  const configPath = resolveVars(svc.config, ctx);
  log.step(`Starting Supabase (config: ${configPath})`);

  try {
    // Suppress Docker pull noise (stderr) — only capture stdout for connection info
    const output = execSync(`cd ${configPath} && npx supabase start 2>/dev/null`, {
      timeout: 600_000, // 10 min — first pull is slow
      encoding: "utf-8",
    });

    const outputs: Record<string, string> = {};
    const urlMatch = output.match(/API URL:\s*(http\S+)/);
    if (urlMatch) outputs.url = urlMatch[1];
    const anonMatch = output.match(/anon key:\s*(\S+)/);
    if (anonMatch) outputs.anon_key = anonMatch[1];
    const serviceRoleMatch = output.match(/service_role key:\s*(\S+)/);
    if (serviceRoleMatch) outputs.service_role_key = serviceRoleMatch[1];
    const dbUrlMatch = output.match(/DB URL:\s*(\S+)/);
    if (dbUrlMatch) outputs.db_url = dbUrlMatch[1];
    const studioMatch = output.match(/Studio URL:\s*(http\S+)/);
    if (studioMatch) outputs.studio_url = studioMatch[1];

    ctx.serviceOutputs[name] = outputs;

    log.success(`Supabase started`);
    if (outputs.url) log.info(`  API: ${outputs.url}`);
    if (outputs.db_url) log.info(`  DB: ${outputs.db_url}`);
  } catch (err) {
    log.error(`Supabase failed: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

export async function stopServices(services: Record<string, ServiceConfig>): Promise<void> {
  for (const [name, svc] of Object.entries(services)) {
    if (isSupabaseService(svc)) {
      try {
        const configPath = svc.config;
        execSync(`cd ${configPath} && npx supabase stop`, { timeout: 30_000, stdio: "ignore" });
        log.info(`Supabase stopped`);
      } catch { /* ignore */ }
    } else if (isDockerService(svc)) {
      try {
        execSync(`docker rm -f ${name}`, { timeout: 10_000, stdio: "ignore" });
        log.info(`${name}: stopped`);
      } catch { /* ignore */ }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
