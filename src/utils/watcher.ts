import fs from 'node:fs';
import path from 'node:path';
import { CODE_EXTENSIONS, IGNORED_DIRS, toPosixPath } from './git.js';

export interface WatchOptions {
  debounceMs?: number;
  onChange: (changedRelFiles: string[]) => Promise<void> | void;
}

const WATCHED_CONFIG_FILES = new Set([
  '.archrules.yaml',
  '.archrules.yml',
  'package.json',
  'PRD.md',
]);

export function shouldTriggerOnWatchPath(relPath: string): boolean {
  const posix = toPosixPath(relPath);
  const segments = posix.split('/');

  for (const seg of segments) {
    if (IGNORED_DIRS.has(seg)) {
      return false;
    }
  }

  const base = path.posix.basename(posix);
  if (base === '.vibe-cache.json' || base === 'vibe-report.html') {
    return false;
  }

  if (WATCHED_CONFIG_FILES.has(base)) {
    return true;
  }

  const ext = path.posix.extname(base).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Starts a debounced recursive filesystem watcher over `projectRoot`.
 * Returns a cleanup function to close the watcher.
 */
export function startProjectWatcher(
  projectRoot: string,
  options: WatchOptions
): { close: () => void } {
  const resolvedRoot = path.resolve(projectRoot);
  const debounceMs = options.debounceMs ?? 250;
  const pendingFiles = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerunRequested = false;

  async function flush(): Promise<void> {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    const batch = Array.from(pendingFiles);
    pendingFiles.clear();

    try {
      await options.onChange(batch);
    } finally {
      running = false;
      if (rerunRequested || pendingFiles.size > 0) {
        rerunRequested = false;
        if (pendingFiles.size > 0) {
          await flush();
        }
      }
    }
  }

  const watcher = fs.watch(resolvedRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const posixRel = toPosixPath(filename.toString());
    if (!shouldTriggerOnWatchPath(posixRel)) {
      return;
    }

    pendingFiles.add(posixRel);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {
        // Errors handled by caller callback
      });
    }, debounceMs);
  });

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
