export function createGitHubClient({apiRoot, graphqlUrl, repository, token}) {
  if (!apiRoot || !graphqlUrl || !repository || !token) {
    throw new Error("GitHub API roots, repository, and token are required.");
  }
  const [owner, name] = repository.split("/");
  if (!owner || !name) {
    throw new Error("Repository must use owner/name format.");
  }

  async function request(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${apiRoot}/repos/${repository}${pathOrUrl}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "github-enterprise-settings-configurator-copilot-evaluation",
        "x-github-api-version": "2022-11-28",
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
    }
    return response;
  }

  async function collectPages(path) {
    const items = [];
    let url = `${apiRoot}/repos/${repository}${path}`;
    while (url) {
      const response = await request(url);
      items.push(...await response.json());
      url = null;
      for (const part of String(response.headers.get("link") ?? "").split(",")) {
        const match = part.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          url = match[1];
          break;
        }
      }
    }
    return items;
  }

  return {
    collectPages,
    async listReviewIssuesWithComments(label) {
      const issues = [];
      let cursor = null;
      do {
        const response = await request(graphqlUrl, {
          method: "POST",
          body: JSON.stringify({
            query: `
              query ManagedReviewIssues(
                $owner: String!,
                $name: String!,
                $label: String!,
                $cursor: String
              ) {
                repository(owner: $owner, name: $name) {
                  issues(
                    first: 100,
                    after: $cursor,
                    states: OPEN,
                    labels: [$label],
                    orderBy: {field: UPDATED_AT, direction: DESC}
                  ) {
                    nodes {
                      number
                      title
                      url
                      body
                      state
                      updatedAt
                      labels(first: 100) {
                        nodes { name }
                      }
                      comments(last: 100) {
                        totalCount
                        nodes {
                          body
                          author {
                            login
                            __typename
                          }
                        }
                      }
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                }
              }
            `,
            variables: {owner, name, label, cursor},
          }),
        });
        const payload = await response.json();
        if (payload.errors?.length) {
          throw new Error(`GitHub GraphQL request failed: ${payload.errors[0].message}`);
        }
        const connection = payload.data?.repository?.issues;
        if (!connection) {
          throw new Error("GitHub GraphQL response did not contain repository issues.");
        }
        for (const node of connection.nodes) {
          let comments = node.comments.nodes.map((comment) => ({
            body: comment.body,
            user: {
              login: comment.author?.login,
              type: comment.author?.__typename,
            },
          }));
          if (node.comments.totalCount > comments.length) {
            comments = await collectPages(`/issues/${node.number}/comments?per_page=100`);
          }
          issues.push({
            number: node.number,
            title: node.title,
            html_url: node.url,
            body: node.body,
            state: node.state.toLowerCase(),
            updated_at: node.updatedAt,
            labels: node.labels.nodes,
            comments,
          });
        }
        cursor = connection.pageInfo.hasNextPage
          ? connection.pageInfo.endCursor
          : null;
      } while (cursor);
      return issues;
    },
    async addIssueComment(number, body) {
      await request(`/issues/${number}/comments`, {
        method: "POST",
        body: JSON.stringify({body}),
      });
    },
  };
}
