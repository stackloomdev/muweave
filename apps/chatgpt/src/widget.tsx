import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@modelcontextprotocol/ext-apps';
import { zipSync, strToU8 } from 'fflate';
import { CanvasRenderer } from '@muweave/renderer';
import { projectSchema, type Project } from '@muweave/schema';
import { timeLabel, duration } from '@muweave/core';
import { checkDraft } from '../../../packages/mcp/src/drafts';

declare const MUWEAVE_SITE_ORIGIN: string;
function Widget() {
  const [project, setProject] = useState<Project>();
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState('等待分镜…');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [canDownload, setCanDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const bridge = useRef<App | undefined>(undefined);
  const canvas = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => {
    const app = new App({ name: 'Muweave Canvas', version: '0.1.0' }, {}, { autoResize: true });
    bridge.current = app;
    app.ontoolinput = () => {
      setProject(undefined);
      setSelected(0);
      setError('');
      setStatus('正在整理分镜…');
    };
    app.ontoolresult = (result) => {
      try {
        if (result.isError) throw new Error('这次分镜操作未完成，请检查工具返回的错误。');
        const data = result.structuredContent;
        const p = checkDraft(projectSchema.parse(data?.project));
        setProject(p);
        setSelected(0);
        setError('');
        setStatus('');
      } catch {
        setProject(undefined);
        setError('分镜不可用。请重新生成或检查工程格式。');
      }
    };
    app.ontoolcancelled = () => {
      setProject(undefined);
      setStatus('操作已取消');
    };
    app.onhostcontextchanged = (context) => {
      if (context.theme) document.documentElement.dataset.theme = context.theme;
    };
    void app
      .connect()
      .then(() => {
        setConnected(true);
        setCanDownload(Boolean(app.getHostCapabilities()?.downloadFile));
      })
      .catch(() => setError('请从支持 MCP Apps 的对话中打开此画布。'));
    return () => {
      bridge.current = undefined;
      void app.close();
    };
  }, []);
  useEffect(() => {
    if (!canvas.current || !project) return;
    const element = canvas.current;
    const renderer = new CanvasRenderer(element);
    let active = true;
    const render = async () => {
      setFrameReady(false);
      try {
        await renderer.render(
          project,
          0,
          { sceneId: project.scenes[selected].id, still: true, captions: false },
          undefined,
          element.clientWidth,
        );
        if (active) setFrameReady(true);
      } catch {
        if (active) setError('画布加载失败，请检查字体连接后重新预览。');
      }
    };
    const observer = new ResizeObserver(() => {
      void render();
    });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
      renderer.destroy();
    };
  }, [project, selected]);
  async function download() {
    if (!project || !bridge.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const bytes = zipSync(
        { 'project.json': strToU8(JSON.stringify(project, null, 2)) },
        { level: 6 },
      );
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      const result = await bridge.current.downloadFile({
        contents: [
          {
            type: 'resource',
            resource: {
              uri: `file:///${project.id}.muweave.zip`,
              mimeType: 'application/zip',
              blob: btoa(binary),
            },
          },
        ],
      });
      if (result.isError) setStatus('下载已取消，可以再次尝试。');
      else setStatus('在幕织的工程列表选择“打开工程包”，即可继续编辑。');
    } catch {
      setError(
        '当前宿主未完成下载。可以让助手将工具结果中的 project 保存为 project.json，再在幕织打开。',
      );
    } finally {
      setBusy(false);
    }
  }
  async function openStudio() {
    try {
      const result = await bridge.current?.openLink({ url: MUWEAVE_SITE_ORIGIN });
      if (!result || result.isError) setError('未能打开幕织，请使用下方站点地址。');
    } catch {
      setError('未能打开幕织，请使用下方站点地址。');
    }
  }
  const scene = project?.scenes[selected];
  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">幕</span>
          <div>
            <strong>
              幕织 <span>Muweave</span>
            </strong>
            <p>把内容，编织成故事。</p>
          </div>
        </div>
        <span className="badge">分镜预览</span>
      </header>
      {project && scene ? (
        <>
          <div className="project-heading">
            <div>
              <h1>{project.title}</h1>
              <p>
                {project.scenes.length} 页 · {timeLabel(duration(project))} · 16:9 · 版本{' '}
                {project.revision}
              </p>
            </div>
          </div>
          <section className="frame" aria-label="场景画布" aria-busy={!frameReady}>
            <div ref={canvas} style={{ visibility: frameReady ? 'visible' : 'hidden' }} />
            {!frameReady && <div className="frame-loading">正在绘制画布…</div>}
          </section>
          <nav aria-label="分镜页面">
            {project.scenes.map((s, index) => (
              <button
                key={s.id}
                aria-current={index === selected ? 'page' : undefined}
                onClick={() => setSelected(index)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {s.title}
              </button>
            ))}
          </nav>
          <section className="scene-info">
            <h2>{scene.title}</h2>
            <span>{(scene.durationUs / 1e6).toFixed(1)} 秒</span>
          </section>
          {scene.narrationText && (
            <details>
              <summary>配音文案</summary>
              <p className="narration">{scene.narrationText}</p>
            </details>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={!connected || !canDownload || busy}
              onClick={() => void download()}
            >
              {busy ? '正在打包…' : '下载工程包'}
            </button>
            <button disabled={!connected} onClick={() => void openStudio()}>
              打开幕织
            </button>
          </div>
          {!canDownload && connected && (
            <p className="hint">
              当前宿主未提供文件下载。请让助手把工具结果中的 project 保存为
              project.json，在幕织的“打开工程包”中选择该文件。
            </p>
          )}
          <p className="hint">导入工程包后，可添加图片、配音并导出视频。分镜未保存到幕织服务器。</p>
        </>
      ) : (
        <div className="empty">
          <span className="empty-mark">✦</span>
          <h1>一个想法，一段故事。</h1>
          <p>{status || '请让助手创建或预览分镜。'}</p>
        </div>
      )}
      {project && status && (
        <p role="status" className="hint">
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <span>文字 / 形状分镜 · 素材与视频在网页制作</span>
        <a href={MUWEAVE_SITE_ORIGIN} target="_blank" rel="noreferrer">
          muweave
        </a>
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Widget />);
