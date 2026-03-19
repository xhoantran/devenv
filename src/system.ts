/**
 * System setup — install packages and runtimes on a bare machine.
 */

import { execSync } from "node:child_process";
import type { SystemConfig } from "./config.js";
import { log } from "./logger.js";

function detectPackageManager(): { install: string; name: string } {
  if (commandExists("apt-get")) {
    return { install: "apt-get update -qq && apt-get install -y --no-install-recommends", name: "apt" };
  }
  if (commandExists("yum")) {
    return { install: "yum install -y", name: "yum" };
  }
  if (commandExists("dnf")) {
    return { install: "dnf install -y", name: "dnf" };
  }
  if (commandExists("brew")) {
    return { install: "brew install", name: "brew" };
  }
  if (commandExists("apk")) {
    return { install: "apk add --no-cache", name: "apk" };
  }
  throw new Error("No supported package manager found (apt, yum, dnf, brew, apk)");
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const RUNTIME_INSTALLERS: Record<string, (version: string) => string> = {
  java: (v) => [
    `curl -s "https://get.sdkman.io" | bash`,
    `source "$HOME/.sdkman/bin/sdkman-init.sh" && sdk install java ${v}-amzn`,
  ].join(" && "),

  node: (v) => [
    `curl -fsSL https://deb.nodesource.com/setup_${v}.x | bash -`,
    `apt-get install -y nodejs`,
  ].join(" && "),

  python: (v) => `apt-get install -y python${v} python${v}-venv python3-pip`,
};

export async function setupSystem(config: SystemConfig): Promise<void> {
  // Install system packages
  if (config.packages && config.packages.length > 0) {
    log.step(`Installing packages: ${config.packages.join(", ")}`);
    const pm = detectPackageManager();
    try {
      execSync(`${pm.install} ${config.packages.join(" ")}`, {
        stdio: "inherit",
        timeout: 300_000,
      });
      log.success("Packages installed");
    } catch (err) {
      log.error(`Package installation failed: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  // Install runtimes
  if (config.runtimes) {
    for (const [runtime, version] of Object.entries(config.runtimes)) {
      const vStr = String(version);
      const installer = RUNTIME_INSTALLERS[runtime];

      if (!installer) {
        log.warn(`Unknown runtime: ${runtime} — skipping`);
        continue;
      }

      log.step(`Installing ${runtime} ${vStr}`);
      try {
        execSync(installer(vStr), {
          stdio: "inherit",
          timeout: 600_000,
          shell: "/bin/bash",
        });
        log.success(`${runtime} ${vStr} installed`);
      } catch (err) {
        log.error(`Failed to install ${runtime} ${vStr}: ${err instanceof Error ? err.message : err}`);
        throw err;
      }
    }
  }
}
