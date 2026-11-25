// Shared helpers for the popup and options pages.
const DEFAULT_APP_URL = "http://localhost:3100";

async function getConfig() {
  const { appUrl, token } = await chrome.storage.local.get(["appUrl", "token"]);
  return { appUrl: (appUrl || DEFAULT_APP_URL).replace(/\/+$/, ""), token: token || "" };
}

async function api(path, { method = "GET", body } = {}) {
  const { appUrl, token } = await getConfig();
  if (!token) throw new Error("Not paired yet. Open the extension options and paste your pairing token from Upvance → Settings.");
  let res;
  try {
    res = await fetch(appUrl + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach Upvance at ${appUrl}. Is it running? (npm run dev)`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upvance returned ${res.status}`);
  return data;
}

async function fetchFileBase64(path) {
  const { appUrl, token } = await getConfig();
  const res = await fetch(appUrl + path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Couldn't download ${path} (${res.status})`);
  const disposition = res.headers.get("content-disposition") || "";
  const name = (disposition.match(/filename="([^"]+)"/) || [])[1] || "document.pdf";
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { name, type: res.headers.get("content-type") || "application/pdf", base64: btoa(bin) };
}
