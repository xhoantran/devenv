/**
 * CLI output logger with colors and log level control.
 */

import chalk from "chalk";

export type LogLevel = "normal" | "debug";

let level: LogLevel = "normal";

export function setLogLevel(l: LogLevel) {
  level = l;
}

export function getLogLevel(): LogLevel {
  return level;
}

export const log = {
  // Always shown
  header: (msg: string) => console.log("\n" + chalk.bold.white(msg)),
  success: (msg: string) => console.log(chalk.green("✓") + " " + msg),
  error: (msg: string) => console.log(chalk.red("✗") + " " + msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠") + " " + msg),

  // Only shown in debug mode
  step: (msg: string) => {
    if (level === "debug") console.log(chalk.blue("▸") + " " + msg);
  },
  info: (msg: string) => {
    if (level === "debug") console.log(chalk.gray("  " + msg));
  },
  debug: (msg: string) => {
    if (level === "debug") console.log(chalk.dim("  [debug] " + msg));
  },
};
