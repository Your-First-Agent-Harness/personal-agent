export interface AuditItem { readonly id: string; readonly description: string; readonly passed: boolean; readonly evidence: string; }
export interface ReleaseAudit { readonly version: string; readonly items: readonly AuditItem[]; readonly passed: boolean; }

export function createReleaseAudit(version: string, items: readonly AuditItem[]): ReleaseAudit {
  return { version, items, passed: items.length > 0 && items.every(({ passed }) => passed) };
}
