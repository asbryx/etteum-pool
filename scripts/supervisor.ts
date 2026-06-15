#!/usr/bin/env bun
/**
 * etteum-pool supervisor.
 *
 * Crash-only auto-restart. NEVER restarts on clean exit (code 0) or SIGINT.
 *
 * Loop:
 *   1. spawn `bun scripts/production.ts --skip-build` as a child
 *   2. wait for child.exited
 *      - exit code 0 -> user stopped it cleanly -> supervisor exits too
 *      - exit code != 0 -> record crash; if under circuit-breaker
 *        threshold (5 in 5 min), restart after RESTART_DELAY_MS;
 *        else exit with clear log line.
 *
 * Health check (every HEALTH_CHECK_INTERVAL_MS):
 *   - process.kill(child.pid, 0)            -> liveness, no spawn
 *   - net.connect('127.0.0.1', PORT)        -> port liveness, no spawn
 *   - if either fails -> kill child tree, treat as crash
 *
 * Hard rules:
 *   - NO powershell. NO cmd. NO conhost spawns in any loop.
 *   - All taskkill calls (only on shutdown / zombie cleanup) use windowsHide.
 *   - Logs to logs/supervisor.log. No stdout spam.
 *
 * Usage:
 *   bun scripts/supervisor.ts             # production
 *   bun scripts/supervisor.ts --dry-run   # observe live PID, do NOT spawn or restart
 *   bun scripts/supervisor.ts --watch-pid <PID>   # dry-run against an existing PID
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import net from "net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");
const logsDir = join(root, "logs");
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

const supervisorLog = join(logsDir, "supervisor.log");
const stdoutLog = join(logsDir, "etteum.stdout.log");
const stderrLog = join(logsDir, "etteum.stderr.log");

// Tunables
const PORT = Number(process.env.PORT) || 1930;
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 1931;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 3000;
const HEALTH_CHECK_INTERVAL_MS = 10_000;
const STARTUP_GRACE_MS = 30_000;
const PORT_FREE_TIMEOUT_MS = 5000;
const SHUTDOWN_GRACE_MS = 5000;
const LOG_ROTATE_BYTES = 10 * 1024 * 1024; // 10 MB
const LOG_ROTATE_KEEP = 3;

// Args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const watchPidIdx = args.indexOf("--watch-pid");
const watchPid = watchPidIdx >= 0 ? Number(args[watchPidIdx + 1]) : 0;

const bunBin = process.execPath || "bun";

let crashTimestamps: number[] = [];
let shuttingDown = false;
let currentChildPid = 0;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [supervisor] ${msg}\n`;
  try {
    rotateIfNeeded(supervisorLog);
    appendFileSync(supervisorLog, line);
  } catch {}
  // Also write to stdout — but stdout is redirected to a file by the VBS launcher,
  // so this never hits a console window in production.
  try { process.stdout.write(line); } catch {}
}

function rotateIfNeeded(path: string) {
  try {
    if (!existsSync(path)) return;
    const sz = statSync(path).size;
    if (sz < LOG_ROTATE_BYTES) return;
    // Rotate: .2 -> .3, .1 -> .2, current -> .1
    for (let i = LOG_ROTATE_KEEP - 1; i >= 1; i--) {
      const src = `${path}.${i}`;
      const dst = `${path}.${i + 1}`;
      if (existsSync(src)) {
        try { renameSync(src, dst); } catch {}
      }
    }
    try { renameSync(path, `${path}.1`); } catch {}
  } catch {}
}

/**
 * Check whether a PID is alive via signal 0 — no subprocess spawn.
 * On Windows, Node's process.kill(pid, 0) returns:
 *   - true if process exists and we can signal it
 *   - throws ESRCH if no such process
 *   - throws EPERM if it exists but we can't access (still alive, treat as alive)
 */
function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/**
 * Check whether a TCP port is accepting connections on 127.0.0.1.
 * Pure async — no subprocess. Returns a Promise.
 */
function isPortListening(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve(result);
    };
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

async function waitForPortFree(port: number, timeoutMs = PORT_FREE_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortListening(port, 300))) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Force-kill a process tree on Windows. taskkill is a one-shot call,
 * NOT in a hot loop, and uses windowsHide to suppress console flash.
 */
