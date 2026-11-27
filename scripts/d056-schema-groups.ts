import { expandToolSchemaGroup, groupToolSchemas } from '../src/tools/schema-groups.ts';

const groups = groupToolSchemas([
  { name: 'read_file', description: '读取文件', parameters: { type: 'object' } },
  { name: 'git_status', description: '查看状态', parameters: { type: 'object' } },
  { name: 'weather', description: '查询天气', parameters: { type: 'object' } },
], 2);
const expanded = expandToolSchemaGroup(groups, 'group-2');
process.stdout.write(`${JSON.stringify({ groups, expanded }, null, 2)}\n`);
if (groups.length !== 2 || expanded[0]?.name !== 'weather') {
  process.stderr.write('D056 SCHEMA GROUP FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D056 SCHEMA GROUP PASS\n');
