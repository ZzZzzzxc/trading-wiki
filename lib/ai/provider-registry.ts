import type { LLMProvider } from './provider';

export type TaskType = 'generation' | 'structured' | 'vision' | 'debate' | 'stream';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private taskMap = new Map<TaskType, string[]>();

  register(name: string, provider: LLMProvider, tasks?: TaskType[]): void {
    this.providers.set(name, provider);
    if (tasks) {
      for (const task of tasks) {
        const existing = this.taskMap.get(task) ?? [];
        existing.push(name);
        this.taskMap.set(task, existing);
      }
    }
  }

  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  getForTask(task: TaskType): LLMProvider {
    const candidates = this.taskMap.get(task);
    if (!candidates || candidates.length === 0) {
      throw new Error(`没有注册支持任务 "${task}" 的 Provider`);
    }
    const provider = this.providers.get(candidates[0]);
    if (!provider) throw new Error(`Provider "${candidates[0]}" 未注册`);
    return provider;
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }
}

/** 全局单例 */
export const providerRegistry = new ProviderRegistry();
