export interface SchemaIssue {
  readonly path: string;
  readonly expected: string;
  readonly message: string;
}

const schemaTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
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
      message: `期望 ${type}，实际为 ${valueType(value)}`,
    };
  }

  if (type === 'string') {
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && Array.from(value as string).length < minLength) {
      return { path, expected: `长度 >= ${minLength}`, message: '字符串长度不足' };
    }
  }

  if (type === 'number' || type === 'integer') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && (value as number) < minimum) {
      return { path, expected: `>= ${minimum}`, message: '数值小于下限' };
    }
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && (value as number) > maximum) {
      return { path, expected: `<= ${maximum}`, message: '数值大于上限' };
    }
  }

  if (type === 'array') {
    const itemSchema = schema['items'];
    if (!isRecord(itemSchema)) return undefined;
    for (const [index, item] of (value as unknown[]).entries()) {
      const issue = validateNode(itemSchema, item, `${path}[${index}]`);
      if (issue !== undefined) return issue;
    }
    return undefined;
  }

  if (type !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const rawProperties = schema['properties'];
  const properties = isRecord(rawProperties) ? rawProperties : {};
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
    if (!Object.hasOwn(record, key) || !isRecord(propertySchema)) continue;
    const issue = validateNode(propertySchema, record[key], `${path}.${key}`);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function validateSchemaNode(
  schema: Record<string, unknown>,
  path: string,
): SchemaIssue | undefined {
  const type = schema['type'];
  if (type !== undefined && (typeof type !== 'string' || !schemaTypes.has(type))) {
    return { path: `${path}.type`, expected: [...schemaTypes].join(' / '), message: '不支持的 Schema 类型' };
  }

  if (Object.hasOwn(schema, 'enum')) {
    const enumValues = schema['enum'];
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      return { path: `${path}.enum`, expected: '非空数组', message: 'enum 必须至少声明一个允许值' };
    }
  }

  if (Object.hasOwn(schema, 'properties')) {
    const properties = schema['properties'];
    if (type !== 'object') {
      return { path: `${path}.properties`, expected: 'type: object', message: 'properties 只能用于对象 Schema' };
    }
    if (!isRecord(properties)) {
      return { path: `${path}.properties`, expected: 'object', message: 'properties 必须是字段到 Schema 的映射' };
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!isRecord(propertySchema)) {
        return { path: `${path}.properties.${key}`, expected: 'object', message: '字段 Schema 必须是对象' };
      }
      const issue = validateSchemaNode(propertySchema, `${path}.properties.${key}`);
      if (issue !== undefined) return issue;
    }
  }

  if (Object.hasOwn(schema, 'required')) {
    const required = schema['required'];
    if (type !== 'object') {
      return { path: `${path}.required`, expected: 'type: object', message: 'required 只能用于对象 Schema' };
    }
    if (!Array.isArray(required)) {
      return { path: `${path}.required`, expected: 'string[]', message: 'required 必须是字符串数组' };
    }
    for (const [index, key] of required.entries()) {
      if (typeof key !== 'string' || key === '') {
        return { path: `${path}.required[${index}]`, expected: '非空字符串', message: 'required 字段名必须是非空字符串' };
      }
    }
  }

  if (Object.hasOwn(schema, 'additionalProperties')) {
    if (type !== 'object') {
      return {
        path: `${path}.additionalProperties`,
        expected: 'type: object',
        message: 'additionalProperties 只能用于对象 Schema',
      };
    }
    if (typeof schema['additionalProperties'] !== 'boolean') {
      return {
        path: `${path}.additionalProperties`,
        expected: 'boolean',
        message: 'additionalProperties 只支持 true 或 false',
      };
    }
  }

  if (Object.hasOwn(schema, 'items')) {
    const items = schema['items'];
    if (type !== 'array') {
      return { path: `${path}.items`, expected: 'type: array', message: 'items 只能用于数组 Schema' };
    }
    if (!isRecord(items)) {
      return { path: `${path}.items`, expected: 'object', message: 'items 必须是单个 Schema 对象' };
    }
    const issue = validateSchemaNode(items, `${path}.items`);
    if (issue !== undefined) return issue;
  }

  if (Object.hasOwn(schema, 'minLength')) {
    const minLength = schema['minLength'];
    if (type !== 'string') {
      return { path: `${path}.minLength`, expected: 'type: string', message: 'minLength 只能用于字符串 Schema' };
    }
    if (typeof minLength !== 'number' || !Number.isInteger(minLength) || minLength < 0) {
      return { path: `${path}.minLength`, expected: '非负整数', message: 'minLength 必须是非负整数' };
    }
  }

  for (const keyword of ['minimum', 'maximum'] as const) {
    if (!Object.hasOwn(schema, keyword)) continue;
    const boundary = schema[keyword];
    if (type !== 'number' && type !== 'integer') {
      return { path: `${path}.${keyword}`, expected: 'type: number / integer', message: `${keyword} 只能用于数值 Schema` };
    }
    if (typeof boundary !== 'number' || !Number.isFinite(boundary)) {
      return { path: `${path}.${keyword}`, expected: '有限数值', message: `${keyword} 必须是有限数值` };
    }
  }
  const minimum = schema['minimum'];
  const maximum = schema['maximum'];
  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    return { path: `${path}.maximum`, expected: `>= ${minimum}`, message: 'maximum 不能小于 minimum' };
  }

  return undefined;
}

/** 注册期检查本 Harness 实际支持的 JSON Schema 子集；工具根输入必须是对象。 */
export function validateToolSchema(schema: Record<string, unknown>): SchemaIssue | undefined {
  if (schema['type'] !== 'object') {
    return { path: '$.type', expected: 'object', message: '工具根 Schema 必须声明 type: object' };
  }
  return validateSchemaNode(schema, '$');
}

export function validateArguments(
  schema: Record<string, unknown>,
  value: unknown,
): SchemaIssue | undefined {
  return validateNode(schema, value, '$');
}
