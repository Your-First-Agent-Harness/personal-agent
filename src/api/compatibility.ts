export interface ApiManifest { readonly version: string; readonly exports: readonly string[]; }

export function compareApiManifests(previous: ApiManifest, current: ApiManifest): { readonly removed: readonly string[]; readonly added: readonly string[]; readonly compatible: boolean } {
  const oldExports = new Set(previous.exports);
  const newExports = new Set(current.exports);
  const removed = previous.exports.filter((name) => !newExports.has(name));
  const added = current.exports.filter((name) => !oldExports.has(name));
  return { removed, added, compatible: removed.length === 0 };
}
