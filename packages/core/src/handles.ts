// Encrypted store for Pine handles in missions.pine_enc (plan 5, rule 2).
// The pk_, ct_ and ps_ tokens never leave the server and never sit in the database as plain text.

import { decrypt, encrypt } from "./crypto";
import { sql } from "./db";

/**
 * Everything the server needs to rebuild the Pine Computer and session for one mission.
 * The field names follow plan section 5. Serialized values are the strings the Pine SDK returns.
 */
export interface PineHandle {
  /** credentials.serialize() */
  credentials: string;
  /** computer.binding().serialize() */
  binding: string;
  sessionName: string;
  /** Pine returns the session token one time only. */
  sessionToken: string;
  computerId?: string;
  turnId?: string;
}

/**
 * Encrypts the handle and stores it on the mission.
 * Throws when the mission does not exist.
 */
export async function saveHandle(missionId: string, handle: PineHandle): Promise<void> {
  const encrypted = encrypt(JSON.stringify(handle));
  const rows = await sql()`
    update missions set pine_enc = ${encrypted} where id = ${missionId} returning id
  `;
  if (rows.length === 0) {
    throw new Error(`Cannot save the Pine handle: mission ${missionId} does not exist.`);
  }
}

/**
 * Loads and decrypts the handle for the mission.
 * Returns null when the mission does not exist or has no handle yet.
 */
export async function loadHandle(missionId: string): Promise<PineHandle | null> {
  const rows = (await sql()`
    select pine_enc from missions where id = ${missionId}
  `) as Array<{ pine_enc: string | null }>;
  const encrypted = rows[0]?.pine_enc;
  if (!encrypted) {
    return null;
  }
  return JSON.parse(decrypt(encrypted)) as PineHandle;
}
