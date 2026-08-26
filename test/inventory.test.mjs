import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "../src/inventory.js";
import { encodePendingOpen } from "../src/pending-open.js";

test("get returns normalized browser state", async () => {
  const api = mockApi();
  globalThis.browser = api;
  const inventory = createInventory(api, () => 1234);

  const result = await inventory.get();

  assert.equal(result.revision, 1);
  assert.equal(result.capturedAt, 1234);
  assert.equal(result.privateWindowsIncluded, true);
  assert.deepEqual(result.windows[0].tabs[0].container, {
    id: "firefox-container-1",
    name: "Work"
  });
  assert.equal(result.windows[0].tabs[0].lastAccessed, 1200);
  assert.equal(result.windows[0].tabs[0].openerTabId, 6);
  assert.equal(result.windows[0].tabs[0].successorTabId, 8);
  assert.equal(result.windows[0].tabs[0].pendingUrl, null);
  assert.deepEqual(result.containers, [{
    id: "firefox-container-1",
    name: "Work"
  }]);
  assert.deepEqual(result.groups, [{
    id: 3,
    windowId: 1,
    title: "Docs",
    color: "blue",
    collapsed: false
  }]);
  delete globalThis.browser;
});

test("revision changes after a browser event", async () => {
  const api = mockApi();
  globalThis.browser = api;
  const inventory = createInventory(api);

  assert.equal((await inventory.get()).revision, 1);
  api.tabs.onUpdated.emit();
  assert.equal((await inventory.get()).revision, 2);
  delete globalThis.browser;
});

test("omitted browser fields use null", async () => {
  const api = mockApi();
  delete api.contextualIdentities;
  delete api.tabGroups;
  delete api.extension;
  delete api.windows.value[0].tabs[0].lastAccessed;
  delete api.windows.value[0].tabs[0].successorTabId;
  const result = await createInventory(api).get();
  const tab = result.windows[0].tabs[0];

  assert.equal(result.privateWindowsIncluded, null);
  assert.equal(tab.container, null);
  assert.equal(tab.groupId, 3);
  assert.equal(tab.lastAccessed, null);
  assert.equal(tab.successorTabId, null);
  assert.deepEqual(result.containers, []);
  assert.deepEqual(result.groups, []);
});

test("get propagates container and group query failures", async () => {
  const containerApi = mockApi();
  containerApi.contextualIdentities.query = async () => {
    throw new Error("Container query failed");
  };
  await assert.rejects(createInventory(containerApi).get(), /Container query failed/);

  const groupApi = mockApi();
  groupApi.tabGroups.query = async () => {
    throw new Error("Group query failed");
  };
  await assert.rejects(createInventory(groupApi).get(), /Group query failed/);
});

test("Chromium pending tabs expose their target without loading it", async () => {
  const api = mockApi();
  delete api.contextualIdentities;
  const tab = api.windows.value[0].tabs[0];
  const pendingUrl = encodePendingOpen("https://example.com/later", "Read later");
  tab.url = "data:text/html;charset=utf-8,different-document"
    + pendingUrl.slice(pendingUrl.indexOf("#tab-control-pending-open="));
  tab.title = "data page";

  const result = await createInventory(api).get();
  const normalized = result.windows[0].tabs[0];

  assert.equal(normalized.url, "https://example.com/later");
  assert.equal(normalized.pendingUrl, null);
  assert.equal(normalized.title, "Read later");
  assert.equal(normalized.pendingOpen, true);
  assert.equal(normalized.discarded, false);
});

test("negative successor IDs use null", async () => {
  const api = mockApi();
  api.windows.value[0].tabs[0].successorTabId = -1;

  const result = await createInventory(api).get();

  assert.equal(result.windows[0].tabs[0].successorTabId, null);
});

test("request handler accepts get and apply close", async () => {
  const api = mockApi();
  const ports = [];
  api.runtime = {
    onInstalled: event(),
    getBrowserInfo: async () => ({ name: "Firefox" }),
    connectNative: () => {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        postMessage() {}
      };
      ports.push(port);
      return port;
    },
    lastError: null
  };
  api.storage = {
    local: {
      get: async () => ({ instanceId: "945f84ab-1234-4000-8000-000000000001" }),
      set: async () => {}
    }
  };
  api.extension.isAllowedIncognitoAccess = (callback) => callback(true);
  globalThis.chrome = api;
  const { handleRequest } = await import("../src/background.js");
  await new Promise((resolve) => setTimeout(resolve, 0));

  api.runtime.lastError = { message: "No such native application com.tab_control.bridge" };
  ports[0].onDisconnect.emit();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ports.length, 1);

  const success = await handleRequest({
    jsonrpc: "2.0",
    id: 9,
    method: "get",
    params: {}
  });
  const failure = await handleRequest({
    jsonrpc: "2.0",
    id: 10,
    method: "nope",
    params: {}
  });
  const applied = await handleRequest({
    jsonrpc: "2.0",
    id: 11,
    method: "apply",
    params: {
      revision: 1,
      description: "Close the example tab",
      actions: [{ type: "close", tabIds: [7] }]
    }
  });

  assert.equal(success.id, 9);
  assert.equal(success.result.windows[0].id, 1);
  assert.equal(failure.error.code, -32601);
  assert.equal(applied.result.changeId, "1");
  assert.equal(applied.result.complete, true);
  assert.deepEqual(applied.result.actions, [{ index: 0, ok: true }]);
  assert.deepEqual(api.tabs.removed, [7]);
  delete globalThis.chrome;
});

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit() {
      for (const listener of listeners) listener();
    }
  };
}

function mockApi() {
  const tab = {
    id: 7,
    index: 0,
    url: "https://example.com/",
    title: "Example",
    active: true,
    pinned: false,
    discarded: false,
    hidden: false,
    audible: false,
    mutedInfo: { muted: false },
    lastAccessed: 1200,
    cookieStoreId: "firefox-container-1",
    groupId: 3,
    openerTabId: 6,
    successorTabId: 8
  };
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: "normal",
    state: "maximized",
    tabs: [tab]
  }];
  const api = {
    tabs: {
      removed: [],
      remove: async (tabIds) => {
        api.tabs.removed.push(...tabIds);
      },
      onCreated: event(), onUpdated: event(), onMoved: event(),
      onAttached: event(), onDetached: event(), onActivated: event(),
      onHighlighted: event(), onRemoved: event(), onReplaced: event()
    },
    windows: {
      value: windows,
      getAll: async () => windows,
      onCreated: event(), onFocusChanged: event(), onRemoved: event()
    },
    tabGroups: {
      query: async () => [{
        id: 3, windowId: 1, title: "Docs", color: "blue", collapsed: false
      }],
      onCreated: event(), onMoved: event(), onRemoved: event(), onUpdated: event()
    },
    contextualIdentities: {
      query: async () => [{ cookieStoreId: "firefox-container-1", name: "Work" }]
    },
    extension: {
      isAllowedIncognitoAccess: async () => true
    }
  };
  return api;
}
