import { createInventory } from "./inventory.js";
import { createChange } from "./change.js";
import { loadInstance } from "./instance.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const inventory = createInventory(extensionApi);
const change = createChange(extensionApi, inventory);

let instance = null;
let reconnectTimer = 0;

export async function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0") {
    return errorResponse(request?.id ?? null, -32600, "Invalid request");
  }

  if (request.method === "get") {
    if (request.params && Object.keys(request.params).length > 0) {
      return errorResponse(request.id, -32602, "Invalid parameters");
    }
    await change.idle();
    try {
      return { jsonrpc: "2.0", id: request.id, result: await inventory.get() };
    } catch (error) {
      return errorResponse(request.id, -32603, error?.message ?? "Internal error");
    }
  }

  if (request.method === "apply") {
    const end = change.begin();
    if (!end) {
      return errorResponse(request.id, -32004, "Another change is in progress");
    }
    try {
      const outcome = await change.apply(request.params);
      if (outcome.error) {
        return errorResponse(
          request.id,
          outcome.error.code,
          outcome.error.message,
          outcome.error.data
        );
      }
      return { jsonrpc: "2.0", id: request.id, result: outcome.result };
    } catch (error) {
      return errorResponse(request.id, -32603, error?.message ?? "Internal error");
    } finally {
      end();
    }
  }

  return errorResponse(request.id ?? null, -32601, "Unknown method");
}

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function connectBridge() {
  const started = Date.now();
  const port = extensionApi.runtime.connectNative("com.tab_control.bridge");
  port.onMessage.addListener(async (request) => {
    port.postMessage(await handleRequest(request));
  });
  port.onDisconnect.addListener(() => {
    const message = extensionApi.runtime.lastError?.message
      ?? "Tab Control native bridge disconnected";
    console.error(message);
    if (
      message === "Specified native messaging host not found."
      || message === "Access to the specified native messaging host is forbidden."
      || message.startsWith("No such native application")
    ) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectBridge, Math.max(0, 1000 - (Date.now() - started)));
  });
  port.postMessage({
    instanceId: instance.instanceId,
    browser: instance.browser
  });
}

loadInstance(extensionApi).then((loaded) => {
  instance = loaded;
  connectBridge();
});

extensionApi.runtime.onInstalled.addListener(() => {
  console.info("Tab Control installed");
});
