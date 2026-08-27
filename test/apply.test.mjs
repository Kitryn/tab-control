import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "../src/inventory.js";
import { execute, validate } from "../src/actions.js";
import { createChange } from "../src/change.js";
import { decodePendingOpen } from "../src/pending-open.js";
import { platform as chromiumPlatform } from "../src/platforms/chromium.js";
import { platform as firefoxPlatform } from "../src/platforms/firefox.js";

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

test("newWindow validation binds later null window targets", async () => {
  const api = mockApi();
  const state = await createInventory(api).get();
  const newWindow = { type: "newWindow", tabIds: [7], focused: false };
  const move = { type: "move", tabIds: [7], windowId: null, index: -1 };
  const open = {
    type: "open",
    windowId: null,
    index: -1,
    tabs: [{
      url: "https://example.com/docs",
      title: "Docs",
      pinned: false,
      containerId: null,
      openerTabId: 7
    }]
  };

  assert.deepEqual(validate(state, [newWindow, move, open], firefoxPlatform).plan, [
    newWindow,
    move,
    open
  ]);
  assert.equal(validate(state, [move], firefoxPlatform).error.code, -32602);
});

test("newWindow validation does not require the tabs' source windows", async () => {
  const api = mockApi();
  const original = api.windows.value[0].tabs[0];
  api.windows.value.push({
    id: 2,
    focused: false,
    incognito: true,
    type: "normal",
    state: "normal",
    tabs: [{ ...original, id: 9, openerTabId: null }]
  });
  const state = await createInventory(api).get();
  const action = { type: "newWindow", tabIds: [7, 9], focused: false };

  assert.deepEqual(validate(state, [action], firefoxPlatform).plan, [action]);
});

test("apply creates a window and binds later null targets to it", async () => {
  const api = mockApi();
  const createdWith = [];
  api.windows.create = async (properties) => {
    createdWith.push(properties);
    return { id: 2 };
  };
  api.tabs.move = async (tabIds, properties) => {
    api.tabs.moved.push({ tabIds, ...properties });
    return tabIds.map((id, offset) => ({
      id,
      windowId: properties.windowId,
      index: properties.index === -1 ? offset : properties.index + offset
    }));
  };
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Create a window and place the example tab in it",
    actions: [
      { type: "newWindow", tabIds: [7], focused: false },
      { type: "move", tabIds: [7], windowId: null, index: 0 }
    ]
  });
  end();

  assert.deepEqual(createdWith, [{ focused: false }]);
  assert.deepEqual(api.tabs.moved, [
    { tabIds: [7], windowId: 2, index: -1 },
    { tabIds: [7], windowId: 2, index: 0 }
  ]);
  assert.deepEqual(outcome.result.actions, [
    { index: 0, ok: true, windowId: 2 },
    { index: 1, ok: true, tabs: [{ id: 7, windowId: 2, index: 0 }] }
  ]);
});

test("newWindow treats a browser move no-op as success", async () => {
  const api = mockApi();
  api.windows.create = async () => ({ id: 2 });
  api.tabs.move = async () => [];
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Create a window",
    actions: [{ type: "newWindow", tabIds: [7], focused: false }]
  });
  end();

  assert.equal(outcome.result.complete, true);
  assert.deepEqual(outcome.result.actions, [{ index: 0, ok: true, windowId: 2 }]);
});

test("failed window creation does not report a window ID", async () => {
  const api = mockApi();
  api.windows.create = async () => {
    throw new Error("Window creation failed");
  };

  const outcome = await execute(api, [
    { type: "newWindow", tabIds: [7], focused: false }
  ], chromiumPlatform);

  assert.deepEqual(outcome.results, [{
    index: 0,
    ok: false,
    error: { code: "BROWSER_REJECTED", message: "Window creation failed" }
  }]);
});

test("failed newWindow reports a window that was already created and stops", async () => {
  const api = mockApi();
  api.windows.create = async () => ({ id: 2 });
  api.tabs.move = async () => {
    throw new Error("Tabs cannot be moved to the new window");
  };
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Create a window",
    actions: [
      { type: "newWindow", tabIds: [7], focused: true },
      { type: "close", tabIds: [7] }
    ]
  });
  end();

  assert.equal(outcome.result.complete, false);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    windowId: 2,
    error: {
      code: "BROWSER_REJECTED",
      message: "Tabs cannot be moved to the new window"
    }
  }]);
  assert.deepEqual(api.tabs.removed, []);
});

