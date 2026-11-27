/**
 * The app's version id (`v1`, `v2`, … from `nextVersionId` in repo.ts) counts uploads of a document
 * in the app. It is not the version printed in the document, so the UI shows it as "Upload N".
 */
export function uploadNumber(versionId: string): number {
  const match = /^v([1-9]\d*)$/.exec(versionId);
  if (match === null) throw new RangeError(`not an app version id (expected v1, v2, …): ${JSON.stringify(versionId)}`);
  return Number(match[1]);
}
