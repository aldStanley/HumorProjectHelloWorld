// Next can construct request.url with an internal hostname. The browser's Host
// identifies the public origin; scripts on other sites cannot override it.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ["https:", "http:"].includes(url.protocol) && url.origin === origin && url.host === request.headers.get("host");
  } catch { return false; }
}
