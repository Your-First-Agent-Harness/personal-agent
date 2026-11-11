export function createUnifiedDiff(path: string, before: string, after: string): string {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      body.push(` ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      body.push(`-${oldLines[i]}`);
      i += 1;
    } else {
      body.push(`+${newLines[j]}`);
      j += 1;
    }
  }
  while (i < oldLines.length) body.push(`-${oldLines[i++]}`);
  while (j < newLines.length) body.push(`+${newLines[j++]}`);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...body,
    '',
  ].join('\n');
}
