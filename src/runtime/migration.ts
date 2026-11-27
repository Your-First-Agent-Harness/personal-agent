export interface VersionedRecord<T = unknown> { readonly version: number; readonly data: T; }
export type Migration<T> = (data: T) => T;

export function migrateRecord<T>(record: VersionedRecord<T>, targetVersion: number, migrations: ReadonlyMap<number, Migration<T>>): VersionedRecord<T> {
  if (!Number.isSafeInteger(targetVersion) || targetVersion < record.version) throw new Error('目标版本必须不低于当前版本');
  let data = record.data;
  for (let version = record.version; version < targetVersion; version += 1) {
    const migration = migrations.get(version);
    if (migration === undefined) throw new Error(`缺少版本 ${version} 到 ${version + 1} 的迁移`);
    data = migration(data);
  }
  return { version: targetVersion, data };
}
