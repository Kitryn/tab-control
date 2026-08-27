import { validate, execute } from "./actions.js";

export function createChange(api, inventory, platform, actions = { validate, execute }) {
  let busy = null;
  let nextId = 1;

  function begin() {
    if (busy) return null;
    let settle;
    busy = new Promise((resolve) => {
      settle = resolve;
    });
    return () => {
      busy = null;
      settle();
    };
  }

  async function idle() {
    if (busy) await busy;
  }

  async function apply(params) {
    if (!params || typeof params.revision !== "number" || typeof params.description !== "string"
      || params.description.trim() === "") {
      return { error: { code: -32602, message: "Invalid parameters" } };
    }

    const actualRevision = inventory.currentRevision();
    if (params.revision !== actualRevision) {
      return {
        error: {
          code: -32001,
          message: "The browser state changed",
          data: { expectedRevision: params.revision, actualRevision }
        }
      };
    }

    const state = await inventory.get();
    const validated = actions.validate(state, params.actions, platform, api);
    if (validated.error) return { error: validated.error };

    const changeId = String(nextId);
    nextId += 1;

    const executed = await actions.execute(api, validated.plan, platform);
    const revision = inventory.currentRevision();
    const result = {
      changeId,
      revision,
      complete: !executed.failed,
      actions: executed.results
    };
    return { result };
  }

  return { begin, idle, apply };
}
