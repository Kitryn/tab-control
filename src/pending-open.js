const PREFIX = "data:text/html;charset=utf-8,";
const MARKER = "#tab-control-pending-open=";
const DOCUMENT = `<!doctype html><meta charset="utf-8"><title></title><script>
const marker="${MARKER}";
const [target,title]=JSON.parse(decodeURIComponent(location.hash.slice(marker.length)));
document.title=title;
const open=()=>{if(document.visibilityState==="visible")location.replace(target)};
document.addEventListener("visibilitychange",open);
open();
</script>`;
const DOCUMENT_URL = PREFIX + encodeURIComponent(DOCUMENT);

export function encodePendingOpen(url, title) {
  return DOCUMENT_URL + MARKER + encodeURIComponent(JSON.stringify([url, title]));
}

export function decodePendingOpen(value) {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return null;
  const marker = value.lastIndexOf(MARKER);
  if (marker === -1) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(value.slice(marker + MARKER.length)));
    if (!Array.isArray(decoded) || decoded.length !== 2
      || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
      return null;
    }
    const url = new URL(decoded[0]);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { url: decoded[0], title: decoded[1] };
  } catch {
    return null;
  }
}
