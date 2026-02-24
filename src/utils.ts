import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Log levels with icons
 */
export function log(
  message: string,
  level: 'info' | 'success' | 'warn' | 'error' | 'header' = 'info'
): void {
  const prefix = {
    info: '   ',
    success: ' ✅',
    warn: ' ⚠️ ',
    error: ' ❌',
    header: '\n📋',
  }[level];
  console.log(`${prefix} ${message}`);
}

/**
 * Execute a shell command and return output
 */
export function exec(
  command: string,
  options: { cwd?: string; silent?: boolean; timeout?: number } = {}
): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      cwd: options.cwd,
      timeout: options.timeout,
      stdio: options.silent ? 'pipe' : undefined,
      // Windows: use shell
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    }).trim();
  } catch (error: any) {
    if (options.silent) {
      return '';
    }
    throw error;
  }
}

/**
 * Result of running Claude Code
 */
export interface ClaudeResult {
  success: boolean;
  output: string;
}

/**
 * Run Claude Code CLI with given prompt (async with real-time output)
 */
export function runClaude(
  prompt: string,
  cwd: string,
  timeout: number
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const logChunks: string[] = [];

    // Build args - use stream-json for real-time output
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    // On Windows, we need to quote the prompt
    if (process.platform === 'win32') {
      args.push(`"${prompt}"`);
    } else {
      args.push(prompt);
    }

    const proc = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        MSYS_NO_PATHCONV: '1',
        MSYS2_ARG_CONV_EXCL: '*',
      },
    });

    // Close stdin
    if (proc.stdin) {
      proc.stdin.end();
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (proc && !proc.killed) {
        log('Execution timed out', 'error');
        proc.kill('SIGTERM');
      }
    }, timeout);

    // Handle stdout - parse stream-json and display
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        logChunks.push(text);

        // Parse and display stream-json events
        const lines = text.split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            displayStreamEvent(event);
          } catch {
            // Not JSON, show raw
            if (line.trim()) {
              process.stdout.write(`  ${line}\n`);
            }
          }
        }
      });
    }

    // Handle stderr
    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        logChunks.push(text);
        process.stderr.write(`  [stderr] ${text}`);
      });
    }

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        output: `Failed to start Claude Code: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0,
        output: logChunks.join(''),
      });
    });
  });
}

/**
 * Display stream-json events in human-readable format
 */
function displayStreamEvent(event: any): void {
  try {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          process.stdout.write(`  [Claude] Session started\n`);
        }
        break;

      case 'assistant':
        if (event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'text' && content.text) {
              const text = content.text.length > 200
                ? content.text.substring(0, 200) + '...'
                : content.text;
              process.stdout.write(`  [Claude] ${text}\n`);
            } else if (content.type === 'tool_use') {
              const input = typeof content.input === 'object'
                ? JSON.stringify(content.input).substring(0, 100)
                : String(content.input).substring(0, 100);
              process.stdout.write(`  [Tool] ${content.name}: ${input}...\n`);
            }
          }
        }
        break;

      case 'result':
        if (event.subtype === 'success') {
          process.stdout.write(`  [Claude] Completed (${event.num_turns} turns, ${event.duration_ms}ms)\n`);
        } else if (event.is_error) {
          process.stdout.write(`  [Claude] Failed: ${event.result || 'Unknown error'}\n`);
        }
        break;

      case 'user':
        // Skip tool results - too verbose
        break;
    }
  } catch {
    // Ignore display errors
  }
}

/**
 * Track active lock files for cleanup on shutdown
 */
const activeLocks: Set<string> = new Set();

/**
 * Get all active lock files (for cleanup on shutdown)
 */
export function getActiveLocks(): string[] {
  return Array.from(activeLocks);
}

/**
 * Clean up all active locks (called on shutdown)
 */
export function cleanupAllLocks(): void {
  for (const lockFile of activeLocks) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log(`  Cleaned up lock: ${lockFile}`);
      }
    } catch {
      // Ignore errors
    }
  }
  activeLocks.clear();
}

/**
 * Acquire a lock file to prevent concurrent runs
 */
export function acquireLock(lockFile: string): boolean {
  if (fs.existsSync(lockFile)) {
    const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
    const maxAge = 45 * 60 * 1000; // 45 minutes (longer than max operation)

    if (lockAge < maxAge) {
      const content = fs.readFileSync(lockFile, 'utf-8').trim();
      const [pid, startTime] = content.split(':');
      const age = Math.round(lockAge / 1000 / 60);
      log(`Lock held by PID ${pid} (${age} min ago)`, 'warn');
      return false;
    }

    log('Removing stale lock file', 'warn');
    fs.unlinkSync(lockFile);
  }

  const lockContent = `${process.pid}:${Date.now()}`;
  fs.writeFileSync(lockFile, lockContent);
  activeLocks.add(lockFile);
  return true;
}

/**
 * Release a lock file
 */
export function releaseLock(lockFile: string): void {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    activeLocks.delete(lockFile);
  } catch {
    // Ignore errors releasing lock
  }
}

/**
 * Ensure a directory exists
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the default branch name (main or master)
 */
export function getDefaultBranch(cwd: string): string {
  try {
    // Try to get from remote HEAD
    const result = exec('git symbolic-ref refs/remotes/origin/HEAD', { cwd, silent: true });
    if (result.includes('main')) return 'main';
    if (result.includes('master')) return 'master';
  } catch {}

  // Check if main exists
  try {
    exec('git show-ref --verify refs/heads/main', { cwd, silent: true });
    return 'main';
  } catch {}

  // Check if master exists
  try {
    exec('git show-ref --verify refs/heads/master', { cwd, silent: true });
    return 'master';
  } catch {}

  // Default to main
  return 'main';
}

/**
 * Get the global config directory
 */
export function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.prp-orchestrator');
}

/**
 * Get the global config file path
 */
export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
