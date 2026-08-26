import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "../src/inventory.js";
import { validate } from "../src/actions.js";
import { createChange } from "../src/change.js";

test("close validation accepts existing tabs and rejects missing ones", async () => {
  const state = await createInventory(mockApi()).get();

  assert.deepEqual(
    validate(state, [{ type: "close", tabIds: [7] }]).plan,
    [{ type: "close", tabIds: [7] }]
  );
  assert.equal(
    validate(state, [{ type: "close", tabIds: [99] }]).error.code,
    -32002
  );
  assert.equal(
    validate(state, [{ type: "group", tabIds: [7], title: "Docs" }]).error.code,
    -32003
  );
});

test("move validation accepts a live window and rejects a missing one", async () => {
  const api = mockApi();
  api.windows.value.push({
    id: 2, focused: false, incognito: false, type: "normal", state: "normal", tabs: []
  });
  const state = await createInventory(api).get();

  assert.deepEqual(
    validate(state, [{ type: "move", tabIds: [7], windowId: 2, index: 0 }]).plan,
    [{ type: "move", tabIds: [7], windowId: 2, index: 0 }]
  );
  assert.equal(
    validate(state, [{ type: "move", tabIds: [7], windowId: 9, index: 0 }]).error.code,
    -32002
  );
  assert.equal(
    validate(state, [{ type: "move", tabIds: [7], windowId: null, index: 0 }]).error.code,
    -32602
  );
});

test("apply closes tabs when the revision matches", async () => {
  const api = mockApi();
  const change = createChange(api, createInventory(api));
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Close the example tab",
    actions: [{ type: "close", tabIds: [7] }]
  });
  end();

  assert.equal(outcome.result.changeId, "1");
  assert.deepEqual(outcome.result.actions, [{ index: 0, ok: true }]);
  assert.deepEqual(api.tabs.removed, [7]);
});

test("apply moves tabs and reports the API positions", async () => {
  const api = mockApi();
  api.windows.value.push({
    id: 2, focused: false, incognito: false, type: "normal", state: "normal", tabs: []
  });
  api.tabs.move = async (tabIds, props) => {
    api.tabs.moved.push({ tabIds, ...props });
    return tabIds.map((id, offset) => ({
      id,
      windowId: props.windowId,
      index: props.index + offset
    }));
  };
  const change = createChange(api, createInventory(api));
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Move the example tab",
    actions: [{ type: "move", tabIds: [7], windowId: 2, index: 0 }]
  });
  end();

  assert.deepEqual(api.tabs.moved, [{ tabIds: [7], windowId: 2, index: 0 }]);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: true,
    tabs: [{ id: 7, windowId: 2, index: 0 }]
  }]);
});

test("apply treats a move no-op as success with no tabs", async () => {
  const api = mockApi();
  api.tabs.move = async () => [];
  const change = createChange(api, createInventory(api));
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Move into the pinned region",
    actions: [{ type: "move", tabIds: [7], windowId: 1, index: 0 }]
  });
  end();

  assert.deepEqual(outcome.result.actions, [{ index: 0, ok: true, tabs: [] }]);
});

test("apply stops after a rejected move", async () => {
  const api = mockApi();
  api.tabs.move = async () => {
    throw new Error("No window with id: 2");
  };
  const change = createChange(api, createInventory(api));
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Move then close",
    actions: [
      { type: "move", tabIds: [7], windowId: 1, index: 0 },
      { type: "close", tabIds: [7] }
    ]
  });
  end();

  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    error: { code: "WINDOW_NOT_FOUND", message: "No window with id: 2" }
  }]);
  assert.deepEqual(api.tabs.removed, []);
});

test("apply rejects a stale revision", async () => {
  const api = mockApi();
  const inventory = createInventory(api);
  const change = createChange(api, inventory);
  api.tabs.onUpdated.emit();
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Close the example tab",
    actions: [{ type: "close", tabIds: [7] }]
  });
  end();

  assert.equal(outcome.error.code, -32001);
  assert.deepEqual(outcome.error.data, {
    expectedRevision: 1,
    actualRevision: 2
  });
  assert.deepEqual(api.tabs.removed, []);
});

test("a second apply fails immediately while one is running", async () => {
  const api = mockApi();
  let release;
  api.tabs.remove = () => new Promise((resolve) => {
    release = resolve;
  });
  const change = createChange(api, createInventory(api));

  const firstEnd = change.begin();
  assert.equal(change.begin(), null);
  const first = change.apply({
    revision: 1,
    description: "Close the example tab",
    actions: [{ type: "close", tabIds: [7] }]
  });
  await until(() => release);
  release();
  await first;
  firstEnd();

  const secondEnd = change.begin();
  assert.ok(secondEnd);
  secondEnd();
});

test("idle waits until the running change finishes", async () => {
  const api = mockApi();
  let release;
  api.tabs.remove = () => new Promise((resolve) => {
    release = resolve;
  });
  const change = createChange(api, createInventory(api));
  const end = change.begin();
  const applying = change.apply({
    revision: 1,
    description: "Close the example tab",
    actions: [{ type: "close", tabIds: [7] }]
  });

  let idleDone = false;
  const waiting = change.idle().then(() => {
    idleDone = true;
  });
  await until(() => release);
  assert.equal(idleDone, false);

  release();
  await applying;
  end();
  await waiting;
  assert.equal(idleDone, true);
});

async function until(ready) {
  for (let attempt = 0; attempt < 20 && !ready(); attempt += 1) {
    await Promise.resolve();
  }
  assert.ok(ready());
}

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
      moved: [],
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
