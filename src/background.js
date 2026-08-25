import { createInventory } from "./inventory.js";
import { createChange } from "./change.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const inventory = createInventory(extensionApi);
const change = createChange(extensionApi, inventory);

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

const nativePort = extensionApi.runtime.connectNative("com.tab_control.bridge");

nativePort.onMessage.addListener(async (request) => {
  nativePort.postMessage(await handleRequest(request));
});

nativePort.onDisconnect.addListener(() => {
  const error = extensionApi.runtime.lastError;
  console.error(error?.message ?? "Tab Control native bridge disconnected");
});

extensionApi.runtime.onInstalled.addListener(() => {
  console.info("Tab Control installed");
});
