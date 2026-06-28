/**
 * 轻量 DAG 引擎。
 * 拓扑排序执行有向无环图，节点间通过共享的 Map 上下文传递数据。
 */

export interface GraphNode {
  id: string;
  /** 依赖节点的 ID 列表，这些节点执行完后才会执行本节点 */
  deps: string[];
  /** 执行函数。ctx 是所有已完成节点的输出集合 */
  execute: (ctx: Map<string, unknown>) => Promise<unknown>;
}

export class SimpleGraph {
  private nodes = new Map<string, GraphNode>();

  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`节点 "${node.id}" 已存在`);
    }
    this.nodes.set(node.id, node);
  }

  /**
   * 执行图。
   * @param initialCtx 初始上下文数据
   * @returns 所有节点的输出（nodeId → output）
   */
  async execute(initialCtx: Record<string, unknown> = {}): Promise<Map<string, unknown>> {
    const ctx = new Map<string, unknown>(Object.entries(initialCtx));
    const completed = new Set<string>();
    const pending = new Set(this.nodes.keys());

    // 拓扑排序：每次找出所有依赖已满足的节点并行执行
    while (pending.size > 0) {
      const ready: GraphNode[] = [];
      for (const id of pending) {
        const node = this.nodes.get(id)!;
        if (node.deps.every(d => completed.has(d))) {
          ready.push(node);
        }
      }

      if (ready.length === 0) {
        // 死锁检测
        const deps = [...pending].map(id => `${id} → [${this.nodes.get(id)!.deps.join(', ')}]`).join('; ');
        throw new Error(`图执行死锁: 待处理 ${[...pending].join(', ')} 的依赖未满足. ${deps}`);
      }

      // 并行执行所有就绪节点
      await Promise.all(ready.map(async (node) => {
        try {
          const output = await node.execute(ctx);
          ctx.set(node.id, output);
          completed.add(node.id);
          pending.delete(node.id);
        } catch (err) {
          throw new Error(`节点 "${node.id}" 执行失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }));
    }

    return ctx;
  }

  /** 获取所有节点 ID */
  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }
}