function forceKillTree(pid: number) {
  if (pid <= 0) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", windowsHide: true });
    } catch {}
  } else {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

function recordCrash(): { count: number; tripped: boolean } {
  const now = Date.now();
  crashTimestamps.push(now);
  crashTimestamps = crashTimestamps.filter((t) => now - t < CRASH_WINDOW_MS);
  return {
    count: crashTimestamps.length,
    tripped: crashTimestamps.length >= MAX_CRASHES,
  };
}

/**
 * Dry-run: observe a target PID + ports, never spawn or restart.
 * Useful to verify supervisor logic against the currently running etteum-pool
 * before committing to it.
 */
async function dryRunMode() {
  const target = watchPid > 0 ? watchPid : 0;
  log(`dry-run mode (target PID ${target || "auto-detect"})`);
  if (!target) {
    log("no --watch-pid given. Cannot auto-detect on Windows without netstat. Pass --watch-pid <PID>.");
    return;
  }
  log(`Watching PID ${target} for 30s (no restart, observation only)...`);
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    const alive = isPidAlive(target);
    const portUp = await isPortListening(PORT);
    const dashUp = await isPortListening(DASHBOARD_PORT);
    log(`  PID ${target} alive=${alive} | port ${PORT}=${portUp} | port ${DASHBOARD_PORT}=${dashUp}`);
    if (!alive || !portUp) {
      log(`  Would-restart trigger fired (alive=${alive}, portUp=${portUp})`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  log("dry-run complete. No restarts performed. Live etteum-pool was not touched.");
}

async function killChildAndPorts() {
  if (currentChildPid > 0) {
    log(`Killing child tree PID ${currentChildPid}`);
    forceKillTree(currentChildPid);
    currentChildPid = 0;
  }
  // Wait briefly for ports to free
  await waitForPortFree(PORT);
  await waitForPortFree(DASHBOARD_PORT);
}

async function runOneIteration(): Promise<{ exitCode: number; crashed: boolean }> {
  log(`Spawning: bun scripts/production.ts --skip-build`);

  // Open log files for child stdio. Using 'a' append mode so logs accumulate
  // across restarts. The supervisor itself rotates them.
  const stdoutFd = Bun.file(stdoutLog).writer();
  const stderrFd = Bun.file(stderrLog).writer();

  const child = Bun.spawn([bunBin, "scripts/production.ts", "--skip-build"], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  currentChildPid = child.pid;
  log(`Started production PID ${currentChildPid}`);
  writeFileSync(join(root, ".etteum.pid"), String(currentChildPid));

  // Pipe stdout/stderr to log files (drains the pipes so the child doesn't block).
  // Errors here MUST NOT crash the supervisor — wrap each chunk individually.
  (async () => {
    try {
      const reader = child.stdout.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        try { stdoutFd.write(value); } catch {}
      }
    } catch {}
    try { stdoutFd.flush(); } catch {}
  })();
  (async () => {
    try {
      const reader = child.stderr.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        try { stderrFd.write(value); } catch {}
      }
    } catch {}
    try { stderrFd.flush(); } catch {}
  })();

  // Health check loop — runs concurrently with child.exited.
  let healthFailed = false;
  let healthFailReason = "";
  const startedAt = Date.now();
  const healthLoop = (async () => {
    while (!shuttingDown && currentChildPid > 0) {
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
      if (shuttingDown || currentChildPid === 0) break;
      const inGrace = Date.now() - startedAt < STARTUP_GRACE_MS;
      const alive = isPidAlive(currentChildPid);
      if (!alive) {
        // child.exited will resolve on its own — let that path handle it
        return;
      }
      if (!inGrace) {
        const portUp = await isPortListening(PORT);
        if (!portUp) {
          healthFailed = true;
          healthFailReason = `port ${PORT} down but PID ${currentChildPid} alive (zombie)`;
          log(healthFailReason);
          forceKillTree(currentChildPid);
          return;
        }
      }
    }
  })();

  // Wait for child to exit (either naturally or via health-loop kill).
  const exitCode = await child.exited;
  await healthLoop.catch(() => {});
  try { stdoutFd.end(); } catch {}
  try { stderrFd.end(); } catch {}

  const code = exitCode ?? -1;
  const crashed = healthFailed || (code !== 0 && code !== 130 /* SIGINT */);
  log(`Production exited code=${code} crashed=${crashed}${healthFailed ? ` reason="${healthFailReason}"` : ""}`);
  currentChildPid = 0;
  return { exitCode: code, crashed };
}

async function main() {
  log(`Supervisor started (max ${MAX_CRASHES} crashes per ${CRASH_WINDOW_MS / 60000}min)`);

  if (dryRun) {
    await dryRunMode();
    return;
  }

  // SIGINT/SIGTERM forwarding so user Ctrl+C cleanly shuts everything down
  const onSignal = (sig: string) => {
    log(`Received ${sig}, shutting down...`);
    shuttingDown = true;
    if (currentChildPid > 0) {
      try { process.kill(currentChildPid, "SIGTERM"); } catch {}
      // Hard-kill after grace
      setTimeout(() => {
        if (currentChildPid > 0) forceKillTree(currentChildPid);
        process.exit(0);
      }, SHUTDOWN_GRACE_MS).unref();
    } else {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  // Throttled EPIPE log to avoid the 2.3M-line log explosion the old watchdog had
  let lastEpipeLog = 0;
  process.on("uncaughtException", (err: any) => {
    if (err?.code === "EPIPE") {
      const now = Date.now();
      if (now - lastEpipeLog > 5000) {
        lastEpipeLog = now;
        log(`(throttled) uncaughtException EPIPE`);
      }
      return;
    }
    log(`uncaughtException: ${err?.stack || err}`);
  });
  process.on("unhandledRejection", (err: any) => {
    log(`unhandledRejection: ${err?.stack || err}`);
  });

  while (!shuttingDown) {
    const { exitCode, crashed } = await runOneIteration();

    if (shuttingDown) break;

    if (!crashed) {
      // Clean exit (user stopped it). Don't restart.
      log(`Clean exit code=${exitCode}. Supervisor exiting (no restart).`);
      break;
    }

    // Crashed. Apply circuit-breaker.
    const { count, tripped } = recordCrash();
    log(`Crash recorded (${count}/${MAX_CRASHES} in ${CRASH_WINDOW_MS / 60000}min)`);
    if (tripped) {
      log(`CIRCUIT BREAKER TRIPPED: ${MAX_CRASHES} crashes in ${CRASH_WINDOW_MS / 60000}min. Supervisor exiting.`);
      log(`Investigate logs/etteum.stderr.log. To restart manually: run start.cmd or start-direct.cmd.`);
      process.exit(1);
    }

    log(`Waiting ${RESTART_DELAY_MS / 1000}s before restart...`);
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));

    // Defensive: ensure ports are free before next spawn
    await waitForPortFree(PORT);
    await waitForPortFree(DASHBOARD_PORT);
  }

  log(`Supervisor stopped.`);
}

main().catch((err) => {
  log(`Supervisor fatal: ${err?.stack || err}`);
  process.exit(1);
});
