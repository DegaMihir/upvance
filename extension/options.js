/* global getConfig, api, DEFAULT_APP_URL */
const appUrlEl = document.getElementById("appUrl");
const tokenEl = document.getElementById("token");
const status = document.getElementById("status");

getConfig().then(({ appUrl, token }) => {
  appUrlEl.value = appUrl || DEFAULT_APP_URL;
  tokenEl.value = token;
});

document.getElementById("save").addEventListener("click", async () => {
  let appUrl = appUrlEl.value.trim() || DEFAULT_APP_URL;
  try {
    const u = new URL(appUrl);
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new Error("For your privacy the extension only connects to an app on this computer (localhost).");
    appUrl = u.origin;
  } catch (e) {
    status.innerHTML = `<div class="error">${e.message || "Invalid URL"}</div>`;
    return;
  }
  await chrome.storage.local.set({ appUrl, token: tokenEl.value.trim() });
  status.textContent = "Testing…";
  try {
    const r = await api("/api/extension/ping");
    status.innerHTML = `<span class="ok">Connected to ${r.app} as ${r.email}.</span>`;
  } catch (e) {
    status.innerHTML = `<div class="error">${e.message}</div>`;
  }
});
