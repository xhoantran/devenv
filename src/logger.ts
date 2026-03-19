/**
 * CLI output logger with colors and spinners.
 */

import chalk from "chalk";

export const log = {
  step: (msg: string) => console.log(chalk.blue("▸") + " " + msg),
  success: (msg: string) => console.log(chalk.green("✓") + " " + msg),
  error: (msg: string) => console.log(chalk.red("✗") + " " + msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠") + " " + msg),
  info: (msg: string) => console.log(chalk.gray("  " + msg)),
  header: (msg: string) => console.log("\n" + chalk.bold.white(msg)),
};
