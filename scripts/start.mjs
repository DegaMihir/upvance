// Starts Upvance on a FIXED port (default 3100, set PORT in .env).
// If the port is busy it stops with a clear message instead of picking another port.
// Also starts the background worker (scheduled searches, data refreshes, AI queue)
// unless --no-worker is passed.
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2] === "start" ? "start" : "dev";
const withWorker = !process.argv.includes("--no-worker");

if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
else console.warn("⚠  No .env file found – copy .env.example to .env (see README).");

const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`✖ PORT in .env is not a valid port number: "${process.env.PORT}"`);
  process.exit(1);
}

// Is something already accepting connections on this port (IPv4 or IPv6)?
function answers(p, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port: p, host });
    sock.setTimeout(800);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(false));
  });
}
// Can we bind it ourselves?
function canBind(p, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e) => resolve(e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL")); // no IPv6 on this machine is fine
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, host);
  });
}
async function portFree(p) {
  if ((await answers(p, "127.0.0.1")) || (await answers(p, "::1"))) return false;
  return (await canBind(p, "::")) && (await canBind(p, "0.0.0.0"));
}

if (!(await portFree(port))) {
  console.error(`
✖ Port ${port} is already in use, so Upvance did not start.

  • Is Upvance already running in another window? Use that one: http://localhost:${port}
  • Or find what is using the port (PowerShell):
      Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess
      Get-Process -Id <OwningProcess>
  • Or change PORT=${port} in .env to another free port (and update the extension's App URL).
`);
  process.exit(1);
}

if (mode === "start" && !existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error("✖ No production build found. Run `npm run build` first (or use `npm run dev`).");
  process.exit(1);
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const tsxBin = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const children = [];

function run(name, args, color) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["inherit", "pipe", "pipe"] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited (${code ?? "signal"})`);
    if (name === "web") shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`\n▲ Upvance → http://localhost:${port}  (${mode === "dev" ? "development" : "production"} mode)\n`);
run("web", [nextBin, mode, "--port", String(port)], "35");
if (withWorker) run("worker", [tsxBin, path.join(root, "scripts", "worker.ts")], "34");
