export interface SchemaIssue {
  readonly path: string;
  readonly expected: string;
  readonly message: string;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

function validateNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): SchemaIssue | undefined {
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return { path, expected: enumValues.map(String).join(' / '), message: '不是允许的枚举值' };
  }

  const type = schema['type'];
  if (typeof type === 'string' && !matchesType(type, value)) {
    return {
      path,
      expected: type,
      message: `期望 ${type}，实际为 ${Array.isArray(value) ? 'array' : typeof value}`,
    };
  }
  if (type !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const rawProperties = schema['properties'];
  const properties =
    rawProperties !== null && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
      ? (rawProperties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((key): key is string => typeof key === 'string')
    : [];

  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      return { path: `${path}.${key}`, expected: '必填字段', message: '缺少必填字段' };
    }
  }
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(properties, key)) {
        return {
          path: `${path}.${key}`,
          expected: `仅允许 ${Object.keys(properties).join(', ')}`,
          message: '存在额外字段',
        };
      }
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(record, key)) continue;
    const issue = validateNode(propertySchema, record[key], `${path}.${key}`);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

export function validateArguments(
  schema: Record<string, unknown>,
  value: unknown,
): SchemaIssue | undefined {
  return validateNode(schema, value, '$');
}
