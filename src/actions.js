import { encodePendingOpen } from "./pending-open.js";

export function validate(state, actions, platform) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { error: { code: -32602, message: "Invalid parameters" } };
  }

  const tabs = new Map();
  const windows = new Set();
  const containers = new Set((state.containers ?? []).map((container) => container.id));
  for (const window of state.windows) {
    if (typeof window.id === "number") windows.add(window.id);
    for (const tab of window.tabs) {
      if (typeof tab.id === "number") tabs.set(tab.id, window.id);
    }
  }

  const plan = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }

    if (action.type === "close") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      for (const tabId of tabIds) tabs.delete(tabId);
      plan.push({ type: "close", tabIds });
      continue;
    }

    if (action.type === "move") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      if (!Number.isInteger(action.windowId)
        || !Number.isInteger(action.index) || action.index < -1) {
        return invalidParameters();
      }
      if (!windows.has(action.windowId)) return missingWindow(action.windowId);
      for (const tabId of tabIds) tabs.set(tabId, action.windowId);
      plan.push({
        type: "move",
        tabIds,
        windowId: action.windowId,
        index: action.index
      });
      continue;
    }

    if (action.type === "open") {
      if (!Number.isInteger(action.windowId)
        || !Number.isInteger(action.index) || action.index < -1
        || !Array.isArray(action.tabs) || action.tabs.length === 0) {
        return invalidParameters();
      }
      if (!windows.has(action.windowId)) return missingWindow(action.windowId);

      const specifications = [];
      for (const specification of action.tabs) {
        const validated = validateOpenTab(
          specification,
          action.windowId,
          tabs,
          containers,
          platform
        );
        if (validated.error) return validated;
        specifications.push(validated.tab);
      }
      plan.push({
        type: "open",
        windowId: action.windowId,
        index: action.index,
        tabs: specifications
      });
      continue;
    }

    return { error: { code: -32003, message: "The browser does not support the operation" } };
  }

  return { plan };
}

function validateOpenTab(tab, windowId, tabs, containers, platform) {
  if (!tab || typeof tab !== "object" || typeof tab.url !== "string"
    || typeof tab.title !== "string" || typeof tab.pinned !== "boolean"
    || (tab.containerId !== null && typeof tab.containerId !== "string")
    || (tab.openerTabId !== null && !Number.isInteger(tab.openerTabId))) {
    return invalidParameters();
  }

  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return invalidParameters();
  } catch {
    return invalidParameters();
  }

  if (tab.containerId !== null) {
    if (!platform.supportsContainers) return invalidParameters();
    if (!containers.has(tab.containerId)) {
      return {
        error: {
          code: -32002,
          message: `Container ${tab.containerId} is missing`
        }
      };
    }
  }
  if (tab.openerTabId !== null) {
    if (!tabs.has(tab.openerTabId)) {
      return {
        error: {
          code: -32002,
          message: `Tab ${tab.openerTabId} is missing`
        }
      };
    }
    if (tabs.get(tab.openerTabId) !== windowId) return invalidParameters();
  }

  return {
    tab: {
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      containerId: tab.containerId,
      openerTabId: tab.openerTabId
    }
  };
}

function invalidParameters() {
  return { error: { code: -32602, message: "Invalid parameters" } };
}

function missingWindow(windowId) {
  return {
    error: {
      code: -32002,
      message: `Window ${windowId} is missing`
    }
  };
}

function requireTabIds(tabIds, tabs) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) return invalidParameters();
  for (const tabId of tabIds) {
    if (typeof tabId !== "number") return invalidParameters();
    if (!tabs.has(tabId)) {
      return {
        error: {
          code: -32002,
          message: `Tab ${tabId} is missing`
        }
      };
    }
  }
  return tabIds;
}

export async function execute(api, plan, platform) {
  const results = [];
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    try {
      if (step.type === "move") {
        const moved = await api.tabs.move(step.tabIds, {
          windowId: step.windowId,
          index: step.index
        });
        const list = Array.isArray(moved) ? moved : [moved];
        results.push({ index, ok: true, tabs: list.map(tabResult) });
        continue;
      }
      if (step.type === "open") {
        const opened = await executeOpen(api, step, platform);
        const result = { index, ok: !opened.error, tabs: opened.tabs };
        if (opened.error) {
          result.error = nativeFailure(opened.error);
          results.push(result);
          return { results, failed: true };
        }
        results.push(result);
        continue;
      }
      if (step.type === "close") {
        await api.tabs.remove(step.tabIds);
        results.push({ index, ok: true });
        continue;
      }
      results.push({
        index,
        ok: false,
        error: {
          code: "UNSUPPORTED_OPERATION",
          message: `Unsupported plan step: ${step.type}`
        }
      });
      return { results, failed: true };
    } catch (error) {
      results.push({
        index,
        ok: false,
        error: nativeFailure(error)
      });
      return { results, failed: true };
    }
  }
  return { results, failed: false };
}

async function executeOpen(api, step, platform) {
  const created = [];
  let error = null;

  try {
    for (let offset = 0; offset < step.tabs.length; offset += 1) {
      const specification = step.tabs[offset];
      const properties = {
        windowId: step.windowId,
        active: false,
        url: platform.supportsDiscardedCreate
          ? specification.url
          : encodePendingOpen(specification.url, specification.title)
      };
      if (step.index !== -1) properties.index = step.index + offset;
      if (specification.openerTabId !== null) {
        properties.openerTabId = specification.openerTabId;
      }
      if (platform.supportsDiscardedCreate) {
        properties.discarded = true;
        properties.title = specification.title;
        if (specification.containerId !== null) {
          properties.cookieStoreId = specification.containerId;
        }
      }
      created.push(await api.tabs.create(properties));
    }

    for (let index = 0; index < step.tabs.length; index += 1) {
      if (step.tabs[index].pinned) {
        created[index] = await api.tabs.update(created[index].id, { pinned: true });
      }
    }
  } catch (caught) {
    error = caught;
  }

  let tabs;
  try {
    tabs = await Promise.all(created.map(async (tab) => tabResult(await api.tabs.get(tab.id))));
  } catch (caught) {
    error ??= caught;
    tabs = created.map((tab) => ({
      id: tab.id,
      windowId: null,
      index: null
    }));
  }
  return { tabs, error };
}

function tabResult(tab) {
  return {
    id: tab?.id ?? null,
    windowId: tab?.windowId ?? null,
    index: tab?.index ?? null
  };
}

function nativeFailure(error) {
  const message = typeof error?.message === "string" && error.message.length > 0
    ? error.message
    : "The browser rejected the action";
  return { code: "BROWSER_REJECTED", message };
}
