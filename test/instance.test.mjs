import assert from "node:assert/strict";
import test from "node:test";
import { loadInstance } from "../src/instance.js";

test("loadInstance reuses storage.local and mints once", async () => {
  const stored = {};
  const api = {
    storage: {
      local: {
        get: async (key) => (key in stored ? { [key]: stored[key] } : {}),
        set: async (values) => Object.assign(stored, values)
      }
    },
    runtime: {
      getBrowserInfo: async () => ({ name: "Firefox" })
    }
  };

  const first = await loadInstance(api);
  const second = await loadInstance(api);

  assert.equal(first.browser, "Firefox");
  assert.equal(first.instanceId, second.instanceId);
  assert.match(
    first.instanceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  assert.equal(stored.instanceId, first.instanceId);

  stored.instanceId = "not-a-uuid";
  const reminted = await loadInstance(api);
  assert.notEqual(reminted.instanceId, "not-a-uuid");
  assert.equal(stored.instanceId, reminted.instanceId);
});
