/** Pure URL / cache helpers for the service worker. */

export function isObsoleteShellCache(name, currentShellCache) {
  const key = String(name || "");
  if (!key || key === currentShellCache) return false;
  return true;
}

export function isShellRequest(url) {
  try {
    const u = typeof url === "string" ? new URL(url, "https://example.invalid") : url;
    const path = u.pathname;
    return (
      path.endsWith(".js") ||
      path.endsWith(".css") ||
      path.endsWith(".webmanifest") ||
      path.endsWith(".html") ||
      path.endsWith("/") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".png") ||
      path.endsWith(".webp") ||
      /\/icons\//.test(path) ||
      /\/images\//.test(path)
    );
  } catch {
    return false;
  }
}

export function shellCacheName(buildHash) {
  return `skull-king-${buildHash || "dev"}`;
}
