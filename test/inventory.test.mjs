import assert from "node:assert/strict";
import test from "node:test";

await import("../src/inventory.js");
const { createInventory } = globalThis.TabControlInventory;

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

test("unsupported browser fields use null", async () => {
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
  assert.deepEqual(result.groups, []);
});

test("request handler accepts only get", async () => {
  const api = mockApi();
  api.runtime = { onInstalled: event() };
  api.extension.isAllowedIncognitoAccess = (callback) => callback(true);
  globalThis.chrome = api;
  await import("../src/background.js");

  const success = await globalThis.TabControl.handleRequest({
    jsonrpc: "2.0",
    id: 9,
    method: "get",
    params: {}
  });
  const failure = await globalThis.TabControl.handleRequest({
    jsonrpc: "2.0",
    id: 10,
    method: "apply",
    params: {}
  });

  assert.equal(success.id, 9);
  assert.equal(success.result.windows[0].id, 1);
  assert.equal(failure.error.code, -32601);
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
