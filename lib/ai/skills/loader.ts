import { toolRegistry } from './registry';
import type { SkillTool } from './types';

/** 注册一组工具（手动调用，替代文件扫描） */
export function registerSkills(tools: SkillTool[]): void {
  toolRegistry.registerPackage(tools);
  console.log(`[skills] 已注册 ${tools.length} 个工具`);
}

/** 获取当前可用的研究技能包工具 */
export function getResearchTools(ctx: { question: string }) {
  return toolRegistry.getActive(ctx);
}
