'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Plus, ChevronDown, ChevronUp, Brain, Trash2 } from 'lucide-react';
import { getDocumentTypeBadgeClass } from '@/lib/utils/display';
import { renderMarkdown } from '@/lib/utils/markdown';
import { AppShell } from '@/components/layout';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

// ---- Types ----

interface Source {
  id: string;
  title: string;
  docType: string;
  heading: string;
  date?: string;
  snippet: string;
  score?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streamingContent?: string;
  streaming?: boolean;
  thinking?: string;
  sources?: Source[];
  timestamp: number;
}

interface QARound {
  question: string;
  answer: string;
  timestamp: string;
  sources?: Source[];
}

interface QAThread {
  docId: string;
  threadId: string;
  title: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  roundCount: number;
  snippet: string;
  rounds: QARound[];
}

// ---- Helpers ----

function msgId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- Component ----

export default function AskPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { showToast } = useToast();

  // 会话线程
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState('');

  // 历史会话
  const [history, setHistory] = useState<QAThread[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // 删除确认对话框
  const [deletingThread, setDeletingThread] = useState<QAThread | null>(null);

  useEffect(() => {
    document.title = '知识库问答 - A 股投研助手';
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch('/api/qa');
      const payload = await res.json();
      if (payload.ok && payload.data) {
        setHistory(payload.data);
      }
    } catch {
      setHistoryError('加载历史会话失败');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  /** 开始新对话 */
  function handleNewChat() {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setStreaming(false);
    setError('');
    setThreadId(null);
    setThreadTitle('');
    setShowHistory(false);
    inputRef.current?.focus();
  }

  /** 从历史加载完整线程 */
  function handleLoadThread(thread: QAThread) {
    const msgs: ChatMessage[] = [];
    for (const round of thread.rounds) {
      msgs.push({
        id: msgId(),
        role: 'user',
        content: round.question,
        timestamp: Date.now() - 1000,
      });
      msgs.push({
        id: msgId(),
        role: 'assistant',
        content: round.answer,
        sources: round.sources,
        timestamp: Date.now(),
      });
    }
    setMessages(msgs);
    setThreadId(thread.threadId);
    setThreadTitle(thread.title);
    setShowHistory(false);
  }

  /** 删除历史会话 */
  async function handleDeleteThread() {
    const thread = deletingThread;
    if (!thread) return;
    setDeletingThread(null);

    try {
      const res = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: thread.docId }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || '删除失败');

      showToast('会话已删除', 'success');

      // 如果删除的是当前会话，清空
      if (thread.threadId === threadId) {
        handleNewChat();
      }
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  }

  /** 发送消息 */
  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userContent = input.trim();
    setInput('');
    setError('');

    const userMsg: ChatMessage = {
      id: msgId(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: msgId(),
      role: 'assistant',
      content: '',
      streaming: true,
      streamingContent: '',
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiMessages = newMessages
        .filter((m) => !m.streaming)
        .map((m) => ({
          role: m.role,
          content: m.role === 'user' ? m.content : m.content,
        }));

      const body: Record<string, unknown> = { messages: apiMessages };
      if (threadId) body.threadId = threadId;

      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('请求失败');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === 'chunk') {
              fullContent = event.data.content as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, streamingContent: fullContent }
                    : m,
                ),
              );
            } else if (event.type === 'done') {
              const d = event.data as { answer: string; sources: Source[]; threadId: string; round: number };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        content: d.answer || fullContent,
                        streaming: false,
                        streamingContent: undefined,
                        thinking: fullContent !== d.answer ? fullContent : undefined,
                        sources: d.sources || [],
                      }
                    : m,
                ),
              );
              // 保存线程 ID 用于后续追问
              if (d.threadId) {
                setThreadId(d.threadId);
                if (!threadTitle) setThreadTitle(userContent.slice(0, 60));
              }
              setStreaming(false);
            } else if (event.type === 'error') {
              setError(event.data.message || '生成失败');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: '生成失败，请重试。', streaming: false }
                    : m,
                ),
              );
              setStreaming(false);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '发送失败');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: '请求失败，请重试。', streaming: false }
              : m,
          ),
        );
      }
      setStreaming(false);
    }

    loadHistory();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ---- Render ----

  const threadInfo = threadId && messages.length > 0
    ? { title: threadTitle || messages.find((m) => m.role === 'user')?.content?.slice(0, 40) || '对话', rounds: Math.floor(messages.filter((m) => m.role === 'assistant' && !m.streaming).length) }
    : null;

  return (
    <AppShell currentPath="/ask">
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', maxWidth: 860, margin: '0 auto', width: '100%' }}>
        {/* 顶部栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>知识库问答</h2>
              {threadInfo ? (
                <span className="type-badge type-badge-viewpoint" style={{ fontSize: 11 }}>
                  {threadInfo.title}{threadInfo.rounds > 1 ? ` · ${threadInfo.rounds} 轮` : ''}
                </span>
              ) : null}
            </div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {threadInfo ? '多轮对话中，追问会自动追加到同一会话' : 'AI 助手 · 基于本地知识库 · 支持多轮对话'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setShowHistory(!showHistory)} type="button">
              {showHistory ? '关闭历史' : `历史 (${history.length})`}
            </button>
            <button className="primary-button" style={{ fontSize: 12, padding: '6px 12px' }} onClick={handleNewChat} type="button">
              <Plus size={14} style={{ marginRight: 4 }} />新对话
            </button>
          </div>
        </div>

        {/* 历史会话面板 */}
        {showHistory ? (
          <div style={{ borderBottom: '1px solid var(--border)', maxHeight: 240, overflowY: 'auto', padding: '12px 0', flexShrink: 0 }}>
            {historyLoading ? (
              <div className="text-muted" style={{ textAlign: 'center', padding: 20, fontSize: 13 }}>加载历史会话...</div>
            ) : historyError ? (
              <div className="status-message status-error" style={{ margin: '8px 12px', fontSize: 13 }}>{historyError}</div>
            ) : history.length > 0 ? (
              <div className="checkbox-list">
                {history.map((thread) => (
                  <div key={thread.threadId} className="checkbox-item" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => handleLoadThread(thread)}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{thread.title}</div>
                        <span className="type-badge type-badge-viewpoint" style={{ fontSize: 10, flexShrink: 0 }}>
                          {thread.roundCount} 轮对话
                        </span>
                      </div>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {thread.date} · {thread.snippet.slice(0, 80)}...
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeletingThread(thread); }}
                      title="删除此会话"
                      style={{
                        position: 'absolute', top: 8, right: 8,
                        background: 'none', border: 'none',
                        color: 'var(--muted)', cursor: 'pointer',
                        padding: 4, borderRadius: 6,
                        opacity: 0.5,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = '#e09090'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted" style={{ textAlign: 'center', padding: 20, fontSize: 13 }}>暂无历史会话</div>
            )}
          </div>
        ) : null}

        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', gap: 16 }}>
              <Brain size={48} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 18, fontWeight: 600 }}>A 股投研知识库助手</div>
              <div style={{ fontSize: 13, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
                可以问我关于产业链、个股上涨逻辑、市场复盘等问题。支持多轮追问，同一会话自动合并保存。
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 输入区 */}
        <div style={{ flexShrink: 0, padding: '12px 0 20px', borderTop: '1px solid var(--border)' }}>
          {error ? <div className="status-message status-error" style={{ marginBottom: 10, fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={threadId ? '继续追问... Enter 发送' : '输入问题，Enter 发送，Shift+Enter 换行'}
              style={{
                flex: 1, border: '1px solid var(--border)', borderRadius: 16,
                background: 'rgba(7,12,20,0.88)', color: 'var(--text)',
                font: 'inherit', fontSize: 14, padding: '12px 16px',
                resize: 'none', lineHeight: 1.5, minHeight: 44, maxHeight: 120,
              }}
              onInput={(e) => {
                const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <button
              className="primary-button" disabled={!input.trim() || streaming} onClick={handleSend} type="button"
              style={{ padding: '12px 16px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 6, height: 44 }}
            >
              <Send size={16} />
            </button>
          </div>
          {streaming ? <div className="text-muted" style={{ fontSize: 11, marginTop: 8, textAlign: 'center' }}>AI 正在生成回复...</div> : null}
        </div>
      </div>

      <ConfirmDialog
        open={deletingThread !== null}
        title="确认删除"
        message={deletingThread ? `确定删除「${deletingThread.title}」吗？此操作不可恢复。` : ''}
        variant="danger"
        confirmLabel="删除"
        onConfirm={handleDeleteThread}
        onCancel={() => setDeletingThread(null)}
      />
    </AppShell>
  );
}

// ---- Chat Bubble ----

function ChatBubble({ message: msg }: { message: ChatMessage }) {
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const isUser = msg.role === 'user';
  const isStreaming = msg.streaming;
  const displayContent = isStreaming ? msg.streamingContent || '' : msg.content;
  const sixSegments = !isStreaming && !isUser ? parseSixSegments(displayContent) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, paddingLeft: isUser ? 0 : 4, paddingRight: isUser ? 4 : 0 }}>
        {isUser ? '你' : 'AI 助手'} · {formatTime(msg.timestamp)}
        {isStreaming ? ' · 生成中...' : ''}
      </span>
      <div
        style={{
          maxWidth: '88%', border: '1px solid', borderRadius: 18, padding: '14px 18px',
          fontSize: 14, lineHeight: 1.7, wordBreak: 'break-word',
          ...(isUser
            ? { background: 'rgba(212,177,106,0.12)', borderColor: 'rgba(212,177,106,0.2)', borderBottomRightRadius: 6 }
            : { background: 'rgba(15,23,34,0.88)', borderColor: 'var(--border)', borderBottomLeftRadius: 6 }),
        }}
      >
        {sixSegments ? (
          <SixSegmentCards segments={sixSegments} msgId={msg.id} />
        ) : isStreaming ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {displayContent || '思考中...'}
            {isStreaming ? <span className="thinking-cursor" /> : null}
          </div>
        ) : (
          <div className="markdown-body" style={{ fontSize: 14 }}
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(displayContent, msg.id) }}
          />
        )}
        {!isStreaming && !isUser && msg.thinking && msg.thinking !== msg.content ? (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <button onClick={() => setThinkingExpanded(!thinkingExpanded)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: 0, font: 'inherit' }}
              type="button">
              {thinkingExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}思考过程
            </button>
            {thinkingExpanded ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}>
                {msg.thinking}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {!isStreaming && !isUser && msg.sources && msg.sources.length > 0 ? (
        <SourcePanel sources={msg.sources} msgId={msg.id} />
      ) : null}
    </div>
  );
}

// ---- Source Panel ----

function SourcePanel({ sources, msgId }: { sources: Source[]; msgId: string }) {
  const [expanded, setExpanded] = useState(false);
  const typeCounts = sources.reduce((acc, s) => {
    const label = getSourceLabel(s.docType);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const typeSummary = Object.entries(typeCounts).map(([l, c]) => `${c} 篇${l}`).join('、');
  const now = new Date();
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  function isFresh(d?: string) { return d ? new Date(d) >= sevenDaysAgo : false; }
  function scoreColor(s: number) {
    if (s >= 70) return { bg: 'rgba(111,210,169,0.15)', text: '#8cd8b0' };
    if (s >= 40) return { bg: 'rgba(212,177,106,0.12)', text: '#d4b16a' };
    return { bg: 'rgba(143,164,194,0.1)', text: '#b0c4d8' };
  }

  return (
    <div style={{ marginTop: 8, paddingLeft: 4 }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8, font: 'inherit' }}
        type="button">
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        📚 引用来源（{sources.length} 条{typeSummary ? ` · ${typeSummary}` : ''}）
      </button>
      {expanded ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {sources.map((s, i) => {
            const rel = getSourceLabel(s.docType);
            const sc = s.score ? scoreColor(s.score) : null;
            return (
              <div key={i} id={`src-${msgId}-${i}`}
                style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', background: 'rgba(7,12,20,0.6)', transition: 'background 400ms', scrollMarginTop: 80 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="type-badge type-badge-stock" style={{ fontSize: 10, flexShrink: 0 }}>[{i + 1}]</span>
                  <a href={getSourceHref(s.docType, s.id)} target="_blank" rel="noopener noreferrer"
                    style={{ fontWeight: 600, fontSize: 13, color: '#7eb8ff', textDecoration: 'none', flex: 1 }}>{s.title}</a>
                  {s.score != null ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: sc?.bg, color: sc?.text, flexShrink: 0 }}>相关 {s.score}%</span> : null}
                  {isFresh(s.date) ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'rgba(111,210,169,0.12)', color: '#8cd8b0', flexShrink: 0 }}>近 7 日</span> : null}
                  <span className={`type-badge type-badge-${s.docType === 'viewpoint' ? 'viewpoint' : s.docType === 'daily_review' ? 'review' : s.docType === 'theme_research' ? 'theme' : s.docType === 'stock_profile' ? 'stock' : 'note'}`} style={{ fontSize: 10, flexShrink: 0 }}>{rel}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  <span className={`type-badge ${getDocumentTypeBadgeClass(s.docType)}`} style={{ fontSize: 9 }}>{s.docType === 'viewpoint' ? '观点蒸馏' : s.docType === 'daily_review' ? '每日复盘' : s.docType === 'theme_research' ? '产业链研究' : s.docType === 'stock_profile' ? '个股档案' : s.docType}</span>
                  {' '}{s.heading || '正文'}{s.date ? ` · ${s.date}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxHeight: 58, overflow: 'hidden', position: 'relative' }}>
                  {s.snippet}
                  {s.snippet.length >= 200 ? <span style={{ position: 'absolute', bottom: 0, right: 0, background: 'linear-gradient(to right, transparent, rgba(7,12,20,0.9) 40%)', paddingLeft: 32, color: '#7eb8ff', fontSize: 11 }}>...更多</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---- Six-Segment Card Helpers ----

const SIX_SEGMENT_HEADINGS = ['结论', '证据链', '分歧与反证', '后续验证', '交易含义', '引用来源'];

const SEGMENT_STYLES: Record<string, { label: string; color: string; borderColor: string }> = {
  '结论':       { label: '结论',       color: '#6ed19f', borderColor: 'rgba(110,209,159,0.3)' },
  '证据链':     { label: '证据链',     color: '#7eb8ff', borderColor: 'rgba(126,184,255,0.3)' },
  '分歧与反证': { label: '分歧与反证', color: '#e09090', borderColor: 'rgba(224,144,144,0.3)' },
  '后续验证':   { label: '后续验证',   color: '#d4b16a', borderColor: 'rgba(212,177,106,0.3)' },
  '交易含义':   { label: '交易含义',   color: '#c08ae0', borderColor: 'rgba(192,138,224,0.3)' },
  '引用来源':   { label: '引用来源',   color: '#8ac4d8', borderColor: 'rgba(138,196,216,0.3)' },
};

const EMPTY_PLACEHOLDER = '当前知识库中未发现相关信息';

/**
 * 尝试将文本按六段式结构（## 结论、## 证据链 等）拆分。
 * 成功返回段落数组，失败（不足 4 段）返回 null，回退到普通 markdown 渲染。
 */
function parseSixSegments(text: string): Array<{ heading: string; content: string }> | null {
  if (!text) return null;

  const segments: Array<{ heading: string; content: string }> = [];
  const parts = text.split(/\n(?=##\s)/);

  for (const part of parts) {
    const headingMatch = part.match(/^##\s+(.+)$/m);
    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      if (SIX_SEGMENT_HEADINGS.includes(headingText)) {
        const content = part.replace(/^##\s+.+$\n?/, '').trim();
        segments.push({
          heading: headingText,
          content: content || EMPTY_PLACEHOLDER,
        });
      }
    }
  }

  if (segments.length < 4) return null;
  return segments;
}

// ---- Six-Segment Cards Component ----

function SixSegmentCards({ segments, msgId }: { segments: Array<{ heading: string; content: string }>; msgId?: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 12,
    }}>
      {segments.map((seg) => {
        const style = SEGMENT_STYLES[seg.heading];
        return (
          <div
            key={seg.heading}
            id={`seg-${msgId}-${seg.heading}`}
            style={{
              background: 'rgba(15,23,34,0.88)',
              border: `1px solid ${style?.borderColor ?? 'var(--border)'}`,
              borderRadius: 12,
              padding: '16px 18px',
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                marginTop: 0,
                marginBottom: 10,
                color: style?.color ?? 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{
                display: 'inline-block',
                width: 3,
                height: 16,
                borderRadius: 2,
                background: style?.color ?? 'var(--border)',
                flexShrink: 0,
              }} />
              {style?.label ?? seg.heading}
            </div>
            <div
              className="markdown-body"
              style={{ fontSize: 13, lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: renderChatMarkdown(seg.content, msgId) }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---- Helpers ----

function getSourceHref(docType: string, docId: string): string {
  const map: Record<string, string> = { viewpoint: '/viewpoints', daily_review: '/reviews', theme_research: '/themes', stock_profile: '/stocks', note: '/notes' };
  return `${map[docType] ?? '/dashboard'}/${docId}`;
}

function getSourceLabel(docType: string): string {
  const map: Record<string, string> = { viewpoint: '观点', daily_review: '复盘', theme_research: '研究', stock_profile: '档案', note: '笔记' };
  return map[docType] ?? '资料';
}

function renderChatMarkdown(text: string, msgId?: string): string {
  // 先用正式渲染器处理 markdown（支持粗体、斜体、链接、代码块等）
  let html = renderMarkdown(text);
  // 再替换 [N] 为可点击的引用标签
  html = html.replace(/\[(\d+)\]/g, (_full: string, num: string) => {
    const idx = parseInt(num) - 1;
    const srcId = msgId ? `src-${msgId}-${idx}` : '';
    const onclick = srcId
      ? `onclick="var el=document.getElementById('${srcId}');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.background='rgba(212,177,106,0.12)';setTimeout(function(){el.style.background=''},2000)}"`
      : '';
    return `<sup class="md-source-tag md-source-original" style="cursor:pointer" ${onclick}>[${num}]</sup>`;
  });
  return html;
}
