import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildNativeBins, tabctl } from "../scripts/native-bins.mjs";

await buildNativeBins();

test("rpc reports a JSON parse error before it connects", async () => {
  const result = await runTabctl(["rpc"], { input: "not json" });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^JSON input parse error:/);
});

test("rpc rejects pretty-printed JSON before it connects", async () => {
  const result = await runTabctl(["rpc"], {
    input: '{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "method": "get"\n}\n'
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^JSON input parse error: request must be a single line/);
});

const firefoxId = "945f84ab-1234-4000-8000-000000000001";
const chromeId = "a1b2c3de-5678-4000-8000-000000000002";

test("instances lists profile names and rpc accepts either selector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-test-"));
  const servers = [
    await listenInstance(directory, {
      instanceId: firefoxId,
      browser: "Firefox",
      name: "work"
    }),
    await listenInstance(directory, { instanceId: chromeId, browser: "Chrome" })
  ];

  try {
    const listed = await runTabctl(["instances"], { socketDir: directory });
    assert.equal(listed.code, 0);
    assert.deepEqual(JSON.parse(listed.stdout), [
      { id: firefoxId, name: "work" },
      { id: chromeId, name: "Chrome a1b2c3" }
    ]);

    const many = await runTabctl(["rpc"], {
      socketDir: directory,
      input: { jsonrpc: "2.0", id: 1, method: "get", params: {} }
    });
    assert.equal(many.code, 1);
    assert.deepEqual(JSON.parse(many.stderr.trim().split("\n")[0]), [
      { id: firefoxId, name: "work" },
      { id: chromeId, name: "Chrome a1b2c3" }
    ]);

    const picked = await runTabctl(["rpc", "--instance", "945f84"], {
      socketDir: directory,
      input: { jsonrpc: "2.0", id: 2, method: "get", params: {} }
    });
    assert.equal(picked.code, 0);
    assert.equal(JSON.parse(picked.stdout).result.instance, firefoxId);

    const pickedByName = await runTabctl(["rpc", "--name", "work"], {
      socketDir: directory,
      input: { jsonrpc: "2.0", id: 3, method: "get", params: {} }
    });
    assert.equal(pickedByName.code, 0);
    assert.equal(JSON.parse(pickedByName.stdout).result.instance, firefoxId);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});

test("instances keeps a live socket when describe fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-test-"));
  const livePath = join(directory, `${firefoxId}.sock`);
  const server = createServer((socket) => {
    socket.once("data", () => {
      socket.end("not-json\n");
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(livePath, resolve);
    });
    const listed = await runTabctl(["instances"], { socketDir: directory });
    assert.equal(listed.code, 0);
    assert.deepEqual(JSON.parse(listed.stdout), []);
    assert.equal(existsSync(livePath), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("rpc rejects an ambiguous profile name", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-test-"));
  const servers = [
    await listenInstance(directory, {
      instanceId: firefoxId,
      browser: "Firefox",
      name: "work"
    }),
    await listenInstance(directory, {
      instanceId: chromeId,
      browser: "Chrome",
      name: "work"
    })
  ];

  try {
    const result = await runTabctl(["rpc", "--name", "work"], {
      socketDir: directory,
      input: { jsonrpc: "2.0", id: 4, method: "get", params: {} }
    });
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stderr.trim().split("\n")[0]), [
      { id: firefoxId, name: "work" },
      { id: chromeId, name: "work" }
    ]);
    assert.match(result.stderr, /profile work is ambiguous/);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});

test("rpc rejects two selectors", async () => {
  const result = await runTabctl([
    "rpc",
    "--instance",
    firefoxId,
    "--name",
    "work"
  ], {
    input: { jsonrpc: "2.0", id: 5, method: "get", params: {} }
  });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /^Usage:/);
});

test("rpc uses the only live instance without a selector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-test-"));
  const server = await listenInstance(directory, {
    instanceId: firefoxId,
    browser: "Firefox"
  });

  try {
    const result = await runTabctl(["rpc"], {
      socketDir: directory,
      input: { jsonrpc: "2.0", id: 3, method: "get", params: {} }
    });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).result.instance, firefoxId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

function listenInstance(directory, identity) {
  const socketPath = join(directory, `${identity.instanceId}.sock`);
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (data) => {
      const request = JSON.parse(data.trim());
      if (request.method === "describe") {
        socket.end(`${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            instanceId: identity.instanceId,
            browser: identity.browser,
            name: identity.name
          }
        })}\n`);
        return;
      }
      socket.end(`${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { revision: 1, instance: identity.instanceId }
      })}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function runTabctl(args, { socketDir, input } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.TAB_CONTROL_SOCKET;
    if (socketDir) env.TAB_CONTROL_SOCKET_DIR = socketDir;
    else delete env.TAB_CONTROL_SOCKET_DIR;

    const child = spawn(tabctl, args, {
      cwd: process.cwd(),
      env,
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

    if (input === undefined) child.stdin.end();
    else child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}
