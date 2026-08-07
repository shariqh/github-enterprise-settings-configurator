import {isAllowedAuthoritativeUrl} from "./core.mjs";

const MAX_REDIRECTS = 3;

export async function verifyAuthoritativeUrls(
  urls,
  {
    fetchImpl = fetch,
    maxRedirects = MAX_REDIRECTS,
    timeoutMs = 10000,
  } = {},
) {
  const uniqueUrls = [...new Set(urls)];
  for (const initialUrl of uniqueUrls) {
    if (!isAllowedAuthoritativeUrl(initialUrl)) {
      throw new Error(`Evidence URL is not an allowed authoritative GitHub source: ${initialUrl}`);
    }

    let currentUrl = initialUrl;
    const visited = new Set();
    for (let redirectCount = 0; ; redirectCount += 1) {
      if (visited.has(currentUrl)) {
        throw new Error(`Evidence URL redirect loop detected: ${initialUrl}`);
      }
      visited.add(currentUrl);

      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "github-enterprise-settings-configurator-copilot-evaluation",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= maxRedirects) {
          throw new Error(`Evidence URL exceeded ${maxRedirects} redirects: ${initialUrl}`);
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Evidence URL returned a redirect without a location: ${currentUrl}`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isAllowedAuthoritativeUrl(nextUrl)) {
          throw new Error(`Evidence URL redirected outside allowed GitHub sources: ${nextUrl}`);
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Evidence URL returned HTTP ${response.status}: ${currentUrl}`);
      }
      await response.body?.cancel();
      break;
    }
  }
}
