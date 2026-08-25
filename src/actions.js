export function validate(state, actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { error: { code: -32602, message: "Invalid parameters" } };
  }

  const tabs = new Set();
  for (const window of state.windows ?? []) {
    for (const tab of window.tabs ?? []) {
      if (typeof tab.id === "number") tabs.add(tab.id);
    }
  }

  const plan = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }
    if (action.type !== "close") {
      return { error: { code: -32003, message: "The browser does not support the operation" } };
    }
    if (!Array.isArray(action.tabIds) || action.tabIds.length === 0) {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }
    for (const tabId of action.tabIds) {
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
      tabs.delete(tabId);
    }
    plan.push({ type: "close", tabIds: action.tabIds });
  }

  return { plan };
}

export async function execute(api, plan) {
  const results = [];
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    try {
      if (!api.tabs?.remove) {
        results.push({
          index,
          ok: false,
          error: { code: "UNSUPPORTED_OPERATION", message: "tabs.remove is missing" }
        });
        return { results, failed: true };
      }
      await api.tabs.remove(step.tabIds);
      results.push({ index, ok: true });
    } catch (error) {
      results.push({
        index,
        ok: false,
        error: {
          code: "TAB_NOT_FOUND",
          message: error?.message ?? "Tab is missing"
        }
      });
      return { results, failed: true };
    }
  }
  return { results, failed: false };
}