test("apply closes tabs and reports their IDs in order", async () => {
  const api = mockApi();
  api.windows.value[0].tabs.push({
    ...api.windows.value[0].tabs[0],
    id: 8,
    index: 1
  });
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Close the example tabs",
    actions: [{ type: "close", tabIds: [8, 7] }]
  });
  end();

  assert.equal(outcome.result.changeId, "1");
  assert.equal(outcome.result.complete, true);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: true,
    closedTabIds: [8, 7],
    closedCount: 2
  }]);
  assert.deepEqual(api.tabs.removed, [8, 7]);
});

test("a rejected close does not report closed tabs", async () => {
  const api = mockApi();
  api.tabs.remove = async () => {
    throw new Error("Tab removal failed");
  };
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Close the example tab",
    actions: [{ type: "close", tabIds: [7] }]
  });
  end();

  assert.equal(outcome.result.complete, false);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    error: { code: "BROWSER_REJECTED", message: "Tab removal failed" }
  }]);
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
  const change = createChange(api, createInventory(api), chromiumPlatform);
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
  const change = createChange(api, createInventory(api), chromiumPlatform);
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
  const change = createChange(api, createInventory(api), chromiumPlatform);
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

  assert.equal(outcome.result.complete, false);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    error: { code: "BROWSER_REJECTED", message: "No window with id: 2" }
  }]);
  assert.deepEqual(api.tabs.removed, []);
});

test("execution rejects an unknown plan step without closing tabs", async () => {
  const api = mockApi();

  const outcome = await execute(api, [{ type: "group", tabIds: [7] }], chromiumPlatform);

  assert.equal(outcome.failed, true);
  assert.deepEqual(api.tabs.removed, []);
  assert.deepEqual(outcome.results, [{
    index: 0,
    ok: false,
    error: {
      code: "UNSUPPORTED_OPERATION",
      message: "Unsupported plan step: group"
    }
  }]);
});

test("open validation accepts HTTP tabs and rejects invalid targets", async () => {
  const api = mockApi();
  const state = await createInventory(api).get();
  const action = {
    type: "open",
    windowId: 1,
    index: -1,
    tabs: [{
      url: "https://example.com/docs",
      title: "Docs",
      pinned: false,
      containerId: "firefox-container-1",
      openerTabId: 7
    }]
  };

  assert.deepEqual(validate(state, [action], firefoxPlatform).plan, [action]);
  assert.equal(validate(state, [{ ...action, windowId: 9 }], firefoxPlatform).error.code, -32002);
  assert.equal(validate(state, [{ ...action, tabs: [] }], firefoxPlatform).error.code, -32602);
  assert.equal(validate(state, [{
    ...action,
    tabs: [{ ...action.tabs[0], url: "data:text/plain,no" }]
  }], firefoxPlatform).error.code, -32602);
  assert.equal(validate(state, [{
    ...action,
    tabs: [{ ...action.tabs[0], openerTabId: 99 }]
  }], firefoxPlatform).error.code, -32002);

  assert.equal(validate(state, [action], chromiumPlatform).error.code, -32602);
  assert.equal(validate(state, [{
    ...action,
    tabs: [{ ...action.tabs[0], containerId: "firefox-container-missing" }]
  }], firefoxPlatform).error.code, -32002);
});

test("open omits an opener from a different window", async () => {
  const api = mockApi();
  api.tabs.created = [];
  api.tabs.get = async (id) => id === 7
    ? { id: 7, windowId: 1, index: 0 }
    : { id, windowId: 2, index: 0 };
  api.tabs.create = async (properties) => {
    api.tabs.created.push(properties);
    return { id: 31, windowId: 2, index: 0 };
  };

  const outcome = await execute(api, [{
    type: "open",
    windowId: 2,
    index: -1,
    tabs: [{
      url: "https://example.com/",
      title: "Example",
      pinned: false,
      containerId: null,
      openerTabId: 7
    }]
  }], firefoxPlatform);

  assert.equal(outcome.failed, false);
  assert.equal("openerTabId" in api.tabs.created[0], false);
});

