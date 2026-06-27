'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConfirmDialog } from '@/components/dialogs';

interface UserConfig {
  id: string;
  name: string;
}

interface RawPostMeta {
  id: string;
  userId: string;
  author: string;
  text: string;
  createdAt: string;
  type: string;
  status: string;
  filePath: string;
}

interface FetchResult {
  userId: string;
  author: string;
  fetched: number;
  saved: number;
  skipped: number;
  error?: string;
}

interface LogEntry {
  type: 'info' | 'success' | 'error';
  message: string;
  postId?: string;
}

export function XueqiuWorkbench() {
  const [users, setUsers] = useState<UserConfig[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [posts, setPosts] = useState<RawPostMeta[]>([]);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ userId: string; postId: string } | null>(null);
  const [extractConfirmOpen, setExtractConfirmOpen] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number } | null>(null);

  // 加载用户列表 + 已有帖子
  const loadData = useCallback(async () => {
    try {
      // 加载 watchlist
      const watchlistRes = await fetch('/api/crawler/xueqiu/config');
      if (watchlistRes.ok) {
        const data = await watchlistRes.json();
        setUsers(data.users || []);
        setSelectedUserIds((data.users || []).map((u: UserConfig) => u.id));
      }

      // 加载已有帖子
      const postsRes = await fetch('/api/crawler/xueqiu/posts');
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts || []);
      }
    } catch {
      // 静默失败，等待用户操作
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const addLog = (entry: LogEntry) => {
    setLogs(prev => [entry, ...prev].slice(0, 100)); // 保留最近 100 条
  };

  // 触发抓取
  const handleFetch = async () => {
    if (selectedUserIds.length === 0) {
      setError('请至少选择一个用户');
      return;
    }

    setFetching(true);
    setError(null);
    addLog({ type: 'info', message: `开始抓取 ${selectedUserIds.length} 个用户的帖子...` });

    // 如果 10 秒后还没返回，提示用户检查浏览器
    const loginTimer = setTimeout(() => {
      addLog({
        type: 'info',
        message: '⏳ 等待登录中... 请检查打开的 Chrome 窗口，登录雪球 (xueqiu.com) 后自动继续。',
      });
    }, 10000);

    try {
      const res = await fetch('/api/crawler/xueqiu/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: selectedUserIds,
          maxPosts: 20,
          skipPinned: true,
          skipRetweets: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '抓取失败');
      }

      // 记录结果
      for (const result of data.results as FetchResult[]) {
        if (result.error) {
          addLog({ type: 'error', message: `${result.author}(${result.userId}) 抓取失败: ${result.error}` });
        } else {
          addLog({
            type: 'success',
            message: `${result.author}: 抓取 ${result.fetched} 条，新增 ${result.saved} 条，跳过 ${result.skipped} 条`,
          });
        }
      }

      addLog({ type: 'info', message: `总计新增 ${data.summary?.totalSaved || 0} 条帖子` });

      // 刷新帖子列表
      const postsRes = await fetch('/api/crawler/xueqiu/posts');
      if (postsRes.ok) {
        const postsData = await postsRes.json();
        setPosts(postsData.posts || []);
      }
    } catch (err) {
      const msg = String(err);
      setError(msg);
      addLog({ type: 'error', message: msg });
    } finally {
      clearTimeout(loginTimer);
      setFetching(false);
    }
  };

  // 勾选/取消帖子
  const togglePost = (postId: string) => {
    setSelectedPostIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  // 勾选全部待提取帖子
  const toggleAll = () => {
    const pendings = posts.filter(p => p.status === 'pending');
    const allSelected = pendings.every(p => selectedPostIds.has(p.id));
    setSelectedPostIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        pendings.forEach(p => next.delete(p.id));
      } else {
        pendings.forEach(p => next.add(p.id));
      }
      return next;
    });
  };

  // 批量 AI 提取（显示确认框）
  const handleExtract = () => {
    const toExtract = posts.filter(p => selectedPostIds.has(p.id) && p.status === 'pending');
    if (toExtract.length === 0) {
      setError('没有可提取的帖子（请勾选状态为"待提取"的帖子）');
      return;
    }
    setExtractConfirmOpen(true);
  };

  // 确认执行批量 AI 提取
  const handleConfirmExtract = async () => {
    setExtractConfirmOpen(false);
    const toExtract = posts.filter(p => selectedPostIds.has(p.id) && p.status === 'pending');
    if (toExtract.length === 0) return;

    setExtracting(true);
    setError(null);
    setExtractProgress({ current: 0, total: toExtract.length });
    addLog({ type: 'info', message: `开始 AI 提取 ${toExtract.length} 条帖子...` });

    for (let i = 0; i < toExtract.length; i++) {
      const post = toExtract[i];
      setExtractProgress({ current: i + 1, total: toExtract.length });
      addLog({ type: 'info', message: `[${i + 1}/${toExtract.length}] ${post.author}: "${post.text.slice(0, 30)}..."`, postId: post.id });

      try {
        // 1. 调用 AI 提取观点
        const extractRes = await fetch('/api/ai/extract-viewpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText: post.text,
            author: post.author,
            platform: '雪球',
            date: post.createdAt.slice(0, 10),
            source: `雪球/${post.userId}/${post.id}`,
          }),
        });

        const extractData = await extractRes.json();
        if (!extractRes.ok || !extractData.ok) {
          throw new Error(extractData.error || extractData.message || 'AI 提取失败');
        }

        // 2. 保存为观点文档
        const saveRes = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'viewpoint',
            author: post.author,
            platform: '雪球',
            date: post.createdAt.slice(0, 10),
            source: `雪球/${post.userId}/${post.id}`,
            rawText: post.text,
            extraction: extractData.data,
          }),
        });

        const saveData = await saveRes.json();
        if (!saveRes.ok) {
          throw new Error(saveData.error || '保存观点失败');
        }

        // 3. 更新帖子状态
        const docId = saveData.data?.id || '';
        await fetch('/api/crawler/xueqiu/posts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: post.userId,
            postId: post.id,
            status: 'extracted',
            viewpointDocId: docId,
          }),
        });

        addLog({ type: 'success', message: `✓ ${post.author} → 已保存为观点`, postId: post.id });
      } catch (err) {
        addLog({ type: 'error', message: `✗ ${post.author}: ${String(err)}`, postId: post.id });
      }
    }

    setExtractProgress(null);
    addLog({ type: 'info', message: `提取完成` });

    // 刷新帖子列表
    const postsRes = await fetch('/api/crawler/xueqiu/posts');
    if (postsRes.ok) {
      const postsData = await postsRes.json();
      setPosts(postsData.posts || []);
    }
    setSelectedPostIds(new Set());
    setExtracting(false);
  };

  // 删除帖子（显示确认框）
  const handleDelete = (userId: string, postId: string) => {
    setDeleteTarget({ userId, postId });
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { userId, postId } = deleteTarget;
    setDeleteTarget(null);
    setDeleting(prev => new Set(prev).add(postId));
    try {
      const res = await fetch(`/api/crawler/xueqiu/posts?userId=${encodeURIComponent(userId)}&postId=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('删除失败');
      addLog({ type: 'success', message: `已删除帖子 ${postId}` });
      // 刷新列表
      const postsRes = await fetch('/api/crawler/xueqiu/posts');
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts || []);
      }
    } catch (err) {
      addLog({ type: 'error', message: `删除失败: ${String(err)}` });
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(postId); return next; });
    }
  };

  const pendingCount = posts.filter(p => p.status === 'pending').length;

  return (
    <div className="section-grid columns-2" style={{ alignItems: 'start' }}>
      {/* 左栏：用户选择 + 抓取 */}
      <div className="glass-card form-card">
        <div className="form-section-title">关注用户</div>

        <div className="form-field">
          <span>使用说明</span>
          <div className="status-message" style={{ fontSize: 12, lineHeight: 1.6 }}>
            首次抓取时会自动打开浏览器窗口，请在窗口中登录雪球（xueqiu.com）。
            登录后抓取自动继续，后续不再需要重复登录。
          </div>
        </div>

        <div className="form-field">
          <span>选择要抓取的用户</span>
          <div className="checkbox-list">
            {users.length === 0 && (
              <div className="empty-state">
                <strong>暂无关注用户</strong>
                <span>请在 config/xueqiu-watchlist.json 中配置</span>
              </div>
            )}
            {users.map(user => (
              <label key={user.id} className="checkbox-item" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedUserIds.includes(user.id)}
                  onChange={() => {
                    setSelectedUserIds(prev =>
                      prev.includes(user.id)
                        ? prev.filter(id => id !== user.id)
                        : [...prev, user.id]
                    );
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{user.id}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button
            className="primary-button"
            onClick={handleFetch}
            disabled={fetching || selectedUserIds.length === 0}
          >
            {fetching ? '抓取中...' : `抓取最新帖子`}
          </button>
        </div>

        {error && (
          <div className="status-message status-error">{error}</div>
        )}

        {/* 提取进度条 */}
        {extractProgress && (
          <div className="form-field">
            <span>提取进度</span>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: 'var(--muted)',
            }}>
              <div style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: 'rgba(143, 164, 194, 0.12)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round((extractProgress.current / extractProgress.total) * 100)}%`,
                  borderRadius: 3,
                  background: 'var(--accent)',
                  transition: 'width 300ms ease',
                }} />
              </div>
              <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                {extractProgress.current}/{extractProgress.total} 已完成
              </span>
            </div>
          </div>
        )}

        {/* 操作日志 */}
        {logs.length > 0 && (
          <div className="form-field">
            <span>操作日志</span>
            <div style={{ maxHeight: 240, overflow: 'auto', display: 'grid', gap: 4 }}>
              {logs.map((log, i) => (
                <div
                  key={`${log.postId || i}-${i}`}
                  className="status-message"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    padding: '6px 10px',
                    background: log.type === 'error'
                      ? 'rgba(255,143,143,0.06)'
                      : log.type === 'success'
                        ? 'rgba(111,210,169,0.06)'
                        : 'rgba(143,164,194,0.06)',
                    border: '1px solid transparent' as string,
                    borderColor: log.type === 'error'
                      ? 'rgba(255,143,143,0.1)'
                      : log.type === 'success'
                        ? 'rgba(111,210,169,0.1)'
                        : 'rgba(143,164,194,0.1)',
                    color: log.type === 'error'
                      ? 'var(--status-error, #ffb3b3)'
                      : log.type === 'success'
                        ? 'var(--status-success, #a5ebcd)'
                        : 'var(--muted)',
                  }}
                >
                  {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右栏：帖子列表 + 提取 */}
      <div className="glass-card form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="form-section-title">
            待审核帖子
            <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
              {pendingCount} 条待提取
            </span>
          </div>
          <div className="form-actions" style={{ gap: 6 }}>
            <button className="primary-button" onClick={toggleAll} style={{ fontSize: 12, padding: '6px 12px' }}>
              全选/取消
            </button>
            <button
              className="primary-button"
              onClick={handleExtract}
              disabled={extracting || selectedPostIds.size === 0}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              {extracting ? `提取中 (${selectedPostIds.size})...` : `AI 提取选中 (${selectedPostIds.size})`}
            </button>
          </div>
        </div>

        <div className="form-field">
          <span>勾选后点击 AI 提取，批量生成结构化观点</span>
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            {posts.length === 0 ? (
              <div className="empty-state">
                <strong>暂无帖子</strong>
                <span>选择左侧用户并点击「抓取最新帖子」</span>
              </div>
            ) : (
              <div className="checkbox-list">
                {posts.map(post => {
                  const isPending = post.status === 'pending';
                  const checked = selectedPostIds.has(post.id);
                  return (
                    <label
                      key={post.id}
                      className="checkbox-item"
                      style={{
                        cursor: isPending ? 'pointer' : 'default',
                        opacity: post.status === 'extracted' ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!isPending}
                        onChange={() => isPending && togglePost(post.id)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13 }}>{post.author}</strong>
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {new Date(post.createdAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span
                            className="tag"
                            style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              background: post.status === 'extracted'
                                ? 'rgba(111,210,169,0.1)'
                                : 'rgba(212,177,106,0.1)',
                              color: post.status === 'extracted' ? '#8cd8b0' : '#d4b16a',
                            }}
                          >
                            {post.status === 'extracted' ? '已提取' : '待提取'}
                          </span>
                          {post.type === 'long' && (
                            <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>长文</span>
                          )}
                          <button
                            onClick={(e) => { e.preventDefault(); handleDelete(post.userId, post.id); }}
                            disabled={deleting.has(post.id)}
                            style={{
                              marginLeft: 'auto',
                              background: 'none',
                              border: 'none',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: '2px 6px',
                              borderRadius: 4,
                              lineHeight: 1,
                              opacity: deleting.has(post.id) ? 0.4 : 0.6,
                            }}
                            title="删除"
                            onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1'; }}
                            onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '0.6'; }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="result-snippet" style={{ fontSize: 12, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {post.text}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除"
        message="确定要删除这篇帖子吗？此操作不可撤销。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 提取确认对话框 */}
      <ConfirmDialog
        open={extractConfirmOpen}
        title="确认 AI 提取"
        message={`确定对 ${posts.filter(p => selectedPostIds.has(p.id) && p.status === 'pending').length} 篇帖子执行 AI 提取？\n\n注意：每次 AI 调用会产生 API 费用。提取结果会保存为观点文档，请后续审核。`}
        confirmLabel="开始提取"
        onConfirm={handleConfirmExtract}
        onCancel={() => setExtractConfirmOpen(false)}
      />
    </div>
  );
}
