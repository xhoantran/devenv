/**
 * Service manager — start Docker containers and Supabase.
 */

import { execSync } from "node:child_process";
import type { ServiceConfig, DockerServiceConfig, SupabaseServiceConfig } from "./config.js";
import { isSupabaseService, isDockerService, resolveVars } from "./config.js";
import { log } from "./logger.js";

/** Outputs from services (e.g., supabase.url, supabase.anon_key) */
export type ServiceOutputs = Record<string, Record<string, string>>;

export async function startServices(
  services: Record<string, ServiceConfig>,
  serviceOutputs: ServiceOutputs
): Promise<void> {
  for (const [name, svc] of Object.entries(services)) {
    if (isSupabaseService(svc)) {
      await startSupabase(name, svc, serviceOutputs);
    } else if (isDockerService(svc)) {
      await startDockerService(name, svc, serviceOutputs);
    } else {
      log.warn(`Unknown service type for '${name}' — skipping`);
    }
  }
}

async function startDockerService(
  name: string,
  svc: DockerServiceConfig,
  serviceOutputs: ServiceOutputs
): Promise<void> {
  log.step(`Starting service: ${name} (${svc.image})`);

  // Build docker run command
  const ports = (svc.ports ?? [])
    .map((p) => {
      const ps = String(p);
      return ps.includes(":") ? `-p ${ps}` : `-p ${ps}:${ps}`;
    })
    .join(" ");

  const envFlags = Object.entries(svc.env ?? {})
    .map(([k, v]) => `-e ${k}=${resolveVars(v, serviceOutputs)}`)
    .join(" ");

  const volumeFlags = (svc.volumes ?? []).map((v) => `-v ${v}`).join(" ");

  // Stop existing container with same name (idempotent)
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

  // Health check
  if (svc.ready) {
    log.step(`${name}: waiting for health check...`);
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        execSync(`docker exec ${name} ${svc.ready}`, { timeout: 5000, stdio: "ignore" });
        log.success(`${name}: healthy`);

        // Store service outputs (port mappings)
        const outputs: Record<string, string> = {};
        for (const p of svc.ports ?? []) {
          const ps = String(p);
          const port = ps.includes(":") ? ps.split(":")[0] : ps;
          outputs.port = port;
          outputs.url = `localhost:${port}`;
        }
        serviceOutputs[name] = outputs;
        return;
      } catch {
        await sleep(1000);
      }
    }
    log.warn(`${name}: health check timed out after ${maxRetries}s`);
  }
}

async function startSupabase(
  name: string,
  svc: SupabaseServiceConfig,
  serviceOutputs: ServiceOutputs
): Promise<void> {
  log.step(`Starting Supabase (config: ${svc.config})`);

  try {
    const output = execSync(`cd ${svc.config} && npx supabase start`, {
      timeout: 300_000, // 5 min — supabase start can be slow
      encoding: "utf-8",
    });

    // Parse supabase start output for connection info
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

    serviceOutputs[name] = outputs;

    log.success(`Supabase started`);
    if (outputs.url) log.info(`  API URL: ${outputs.url}`);
    if (outputs.studio_url) log.info(`  Studio: ${outputs.studio_url}`);
    if (outputs.db_url) log.info(`  DB URL: ${outputs.db_url}`);
  } catch (err) {
    log.error(`Supabase failed to start: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

export async function stopServices(services: Record<string, ServiceConfig>): Promise<void> {
  for (const [name, svc] of Object.entries(services)) {
    if (isSupabaseService(svc)) {
      try {
        execSync(`cd ${svc.config} && npx supabase stop`, { timeout: 30_000, stdio: "ignore" });
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
