const STORAGE_KEY = "instanceId";

export async function loadInstance(api) {
  const stored = await readInstanceId(api);
  const instanceId = stored ?? crypto.randomUUID();
  if (stored !== instanceId) {
    await api.storage.local.set({ [STORAGE_KEY]: instanceId });
  }
  return { instanceId, browser: await browserName(api) };
}

async function readInstanceId(api) {
  const result = await api.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) {
    return undefined;
  }
  return value;
}

async function browserName(api) {
  if (typeof api.runtime.getBrowserInfo === "function") {
    const info = await api.runtime.getBrowserInfo();
    if (info?.name) {
      return info.name;
    }
  }

  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands)) {
    for (const entry of brands) {
      const brand = entry?.brand;
      if (brand === "Google Chrome") return "Chrome";
      if (brand === "Microsoft Edge") return "Edge";
      if (brand === "Brave" || brand === "Opera" || brand === "Vivaldi") {
        return brand;
      }
    }
    if (brands.some((entry) => entry?.brand === "Chromium")) {
      return "Chromium";
    }
  }

  const userAgent = navigator.userAgent;
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/")) return "Chrome";
  return "Chromium";
}
