export function validate(state, actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { error: { code: -32602, message: "Invalid parameters" } };
  }

  const tabs = new Set();
  const windows = new Set();
  for (const window of state.windows) {
    if (typeof window.id === "number") windows.add(window.id);
    for (const tab of window.tabs) {
      if (typeof tab.id === "number") tabs.add(tab.id);
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
      if (!Number.isInteger(action.windowId) || !Number.isInteger(action.index) || action.index < -1) {
        return { error: { code: -32602, message: "Invalid parameters" } };
      }
      if (!windows.has(action.windowId)) {
        return {
          error: {
            code: -32002,
            message: `Window ${action.windowId} is missing`
          }
        };
      }
      plan.push({
        type: "move",
        tabIds,
        windowId: action.windowId,
        index: action.index
      });
      continue;
    }

    return { error: { code: -32003, message: "The browser does not support the operation" } };
  }

  return { plan };
}

function requireTabIds(tabIds, tabs) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    return { error: { code: -32602, message: "Invalid parameters" } };
  }
  for (const tabId of tabIds) {
    if (typeof tabId !== "number") {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }
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

export async function execute(api, plan) {
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
        results.push({
          index,
          ok: true,
          tabs: list.map((tab) => ({
            id: tab.id,
            windowId: tab.windowId,
            index: tab.index
          }))
        });
        continue;
      }
      await api.tabs.remove(step.tabIds);
      results.push({ index, ok: true });
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

function nativeFailure(error) {
  const message = typeof error?.message === "string" && error.message.length > 0
    ? error.message
    : "The browser rejected the action";
  const text = message.toLowerCase();
  if (text.includes("window")) {
    return { code: "WINDOW_NOT_FOUND", message };
  }
  if (text.includes("tab")) {
    return { code: "TAB_NOT_FOUND", message };
  }
  return { code: "UNSUPPORTED_OPERATION", message };
}
