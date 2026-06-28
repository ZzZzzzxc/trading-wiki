import { z } from 'zod';

/** 工具执行上下文 */
export interface SkillContext {
  question: string;
  intent?: string;
  entities?: { stocks?: Array<{ name: string; code?: string }>; themes?: string[] };
  [key: string]: unknown;
}

/** 工具定义 */
export interface SkillTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** 工具所属技能包 */
  skill: string;
  /** 执行函数 */
  execute: (args: unknown, ctx: SkillContext) => Promise<unknown>;
  /** 是否在当前上下文可见（可选） */
  isActive?: (ctx: SkillContext) => boolean;
  /** 调用前钩子（可阻断） */
  beforeCall?: (args: unknown, ctx: SkillContext) => Promise<{ block?: boolean; reason?: string } | void>;
  /** 调用后钩子（可修改结果） */
  afterCall?: (result: unknown, ctx: SkillContext) => Promise<unknown>;
}

/** 技能包定义 */
export interface SkillPackage {
  name: string;
  description: string;
  tools: SkillTool[];
}
