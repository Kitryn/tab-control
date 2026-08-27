import { decodePendingOpen } from "./pending-open.js";

export function createInventory(api, now = Date.now) {
  let revision = 1;

  function markChanged() {
    revision += 1;
  }

  function listen(event) {
    if (event) event.addListener(markChanged);
  }

  listen(api.tabs.onCreated);
  listen(api.tabs.onUpdated);
  listen(api.tabs.onMoved);
  listen(api.tabs.onAttached);
  listen(api.tabs.onDetached);
  listen(api.tabs.onActivated);
  listen(api.tabs.onHighlighted);
  listen(api.tabs.onRemoved);
  listen(api.tabs.onReplaced);
  listen(api.windows.onCreated);
  listen(api.windows.onFocusChanged);
  listen(api.windows.onRemoved);
  listen(api.tabGroups?.onCreated);
  listen(api.tabGroups?.onMoved);
  listen(api.tabGroups?.onRemoved);
  listen(api.tabGroups?.onUpdated);

  async function get(view = "full") {
    const capturedRevision = revision;
    const [windows, privateWindowsIncluded] = await Promise.all([
      api.windows.getAll({ populate: true }),
      getPrivateWindowAccess(api)
    ]);

    if (view === "compact") {
      return {
        revision: capturedRevision,
        capturedAt: now(),
        privateWindowsIncluded,
        windows: windows.map(normalizeCompactWindow)
      };
    }

    const containers = await getContainers(api);
    const groups = await getGroups(api);

    return {
      revision: capturedRevision,
      capturedAt: now(),
      privateWindowsIncluded,
      windows: windows.map((window) => normalizeWindow(window, containers)),
      containers: [...containers.values()],
      groups
    };
  }

  return { get, markChanged, currentRevision: () => revision };
}

function normalizeCompactWindow(window) {
  return {
    id: valueOrNull(window.id),
    tabs: (window.tabs ?? []).map(normalizeCompactTab)
  };
}

function normalizeCompactTab(tab) {
  const identity = normalizeTabIdentity(tab);
  return {
    id: identity.id,
    index: identity.index,
    title: identity.title,
    url: identity.url
  };
}

function normalizeWindow(window, containers) {
  return {
    id: valueOrNull(window.id),
    focused: booleanOrNull(window.focused),
    incognito: booleanOrNull(window.incognito),
    type: valueOrNull(window.type),
    state: valueOrNull(window.state),
    tabs: (window.tabs ?? []).map((tab) => normalizeTab(tab, containers))
  };
}

function normalizeTab(tab, containers) {
  const identity = normalizeTabIdentity(tab);
  const muted = tab.mutedInfo?.muted;
  const container = tab.cookieStoreId && containers.has(tab.cookieStoreId)
    ? containers.get(tab.cookieStoreId)
    : null;

  return {
    id: identity.id,
    index: identity.index,
    url: identity.url,
    pendingUrl: identity.pendingOpen ? null : valueOrNull(tab.pendingUrl),
    title: identity.title,
    active: booleanOrNull(tab.active),
    pinned: booleanOrNull(tab.pinned),
    discarded: booleanOrNull(tab.discarded),
    pendingOpen: Boolean(identity.pendingOpen),
    hidden: booleanOrNull(tab.hidden),
    audible: booleanOrNull(tab.audible),
    muted: booleanOrNull(muted),
    lastAccessed: valueOrNull(tab.lastAccessed),
    container,
    groupId: validGroupId(tab.groupId),
    openerTabId: valueOrNull(tab.openerTabId),
    successorTabId: validTabId(tab.successorTabId)
  };
}

function normalizeTabIdentity(tab) {
  const pendingOpen = decodePendingOpen(tab.url) ?? decodePendingOpen(tab.pendingUrl);
  return {
    id: valueOrNull(tab.id),
    index: valueOrNull(tab.index),
    title: pendingOpen?.title ?? valueOrNull(tab.title),
    url: pendingOpen?.url ?? valueOrNull(tab.url),
    pendingOpen
  };
}

async function getContainers(api) {
  if (!api.contextualIdentities?.query) return new Map();
  const identities = await api.contextualIdentities.query({});
  return new Map(identities.map((identity) => [identity.cookieStoreId, {
    id: identity.cookieStoreId,
    name: identity.name
  }]));
}

async function getGroups(api) {
  if (!api.tabGroups?.query) return [];
  const groups = await api.tabGroups.query({});
  return groups.map((group) => ({
    id: valueOrNull(group.id),
    windowId: valueOrNull(group.windowId),
    title: valueOrNull(group.title),
    color: valueOrNull(group.color),
    collapsed: booleanOrNull(group.collapsed)
  }));
}

async function getPrivateWindowAccess(api) {
  const method = api.extension?.isAllowedIncognitoAccess;
  if (!method) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (allowed) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(allowed));
    };

    try {
      const result = method.call(api.extension, finish);
      if (result?.then) result.then(finish, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function validGroupId(groupId) {
  return typeof groupId === "number" && groupId >= 0 ? groupId : null;
}

function validTabId(tabId) {
  return typeof tabId === "number" && tabId >= 0 ? tabId : null;
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}
