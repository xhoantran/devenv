/**
 * devenv.yml config parser and types.
 */

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// ─── Types ──────────────────────────────────────────────────

export interface SystemConfig {
  packages?: string[];
  runtimes?: Record<string, string | number>; // e.g., { java: 25, node: 22 }
}

export interface DockerServiceConfig {
  image: string;
  ports?: (number | string)[];
  env?: Record<string, string>;
  volumes?: string[];
  ready?: string; // health check command
}

export interface SupabaseServiceConfig {
  type: "supabase";
  config: string; // path to supabase config dir
}

export type ServiceConfig = DockerServiceConfig | SupabaseServiceConfig;

export interface ProjectConfig {
  repo: string;
  branch?: string;
  path?: string; // resolved at runtime (clone dir)
  runtime: string; // java, node, python, go, rust, docker
  setup?: string;
  run?: string; // "skip" to skip
  port?: number;
  depends_on?: string[];
  env?: Record<string, string>;
  env_file?: string;
}

export interface DevEnvConfig {
  name: string;
  system?: SystemConfig;
  services?: Record<string, ServiceConfig>;
  projects: Record<string, ProjectConfig>;
}

// ─── Type guards ────────────────────────────────────────────

export function isSupabaseService(svc: ServiceConfig): svc is SupabaseServiceConfig {
  return "type" in svc && svc.type === "supabase";
}

export function isDockerService(svc: ServiceConfig): svc is DockerServiceConfig {
  return "image" in svc;
}

// ─── Parser ─────────────────────────────────────────────────

export function parseConfig(filePath: string): DevEnvConfig {
  const raw = readFileSync(filePath, "utf-8");
  return parseConfigFromString(raw);
}

export function parseConfigFromString(content: string): DevEnvConfig {
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid devenv.yml: must be a YAML object");
  }

  if (!raw.projects || typeof raw.projects !== "object") {
    throw new Error("Invalid devenv.yml: 'projects' section is required");
  }

  return {
    name: (raw.name as string) ?? "devenv",
    system: raw.system as SystemConfig | undefined,
    services: raw.services as Record<string, ServiceConfig> | undefined,
    projects: raw.projects as Record<string, ProjectConfig>,
  };
}

// ─── Variable resolution ────────────────────────────────────

/**
 * Resolve ${VAR} references in a string.
 * Supports:
 *   ${ENV_VAR}          — from process.env
 *   ${service.key}      — from resolved service outputs
 */
export function resolveVars(
  value: string,
  serviceOutputs: Record<string, Record<string, string>>
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, ref: string) => {
    // Check if it's a service reference: ${supabase.url}
    if (ref.includes(".")) {
      const [svcName, key] = ref.split(".", 2);
      return serviceOutputs[svcName]?.[key] ?? "";
    }
    // Otherwise, env var
    return process.env[ref] ?? "";
  });
}

/**
 * Resolve all env vars in a record.
 */
export function resolveEnvMap(
  env: Record<string, string> | undefined,
  serviceOutputs: Record<string, Record<string, string>>
): Record<string, string> {
  if (!env) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveVars(value, serviceOutputs);
  }
  return resolved;
}
