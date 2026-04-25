// Single source of truth for the GitHub repo coordinates. Reads from
// package.json#repository.url so external-link allowlisting in main.ts and
// electron-builder.yml's publish config don't drift apart on a repo move.
//
// electron-builder also reads package.json#repository when publish.owner/repo
// are omitted, so we leave the YAML clean and rely on this one declaration.

import pkg from "../package.json";

function parse(repoUrl: string): { owner: string; repo: string } {
  // Accept https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git
  const httpsMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!httpsMatch) {
    throw new Error(`Cannot parse GitHub owner/repo from package.json#repository.url: ${repoUrl}`);
  }
  return { owner: httpsMatch[1], repo: httpsMatch[2] };
}

const repository = (pkg as { repository?: { url?: string } }).repository;
if (!repository?.url) {
  throw new Error("package.json#repository.url is missing — required for update feed and external links");
}

export const { owner: GITHUB_OWNER, repo: GITHUB_REPO } = parse(repository.url);
export const GITHUB_REPO_PATH = `/${GITHUB_OWNER}/${GITHUB_REPO}`;
