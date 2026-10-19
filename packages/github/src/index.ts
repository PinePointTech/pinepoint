// @pinepoint/github: Octokit helpers.
// Each feature lives in its own file. Import it by subpath, for example
// "@pinepoint/github/context" or "@pinepoint/github/review", so that work in
// parallel does not need to edit this file.

export { octokit, githubToken, parsePrUrl, prUrl, type Octokit, type PrRef } from "./client";
// The sign-in and organization access modules: app, oauth, user-tokens, access, installations,
// preview. Import them by subpath. octokit() above is the shared legacy token: never use it for a
// connected repository (docs/github-access-contract.md section 4).
