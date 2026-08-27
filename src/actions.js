import { encodePendingOpen } from "./pending-open.js";

export function validate(state, actions, platform, api) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { error: { code: -32602, message: "Invalid parameters" } };
  }

  const tabs = new Set();
  const windows = new Set();
  const groups = new Set((state.groups ?? []).map((group) => group.id));
  const containers = new Set((state.containers ?? []).map((container) => container.id));
  for (const window of state.windows) {
    if (typeof window.id === "number") windows.add(window.id);
    for (const tab of window.tabs) {
      if (typeof tab.id === "number") tabs.add(tab.id);
    }
  }

  const plan = [];
  let hasNewWindow = false;
  for (const action of actions) {
    if (!action || typeof action !== "object") {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }

    if (action.type === "close") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      plan.push({ type: "close", tabIds });
      continue;
    }

    if (action.type === "newWindow") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      if (typeof action.focused !== "boolean") return invalidParameters();

      hasNewWindow = true;
      plan.push({ type: "newWindow", tabIds, focused: action.focused });
      continue;
    }

    if (action.type === "move") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      if ((action.windowId !== null && !Number.isInteger(action.windowId))
        || !Number.isInteger(action.index) || action.index < -1) {
        return invalidParameters();
      }
      if (action.windowId === null && !hasNewWindow) return invalidParameters();
      if (action.windowId !== null && !windows.has(action.windowId)) {
        return missingWindow(action.windowId);
      }
      plan.push({
        type: "move",
        tabIds,
        windowId: action.windowId,
        index: action.index
      });
      continue;
    }

    if (action.type === "open") {
      if ((action.windowId !== null && !Number.isInteger(action.windowId))
        || !Number.isInteger(action.index) || action.index < -1
        || !Array.isArray(action.tabs) || action.tabs.length === 0) {
        return invalidParameters();
      }
      if (action.windowId === null && !hasNewWindow) return invalidParameters();
      if (action.windowId !== null && !windows.has(action.windowId)) {
        return missingWindow(action.windowId);
      }

      const specifications = [];
      for (const specification of action.tabs) {
        const validated = validateOpenTab(
          specification,
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

    if (action.type === "group") {
      const validated = validateGroup(action, tabs, windows, groups, hasNewWindow, api);
      if (validated.error) return validated;
      plan.push(validated.step);
      continue;
    }

    if (action.type === "ungroup") {
      const tabIds = requireTabIds(action.tabIds, tabs);
      if (tabIds.error) return tabIds;
      if (!api?.tabs?.ungroup) return unsupportedOperation();
      plan.push({ type: "ungroup", tabIds });
      continue;
    }

    return unsupportedOperation();
  }

  return { plan };
}

const GROUP_COLORS = new Set([
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"
]);

function validateGroup(action, tabs, windows, groups, hasNewWindow, api) {
  const tabIds = requireTabIds(action.tabIds, tabs);
  if (tabIds.error) return tabIds;
  if (!api?.tabs?.group) return unsupportedOperation();

  if (Object.hasOwn(action, "groupId")) {
    if (!Number.isInteger(action.groupId)
      || Object.hasOwn(action, "windowId")
      || Object.hasOwn(action, "title")
      || Object.hasOwn(action, "color")
      || Object.hasOwn(action, "collapsed")) {
      return invalidParameters();
    }
    if (!groups.has(action.groupId)) return missingGroup(action.groupId);
    return { step: { type: "group", tabIds, groupId: action.groupId } };
  }

  if (!api?.tabGroups?.query || !api?.tabGroups?.update) return unsupportedOperation();
  if (typeof action.title !== "string"
    || !GROUP_COLORS.has(action.color)
    || typeof action.collapsed !== "boolean") {
    return invalidParameters();
  }

  if (Object.hasOwn(action, "windowId")) {
    if (action.windowId === null) {
      if (!hasNewWindow) return invalidParameters();
    } else if (!Number.isInteger(action.windowId)) {
      return invalidParameters();
    } else if (!windows.has(action.windowId)) {
      return missingWindow(action.windowId);
    }
  }

  const step = {
    type: "group",
    tabIds,
    title: action.title,
    color: action.color,
    collapsed: action.collapsed
  };
  if (Object.hasOwn(action, "windowId")) step.windowId = action.windowId;
  return { step };
}

function validateOpenTab(tab, tabs, containers, platform) {
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

function missingGroup(groupId) {
  return {
    error: {
      code: -32002,
      message: `Group ${groupId} is missing`
    }
  };
}

function unsupportedOperation() {
  return { error: { code: -32003, message: "The browser does not support the operation" } };
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
  let lastNewWindowId = null;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    try {
      if (step.type === "newWindow") {
        const created = await executeNewWindow(api, step);
        const result = { index, ok: !created.error };
        if (created.windowId !== null) result.windowId = created.windowId;
        if (created.error) {
          result.error = nativeFailure(created.error);
          results.push(result);
          return { results, failed: true };
        }
        lastNewWindowId = created.windowId;
        results.push(result);
        continue;
      }
      if (step.type === "move") {
        const windowId = step.windowId ?? lastNewWindowId;
        const moved = await api.tabs.move(step.tabIds, {
          windowId,
          index: step.index
        });
        const list = Array.isArray(moved) ? moved : [moved];
        results.push({
          index,
          ok: true,
          intendedCount: step.tabIds.length,
          movedCount: list.length,
          windowId: list.length === 0 ? windowId : list[0].windowId,
          firstIndex: list.length === 0 ? null : list[0].index,
          lastIndex: list.length === 0 ? null : list[list.length - 1].index
        });
        continue;
      }
      if (step.type === "group") {
        const groupStep = Object.hasOwn(step, "windowId") && step.windowId === null
          ? { ...step, windowId: lastNewWindowId }
          : step;
        const grouped = await executeGroup(api, groupStep);
        const result = { index, ok: !grouped.error };
        if (grouped.groupId !== null) result.groupId = grouped.groupId;
        if (grouped.error) {
          result.error = nativeFailure(grouped.error);
          results.push(result);
          return { results, failed: true };
        }
        results.push(result);
        continue;
      }
      if (step.type === "ungroup") {
        await api.tabs.ungroup(step.tabIds);
        results.push({ index, ok: true });
        continue;
      }
      if (step.type === "open") {
        const opened = await executeOpen(api, {
          ...step,
          windowId: step.windowId ?? lastNewWindowId
        }, platform);
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
        const closedTabIds = [...step.tabIds];
        await api.tabs.remove(closedTabIds);
        results.push({
          index,
          ok: true,
          closedTabIds,
          closedCount: closedTabIds.length
        });
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

async function executeGroup(api, step) {
  let groupId = null;
  try {
    if (Object.hasOwn(step, "groupId")) {
      groupId = await api.tabs.group({ tabIds: step.tabIds, groupId: step.groupId });
    } else {
      const options = { tabIds: step.tabIds };
      if (Object.hasOwn(step, "windowId")) {
        options.createProperties = { windowId: step.windowId };
      }
      groupId = await api.tabs.group(options);
      await api.tabGroups.update(groupId, {
        title: step.title,
        color: step.color,
        collapsed: step.collapsed
      });
    }
    return { groupId, error: null };
  } catch (error) {
    return { groupId, error };
  }
}

async function executeNewWindow(api, step) {
  let windowId = null;
  try {
    const created = await api.windows.create({ focused: step.focused });
    windowId = created?.id ?? null;
    await api.tabs.move(step.tabIds, { windowId, index: -1 });
    return { windowId, error: null };
  } catch (error) {
    return { windowId, error };
  }
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
        try {
          const opener = await api.tabs.get(specification.openerTabId);
          if (opener.windowId === step.windowId) {
            properties.openerTabId = specification.openerTabId;
          }
        } catch {
          // Opener relationships are best effort.
        }
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
