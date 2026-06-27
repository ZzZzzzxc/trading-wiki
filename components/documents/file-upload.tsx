'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/components/toast';

interface UploadResult {
  text: string;
  fileName: string;
  size: number;
  reasoning?: string;
}

interface FileUploadProps {
  onTextExtracted: (text: string, fileName: string) => void;
  acceptLabel?: string;
  placeholder?: string;
}

export function FileUpload({
  onTextExtracted,
  acceptLabel = 'PDF、图片（PNG/JPG/WebP）',
  placeholder = '拖拽 PDF 或图片到此处，或点击选择文件',
}: FileUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [thinkingContent, setThinkingContent] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const { showToast } = useToast();

  const processFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError('');
      setUploaded(null);
      setThinkingContent('');

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || `上传失败 (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');

        const decoder = new TextDecoder();
        let buffer = '';

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

              if (event.type === 'thinking') {
                setThinkingContent(event.content as string);
              } else if (event.type === 'result') {
                const data = event.data as UploadResult;
                setUploaded(data);
                onTextExtracted(data.text, data.fileName);
                showToast('文件解析完成', 'success');
              } else if (event.type === 'error') {
                setError(event.message as string);
                showToast(event.message as string, 'error');
                setLoading(false);
              }
            } catch {
              // 跳过无法解析的行
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '文件处理失败';
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setLoading(false);
      }
    },
    [onTextExtracted],
  );

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onClick={() => !loading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 14,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: loading ? 'default' : 'pointer',
          transition: 'all 200ms ease',
          background: dragging
            ? 'rgba(212, 177, 106, 0.08)'
            : loading
              ? 'rgba(212, 177, 106, 0.04)'
              : 'rgba(143, 164, 194, 0.03)',
          transform: dragging ? 'scale(1.02)' : 'scale(1)',
        }}
      >
        {loading && !thinkingContent ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span className="thinking-dot" />
            <span className="text-muted" style={{ fontSize: 13 }}>
              正在解析文件...
            </span>
          </div>
        ) : loading && thinkingContent ? (
          <div style={{ textAlign: 'left', fontSize: 12 }}>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="thinking-dot" />
              <span className="text-muted" style={{ fontSize: 12 }}>模型思考中...</span>
            </div>
            <div
              style={{
                padding: '8px 10px',
                background: 'rgba(212, 177, 106, 0.06)',
                borderRadius: 8,
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxHeight: 200,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                fontStyle: 'italic',
                fontSize: 11,
              }}
            >
              {thinkingContent}
            </div>
          </div>
        ) : uploaded ? (
          <div style={{ fontSize: 13 }}>
            <span style={{ color: '#8cd8b0' }}>✓</span>{' '}
            <span style={{ color: 'var(--text)' }}>{uploaded.fileName}</span>
            <span className="text-muted"> ({formatSize(uploaded.size)})</span>
            <br />
            <span className="text-muted" style={{ fontSize: 12 }}>
              已提取 {uploaded.text.length} 字符，点击可重新上传
            </span>
            {uploaded.reasoning ? (
              <details style={{ marginTop: 10, textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)' }}>
                  🧠 查看模型思考过程
                </summary>
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    background: 'rgba(212, 177, 106, 0.06)',
                    borderRadius: 8,
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: 'var(--text-secondary)',
                    maxHeight: 200,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontStyle: 'italic',
                  }}
                >
                  {uploaded.reasoning}
                </div>
              </details>
            ) : null}
          </div>
        ) : dragging ? (
          <div>
            <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>
              📄 松开以解析文件
            </span>
          </div>
        ) : (
          <div>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {placeholder}
            </span>
            <br />
            <span className="text-muted" style={{ fontSize: 11 }}>
              支持 {acceptLabel}
            </span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>

      {error ? (
        <div className="status-message status-error" style={{ fontSize: 13 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
