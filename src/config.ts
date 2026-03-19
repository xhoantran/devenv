/**
 * devenv.yml config parser and types.
 */

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// ─── Types ──────────────────────────────────────────────────

export interface RepoConfig {
  url: string;
  branch?: string;
}

export interface SystemConfig {
  packages?: string[];
  runtimes?: Record<string, string | number>;
}

export interface DockerServiceConfig {
  image: string;
  ports?: (number | string)[];
  env?: Record<string, string>;
  volumes?: string[];
  ready?: string;
}

export interface SupabaseServiceConfig {
  type: "supabase";
  config: string; // path — can use ${repos.name} references
}

export type ServiceConfig = DockerServiceConfig | SupabaseServiceConfig;

export interface ProjectConfig {
  repo: string; // references a key in repos section
  runtime: string;
  setup?: string;
  run?: string;
  port?: number;
  depends_on?: string[];
  env?: Record<string, string>;
  env_file?: string;
}

export interface DevEnvConfig {
  name: string;
  repos: Record<string, RepoConfig>;
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

  if (!raw.repos || typeof raw.repos !== "object") {
    throw new Error("Invalid devenv.yml: 'repos' section is required");
  }

  if (!raw.projects || typeof raw.projects !== "object") {
    throw new Error("Invalid devenv.yml: 'projects' section is required");
  }

  return {
    name: (raw.name as string) ?? "devenv",
    repos: raw.repos as Record<string, RepoConfig>,
    system: raw.system as SystemConfig | undefined,
    services: raw.services as Record<string, ServiceConfig> | undefined,
    projects: raw.projects as Record<string, ProjectConfig>,
  };
}

// ─── Variable resolution ────────────────────────────────────

/**
 * Resolve ${VAR} references in a string.
 * Supports:
 *   ${ENV_VAR}              — from process.env
 *   ${repos.name}           — resolved repo clone path
 *   ${service.key}          — from resolved service outputs
 */
export function resolveVars(
  value: string,
  context: {
    repoPaths?: Record<string, string>;
    serviceOutputs?: Record<string, Record<string, string>>;
  }
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, ref: string) => {
    if (ref.startsWith("repos.")) {
      const repoName = ref.slice(6);
      return context.repoPaths?.[repoName] ?? "";
    }
    if (ref.includes(".")) {
      const [svcName, key] = ref.split(".", 2);
      return context.serviceOutputs?.[svcName]?.[key] ?? "";
    }
    return process.env[ref] ?? "";
  });
}

/**
 * Resolve all env vars in a record.
 */
export function resolveEnvMap(
  env: Record<string, string> | undefined,
  context: {
    repoPaths?: Record<string, string>;
    serviceOutputs?: Record<string, Record<string, string>>;
  }
): Record<string, string> {
  if (!env) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveVars(value, context);
  }
  return resolved;
}
