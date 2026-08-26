import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { endianness, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildNativeBins, nativeHost, tabctl } from "../scripts/native-bins.mjs";

await buildNativeBins();

const identity = {
  instanceId: "945f84ab-1234-4000-8000-000000000001",
  browser: "Firefox"
};

test("native host relays a CLI request and native response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-native-test-"));
  const host = spawn(nativeHost, [], {
    cwd: process.cwd(),
    env: testEnv(directory),
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const listening = waitForListening(host);
    writeNativeMessage(host.stdin, identity);
    await listening;
    const nextMessage = nativeMessageReader(host.stdout);
    const client = runClient(directory, {
      jsonrpc: "2.0",
      id: 12,
      method: "get",
      params: {}
    });
    const request = await nextMessage();

    assert.deepEqual(
      { ...request, id: 12 },
      {
        jsonrpc: "2.0",
        id: 12,
        method: "get",
        params: {}
      }
    );
    assert.notEqual(request.id, 12);

    writeNativeMessage(host.stdin, {
      jsonrpc: "2.0",
      id: request.id,
      result: { revision: 5 }
    });

    assert.deepEqual(JSON.parse((await client).stdout), {
      jsonrpc: "2.0",
      id: 12,
      result: { revision: 5 }
    });
  } finally {
    host.kill("SIGTERM");
    await new Promise((resolve) => host.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("native host multiplexes concurrent clients and restores ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-native-test-"));
  const host = spawn(nativeHost, [], {
    cwd: process.cwd(),
    env: testEnv(directory),
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const listening = waitForListening(host);
    writeNativeMessage(host.stdin, identity);
    await listening;
    const nextMessage = nativeMessageReader(host.stdout);
    const first = runClient(directory, {
      jsonrpc: "2.0",
      id: 1,
      method: "get",
      params: { probe: "a" }
    });
    const second = runClient(directory, {
      jsonrpc: "2.0",
      id: 1,
      method: "get",
      params: { probe: "b" }
    });

    const requests = [await nextMessage(), await nextMessage()];
    const firstRequest = requests.find((request) => request.params.probe === "a");
    const secondRequest = requests.find((request) => request.params.probe === "b");
    assert.ok(firstRequest);
    assert.ok(secondRequest);
    assert.notEqual(firstRequest.id, secondRequest.id);

    writeNativeMessage(host.stdin, {
      jsonrpc: "2.0",
      id: secondRequest.id,
      result: { revision: 2 }
    });
    writeNativeMessage(host.stdin, {
      jsonrpc: "2.0",
      id: firstRequest.id,
      result: { revision: 1 }
    });

    const firstResult = JSON.parse((await first).stdout);
    const secondResult = JSON.parse((await second).stdout);
    assert.deepEqual(firstResult, {
      jsonrpc: "2.0",
      id: 1,
      result: { revision: 1 }
    });
    assert.deepEqual(secondResult, {
      jsonrpc: "2.0",
      id: 1,
      result: { revision: 2 }
    });
  } finally {
    host.kill("SIGTERM");
    await new Promise((resolve) => host.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("native host times out a hung request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-native-test-"));
  const host = spawn(nativeHost, [], {
    cwd: process.cwd(),
    env: testEnv(directory, { TAB_CONTROL_TIMEOUT_MS: "50" }),
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const listening = waitForListening(host);
    writeNativeMessage(host.stdin, identity);
    await listening;
    const result = await runClient(directory, {
      jsonrpc: "2.0",
      id: 4,
      method: "get",
      params: {}
    }, { TAB_CONTROL_TIMEOUT_MS: "200" });

    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32000,
        message: "The browser is unavailable"
      }
    });
  } finally {
    host.kill("SIGTERM");
    await new Promise((resolve) => host.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("native host answers describe without a native round trip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tab-control-native-test-"));
  const host = spawn(nativeHost, [], {
    cwd: process.cwd(),
    env: testEnv(directory),
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const listening = waitForListening(host);
    writeNativeMessage(host.stdin, identity);
    await listening;
    const result = await runClient(directory, {
      jsonrpc: "2.0",
      id: 1,
      method: "describe",
      params: {}
    });
    assert.deepEqual(JSON.parse(result.stdout), {
      jsonrpc: "2.0",
      id: 1,
      result: {
        instanceId: identity.instanceId,
        browser: "Firefox"
      }
    });
  } finally {
    host.kill("SIGTERM");
    await new Promise((resolve) => host.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

function waitForListening(host) {
  return new Promise((resolve, reject) => {
    host.stderr.setEncoding("utf8");
    host.stderr.on("data", (text) => {
      if (text.includes("bridge listening")) resolve();
    });
    host.once("error", reject);
    host.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Native host exited with code ${code}`));
    });
  });
}

function testEnv(directory, extra = {}) {
  const env = { ...process.env, TAB_CONTROL_SOCKET_DIR: directory, ...extra };
  delete env.TAB_CONTROL_SOCKET;
  return env;
}

function runClient(directory, request, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tabctl, ["rpc"], {
      cwd: process.cwd(),
      env: testEnv(directory, extraEnv),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(stderr || `CLI exited with code ${code}`));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function nativeMessageReader(stream) {
  let input = Buffer.alloc(0);
  const queued = [];
  let waiting = null;

  const take = () => {
    const length = endianness() === "LE"
      ? input.readUInt32LE(0)
      : input.readUInt32BE(0);
    if (input.length < length + 4) return false;
    const body = JSON.parse(input.subarray(4, length + 4).toString("utf8"));
    input = input.subarray(length + 4);
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(body);
    } else {
      queued.push(body);
    }
    return true;
  };

  stream.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4 && take()) {
      // drain complete frames
    }
  });

  return () => new Promise((resolve) => {
    if (queued.length > 0) resolve(queued.shift());
    else waiting = resolve;
  });
}

function writeNativeMessage(stream, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  stream.write(Buffer.concat([header, body]));
}
