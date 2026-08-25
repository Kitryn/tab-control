import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildNativeBins, tabctl } from "../scripts/native-bins.mjs";

await buildNativeBins();

test("rpc passes one JSON request and response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-test-"));
  const socketPath = join(directory, "bridge.sock");
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (data) => {
      const request = JSON.parse(data.trim());
      socket.end(`${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { revision: 1 }
      })}\n`);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const result = await runClient(tabctl, socketPath, {
      jsonrpc: "2.0",
      id: 7,
      method: "get",
      params: {}
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      jsonrpc: "2.0",
      id: 7,
      result: { revision: 1 }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("rpc reports a JSON parse error before it connects", async () => {
  const result = await runClient(tabctl, "/tmp/tab-control-unused.sock", "not json");

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^JSON input parse error:/);
});

test("rpc rejects pretty-printed JSON before it connects", async () => {
  const result = await runClient(
    tabctl,
    "/tmp/tab-control-unused.sock",
    '{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "get"\n}\n'
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^JSON input parse error: request must be a single line/);
});

function runClient(tabctlPath, socketPath, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(tabctlPath, ["rpc"], {
      cwd: process.cwd(),
      env: { ...process.env, TAB_CONTROL_SOCKET: socketPath },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));

    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}
