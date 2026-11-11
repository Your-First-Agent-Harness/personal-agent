import type { Tool } from '../core/tool.ts';
import { listDirTool, readFileTool } from './fs.ts';
import { writeFileTool } from './write-file.ts';

export function createBuiltinTools(): Tool[] {
  return [readFileTool, listDirTool, writeFileTool];
}
