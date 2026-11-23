import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(target: LogLevel): boolean {
    return LEVEL_ORDER[target] >= LEVEL_ORDER[this.level];
  }

  debug(msg: string): void {
    if (this.shouldLog('debug')) {
      console.error(chalk.gray(`[debug] ${msg}`));
    }
  }

  info(msg: string): void {
    if (this.shouldLog('info')) {
      console.log(chalk.cyan('ℹ'), msg);
    }
  }

  success(msg: string): void {
    if (this.shouldLog('info')) {
      console.log(chalk.green('✔'), msg);
    }
  }

  warn(msg: string): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow('⚠'), chalk.yellow(msg));
    }
  }

  error(msg: string): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red('✖'), chalk.red(msg));
    }
  }
}

export const logger = new Logger();
