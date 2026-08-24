if (!globalThis.TabControlInventory && globalThis.importScripts) {
  globalThis.importScripts("inventory.js");
}

const extensionApi = globalThis.browser ?? globalThis.chrome;
const inventory = globalThis.TabControlInventory.createInventory(extensionApi);

globalThis.TabControl = {
  async handleRequest(request) {
    if (!request || request.jsonrpc !== "2.0" || request.method !== "get") {
      return errorResponse(request?.id ?? null, -32601, "Unknown method");
    }

    if (request.params && Object.keys(request.params).length > 0) {
      return errorResponse(request.id, -32602, "Invalid parameters");
    }

    try {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: await inventory.get()
      };
    } catch (error) {
      return errorResponse(request.id, -32603, error?.message ?? "Internal error");
    }
  }
};

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

extensionApi.runtime.onInstalled.addListener(() => {
  console.info("Tab Control installed");
});