test("open uses discarded Firefox tabs and pins them after creation", async () => {
  const api = mockApi();
  const nativeTabs = new Map([[7, { id: 7, windowId: 1, index: 0 }]]);
  api.tabs.created = [];
  api.tabs.updated = [];
  api.tabs.create = async (properties) => {
    api.tabs.created.push(properties);
    const tab = {
      id: 30 + api.tabs.created.length,
      windowId: properties.windowId,
      index: properties.index ?? api.tabs.created.length,
      pinned: false
    };
    nativeTabs.set(tab.id, tab);
    return { ...tab };
  };
  api.tabs.update = async (id, properties) => {
    api.tabs.updated.push({ id, ...properties });
    Object.assign(nativeTabs.get(id), properties, { index: 0 });
    return { ...nativeTabs.get(id) };
  };
  api.tabs.get = async (id) => ({ ...nativeTabs.get(id) });
  const change = createChange(api, createInventory(api), firefoxPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Open the reference pages",
    actions: [{
      type: "open",
      windowId: 1,
      index: 1,
      tabs: [
        {
          url: "https://example.com/one",
          title: "One",
          pinned: true,
          containerId: "firefox-container-1",
          openerTabId: 7
        },
        {
          url: "https://example.com/two",
          title: "Two",
          pinned: false,
          containerId: null,
          openerTabId: null
        }
      ]
    }]
  });
  end();

  assert.deepEqual(api.tabs.created, [
    {
      windowId: 1,
      index: 1,
      active: false,
      url: "https://example.com/one",
      discarded: true,
      title: "One",
      cookieStoreId: "firefox-container-1",
      openerTabId: 7
    },
    {
      windowId: 1,
      index: 2,
      active: false,
      url: "https://example.com/two",
      discarded: true,
      title: "Two"
    }
  ]);
  assert.deepEqual(api.tabs.updated, [{ id: 31, pinned: true }]);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: true,
    tabs: [
      { id: 31, windowId: 1, index: 0 },
      { id: 32, windowId: 1, index: 2 }
    ]
  }]);
});

test("open uses a self-contained pending page on Chromium", async () => {
  const api = mockApi();
  delete api.contextualIdentities;
  let created;
  api.tabs.create = async (properties) => {
    created = properties;
    return { id: 31, windowId: properties.windowId, index: 1 };
  };
  api.tabs.get = async (id) => ({ id, windowId: 1, index: 1 });
  const change = createChange(api, createInventory(api), chromiumPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Open a reference page",
    actions: [{
      type: "open",
      windowId: 1,
      index: -1,
      tabs: [{
        url: "https://example.com/later",
        title: "Read later",
        pinned: false,
        containerId: null,
        openerTabId: null
      }]
    }]
  });
  end();

  assert.equal(created.active, false);
  assert.equal(created.windowId, 1);
  assert.equal("index" in created, false);
  assert.deepEqual(decodePendingOpen(created.url), {
    url: "https://example.com/later",
    title: "Read later"
  });
  assert.equal(outcome.result.complete, true);
});

test("open fails instead of reporting stale positions when final lookup fails", async () => {
  const api = mockApi();
  api.tabs.create = async (properties) => ({
    id: 31,
    windowId: properties.windowId,
    index: 1
  });
  api.tabs.get = async () => {
    throw new Error("No tab with id: 31");
  };
  const change = createChange(api, createInventory(api), firefoxPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Open a reference page",
    actions: [{
      type: "open",
      windowId: 1,
      index: -1,
      tabs: [{
        url: "https://example.com/later",
        title: "Read later",
        pinned: false,
        containerId: null,
        openerTabId: null
      }]
    }]
  });
  end();

  assert.equal(outcome.result.complete, false);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    tabs: [{ id: 31, windowId: null, index: null }],
    error: { code: "BROWSER_REJECTED", message: "No tab with id: 31" }
  }]);
});

test("failed open reports tabs that were already created", async () => {
  const api = mockApi();
  let calls = 0;
  api.tabs.create = async (properties) => {
    calls += 1;
    if (calls === 2) throw new Error("The browser rejected the URL");
    return { id: 31, windowId: properties.windowId, index: 1 };
  };
  api.tabs.get = async (id) => ({ id, windowId: 1, index: 1 });
  const change = createChange(api, createInventory(api), firefoxPlatform);
  const end = change.begin();
  const outcome = await change.apply({
    revision: 1,
    description: "Open two reference pages",
    actions: [
      {
        type: "open",
        windowId: 1,
        index: -1,
        tabs: [
          { url: "https://example.com/one", title: "One", pinned: false, containerId: null, openerTabId: null },
          { url: "https://example.com/two", title: "Two", pinned: false, containerId: null, openerTabId: null }
        ]
      },
      { type: "close", tabIds: [7] }
    ]
  });
  end();

  assert.equal(outcome.result.complete, false);
  assert.deepEqual(outcome.result.actions, [{
    index: 0,
    ok: false,
    tabs: [{ id: 31, windowId: 1, index: 1 }],
    error: { code: "BROWSER_REJECTED", message: "The browser rejected the URL" }
  }]);
  assert.deepEqual(api.tabs.removed, []);
});

test("apply rejects a stale revision", async () => {
  const api = mockApi();
  const inventory = createInventory(api);
  const change = createChange(api, inventory, chromiumPlatform);
  api.tabs.onMoved.emit();
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
  const change = createChange(api, createInventory(api), chromiumPlatform);

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
  const change = createChange(api, createInventory(api), chromiumPlatform);
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
