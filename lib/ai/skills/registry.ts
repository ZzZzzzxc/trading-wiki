import type { SkillTool, SkillContext } from './types';

export class ToolRegistry {
  private tools = new Map<string, SkillTool>();

  register(tool: SkillTool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[skills] 工具 "${tool.name}" 已注册，将被覆盖`);
    }
    this.tools.set(tool.name, tool);
  }

  registerPackage(tools: SkillTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(name: string): SkillTool | undefined {
    return this.tools.get(name);
  }

  /** 获取当前上下文可见的所有工具 */
  getActive(ctx: SkillContext): SkillTool[] {
    const result: SkillTool[] = [];
    for (const tool of this.tools.values()) {
      if (tool.isActive && !tool.isActive(ctx)) continue;
      result.push(tool);
    }
    return result;
  }

  /** 转换为 Vercel AI SDK tool 格式 */
  toAISdkTools(ctx: SkillContext): Record<string, unknown> {
    const tools: Record<string, unknown> = {};
    for (const tool of this.getActive(ctx)) {
      tools[tool.name] = {
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (args: unknown) => {
          // beforeCall hook
          if (tool.beforeCall) {
            const hookResult = await tool.beforeCall(args, ctx);
            if (hookResult && 'block' in hookResult && hookResult.block) {
              throw new Error(hookResult.reason || '工具调用被阻断');
            }
          }
          // execute
          let result = await tool.execute(args, ctx);
          // afterCall hook
          if (tool.afterCall) {
            result = await tool.afterCall(result, ctx);
          }
          return result;
        },
      };
    }
    return tools;
  }

  /** 获取所有已注册工具 */
  getAll(): SkillTool[] {
    return Array.from(this.tools.values());
  }

  /** 按技能包分组获取 */
  getBySkill(): Map<string, SkillTool[]> {
    const groups = new Map<string, SkillTool[]>();
    for (const tool of this.tools.values()) {
      const list = groups.get(tool.skill) ?? [];
      list.push(tool);
      groups.set(tool.skill, list);
    }
    return groups;
  }
}

/** 全局单例 */
export const toolRegistry = new ToolRegistry();
