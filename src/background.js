const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.runtime.onInstalled.addListener(() => {
  console.info("Tab Control installed");
});
