const API_VERSION = "2022-11-28";

export function createGitHubClient({ token, repository, fetchImpl = fetch }) {
  if (!repository?.includes("/")) {
    throw new Error("A GitHub repository in owner/name form is required");
  }
  const baseUrl = `https://api.github.com/repos/${repository}`;

  async function request(path, options = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "github-enterprise-settings-configurator-product-watch/1.0",
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = body?.message ?? `${response.status} ${response.statusText}`;
      const details = body?.errors ? ` ${JSON.stringify(body.errors)}` : "";
      throw new Error(`GitHub API ${options.method ?? "GET"} ${path}: ${message}${details}`);
    }
    return body;
  }

  return {
    async listIssues(label) {
      const issues = [];
      for (let page = 1; ; page += 1) {
        const query = new URLSearchParams({
          labels: label,
          state: "all",
          per_page: "100",
          page: String(page),
        });
        const batch = await request(`/issues?${query}`);
        issues.push(...batch.filter((issue) => !issue.pull_request));
        if (batch.length < 100) {
          return issues;
        }
      }
    },

    async ensureLabel(name, color, description) {
      try {
        return await request("/labels", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({name, color, description}),
        });
      } catch (error) {
        if (error.message.includes("already_exists")) {
          return null;
        }
        throw error;
      }
    },

    createIssue({title, body, labels}) {
      return request("/issues", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title, body, labels}),
      });
    },

    updateIssue(number, fields) {
      return request(`/issues/${number}`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(fields),
      });
    },
  };
}
