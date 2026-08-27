import assert from "node:assert/strict";
import test from "node:test";
import { loadInstance, saveProfileName } from "../src/instance.js";

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
  assert.equal(first.name, null);
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

test("profile name is trimmed, stored, and can be cleared", async () => {
  const { api, stored } = storageApi();

  assert.equal(await saveProfileName(api, "  work  "), "work");
  assert.equal((await loadInstance(api)).name, "work");
  assert.equal(stored.profileName, "work");

  assert.equal(await saveProfileName(api, "   "), null);
  assert.equal((await loadInstance(api)).name, null);
  assert.equal(stored.profileName, null);

  await assert.rejects(
    saveProfileName(api, "x".repeat(65)),
    /must not exceed 64 characters/
  );
});

function storageApi() {
  const stored = {};
  return {
    stored,
    api: {
      storage: {
        local: {
          get: async (key) => (key in stored ? { [key]: stored[key] } : {}),
          set: async (values) => Object.assign(stored, values)
        }
      },
      runtime: {}
    }
  };
}

function withBrands(brands, run) {
  const previous = Object.getOwnPropertyDescriptor(navigator, "userAgentData");
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { brands }
  });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous) Object.defineProperty(navigator, "userAgentData", previous);
      else delete navigator.userAgentData;
    });
}

test("browserName prefers Brave over Google Chrome in brands", async () => {
  await withBrands(
    [
      { brand: "Not A Brand", version: "99" },
      { brand: "Google Chrome", version: "120" },
      { brand: "Chromium", version: "120" },
      { brand: "Brave", version: "120" }
    ],
    async () => {
      const { api } = storageApi();
      assert.equal((await loadInstance(api)).browser, "Brave");
    }
  );
});

test("browserName uses Google Chrome when that is the product brand", async () => {
  await withBrands(
    [
      { brand: "Not A Brand", version: "99" },
      { brand: "Chromium", version: "120" },
      { brand: "Google Chrome", version: "120" }
    ],
    async () => {
      const { api } = storageApi();
      assert.equal((await loadInstance(api)).browser, "Chrome");
    }
  );
});
