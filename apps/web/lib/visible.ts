// Which connected repositories a signed-in person may view (docs/github-access-contract.md
// section 7): the selected repositories of active installations where their resolved access
// allows viewing. Reads use the 60-second cache. Server code only.

import { sql, type RepositoryRow } from "@pinepoint/core";
import { resolveRepositoryAccess, type AccessResult } from "@pinepoint/github/access";

/** The selected repositories of every active installation. The access check narrows them per person. */
export async function connectedRepositories(): Promise<RepositoryRow[]> {
  return (await sql()`
    select r.* from repositories r
    join installations i on i.id = r.installation_id
    where r.selected and i.status = 'active'
    order by r.full_name
  `) as RepositoryRow[];
}

export interface RepositoryWithAccess {
  repository: RepositoryRow;
  access: AccessResult;
}

/** Every connected repository with this person's access to it. One GitHub read per uncached repository. */
export async function repositoriesWithAccess(userId: string, repositories?: RepositoryRow[]): Promise<RepositoryWithAccess[]> {
  const repos = repositories ?? (await connectedRepositories());
  const results: RepositoryWithAccess[] = [];
  // In series: a person with many repositories would otherwise burst the API. The cache keeps later calls cheap.
  for (const repository of repos) {
    results.push({ repository, access: await resolveRepositoryAccess(userId, repository.id, { fresh: false }) });
  }
  return results;
}

/** The ids of the connected repositories this person may view. */
export async function viewableRepositoryIds(userId: string): Promise<string[]> {
  return (await repositoriesWithAccess(userId)).filter((r) => r.access.canView).map((r) => r.repository.id);
}
