// The guard the three mission routes share (desktop, desktop-token, control). A mission of a
// private run needs a same-origin request and a session with write access to the run's
// repository: the desktop is live evidence and the controls act on the Computer
// (docs/github-access-contract.md section 7). A mission of a legacy run stays open as before.

import { authorizeMission, type Guarded, type MissionContext } from "./access";
import { rejectCrossSite } from "./auth/csrf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardMission(request: Request, missionId: string): Promise<Guarded<MissionContext>> {
  if (!UUID.test(missionId)) {
    return { ok: false, response: Response.json({ ok: false, error: "This mission has no Pine Computer." }, { status: 404 }) };
  }
  const refused = rejectCrossSite(request);
  if (refused) return { ok: false, response: refused };
  return authorizeMission(request, missionId, "act");
}
