import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { initialize, startExport, cancelExport } from './exports';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileArchive,
  Film,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize2,
  MoreHorizontal,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Subtitles,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  AlignCenter,
  AlignHorizontalJustifyCenter,
  Group,
  Ungroup,
} from 'lucide-react';
import {
  type Project,
  type Scene,
  type VisualNode,
  type Command,
  type Job,
  type Asset,
  nodeSchema,
  BUILTIN_FONTS,
} from '@muweave/schema';
import {
  uid,
  duration,
  timeline,
  sceneAt,
  timeLabel,
  blankScene,
  parseSrt,
  toSrt,
  getNodes,
} from '@muweave/core';
import { CanvasRenderer, type EditHooks, assetUrl } from '@muweave/renderer';
import {
  store,
  apply,
  loadProject,
  getJobs,
  getJob,
  ApiError,
  importFile,
  importBundle,
  analyzeTimeline,
  downloadBlob,
  prepareImport,
  stageImport,
} from './client';
import { connectAgent } from './agent';
import { AudioTransport } from './audio';

function Button({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={'icon-button ' + (active ? 'active ' : '') + className}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  value,
  revision,
  onSave,
  type = 'text',
  rows,
}: {
  label: string;
  value: string | number;
  revision: number;
  onSave: (value: string, revision: number) => void;
  type?: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState(String(value)),
    focus = useRef(false),
    base = useRef(revision),
    original = useRef(String(value));
  useEffect(() => {
    if (!focus.current) setDraft(String(value));
  }, [value]);
  const props = {
    value: draft,
    onChange: (e: any) => setDraft(e.target.value),
    onFocus: () => {
      focus.current = true;
      base.current = revision;
      original.current = String(value);
    },
    onBlur: () => {
      focus.current = false;
      if (draft !== original.current) onSave(draft, base.current);
    },
    onKeyDown: (e: any) => {
      if (e.key === 'Escape') {
        setDraft(String(value));
        original.current = String(value);
        e.currentTarget.blur();
      } else if (e.key === 'Enter' && !rows) e.currentTarget.blur();
    },
    'aria-label': label,
  };
  return (
    <label className={'field ' + (type === 'color' ? 'color-field' : '')}>
      <span>{label}</span>
      {rows ? <textarea rows={rows} {...props} /> : <input type={type} {...props} />}
    </label>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const close = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', close);
    return () => {
      d.removeEventListener('cancel', close);
      d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={'modal ' + (wide ? 'wide' : '')}
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <Button label="关闭面板" onClick={onClose}>
          <X size={20} />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
function Canvas({
  project,
  timeUs,
  sceneId,
  variantId,
  hooks,
  playing = false,
  thumbnail = false,
  zoom = 1,
  onError,
}: {
  project: Project;
  timeUs: number;
  sceneId?: string;
  variantId?: string;
  hooks?: EditHooks;
  playing?: boolean;
  thumbnail?: boolean;
  zoom?: number;
  onError?: (error: Error) => void;
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    renderer = useRef<CanvasRenderer | null>(null),
    [width, setWidth] = useState(100);
  useEffect(() => {
    renderer.current = new CanvasRenderer(canvas.current!);
    const observer = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0].contentRect;
      const ratio = variantId ? 4 / 3 : 16 / 9;
      setWidth(thumbnail ? w : Math.max(100, Math.min(w, h * ratio)));
    });
    observer.observe(holder.current!);
    return () => {
      observer.disconnect();
      renderer.current?.destroy();
    };
  }, [thumbnail, variantId]);
  useEffect(() => {
    void renderer.current
      ?.render(
        project,
        timeUs,
        {
          sceneId: playing ? undefined : sceneId,
          variantId,
          still: !playing,
          captions: !thumbnail,
        },
        hooks,
        width * zoom,
      )
      .catch((e) => onError?.(e));
  }, [project, timeUs, sceneId, variantId, width, zoom, hooks, playing, thumbnail]);
  return (
    <div className={'canvas-holder ' + (thumbnail ? 'thumbnail' : '')} ref={holder}>
      <div
        ref={canvas}
        className="canvas-surface"
        aria-label={thumbnail ? '场景缩略图' : '创作画布'}
      />
    </div>
  );
}
const jobLabels: Record<Job['status'], string> = {
  queued: '排队中',
  running: '正在导出',
  succeeded: '导出完成',
  failed: '导出失败',
  cancelled: '已取消',
  interrupted: '任务中断',
};
export function Studio() {
  const [project, setProject] = useState<Project | null>(null),
    [sceneId, setSceneId] = useState(''),
    [variantId, setVariantId] = useState<string>(),
    [selected, setSelected] = useState<string[]>([]);
  const [timeUs, setTimeUs] = useState(0),
    [playing, setPlaying] = useState(false),
    [zoom, setZoom] = useState(1),
    [saving, setSaving] = useState(0),
    [mode, setMode] = useState('unavailable');
  const [dialog, setDialog] = useState<
      'assets' | 'projects' | 'export' | 'captions' | 'analysis' | null
    >(null),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [inspector, setInspector] = useState<'properties' | 'script' | 'layers'>('properties');
  const [history, setHistory] = useState({ undoAvailable: false, redoAvailable: false }),
    [jobs, setJobs] = useState<Job[]>([]),
    [projects, setProjects] = useState<{ id: string; title: string }[]>([]),
    [newTitle, setNewTitle] = useState('');
  const [srt, setSrt] = useState(''),
    [analysis, setAnalysis] = useState<any>(null),
    [analyzing, setAnalyzing] = useState(false);
  const [agentImport, setAgentImport] = useState<{ importId: string; status: string } | null>(null);
  const [previewJob, setPreviewJob] = useState<string>();
  const pRef = useRef(project),
    sRef = useRef(sceneId),
    selRef = useRef(selected),
    transport = useRef(new AudioTransport()),
    raf = useRef(0),
    inspectorPanel = useRef<HTMLDivElement>(null),
    files = useRef<HTMLInputElement>(null),
    bundle = useRef<HTMLInputElement>(null),
    captionFile = useRef<HTMLInputElement>(null);
  pRef.current = project;
  sRef.current = sceneId;
  selRef.current = selected;
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const stop = useCallback(() => {
    transport.current.stop();
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  }, []);
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);
  const refresh = useCallback(
    async (id?: string) => {
      const target = id ?? pRef.current?.id;
      if (!target) return;
      const [p, h, j] = await Promise.all([
        loadProject(target),
        store.history(target),
        getJobs(target),
      ]);
      const previous = pRef.current;
      if (previous && previous.id === target && previous.revision !== p.revision) stop();
      pRef.current = p;
      setProject(p);
      setHistory(h);
      setJobs(j);
      if (!p.scenes.some((s) => s.id === sRef.current)) {
        const oldIndex =
          previous?.id === target ? previous.scenes.findIndex((s) => s.id === sRef.current) : 0;
        const next = timeline(p)[Math.min(Math.max(0, oldIndex - 1), p.scenes.length - 1)];
        sRef.current = next.scene.id;
        setSceneId(next.scene.id);
        setTimeUs(next.startUs);
        setSelected([]);
      } else {
        setTimeUs((us) => Math.min(us, duration(p)));
      }
      setVariantId((v) => (p.variants.some((x) => x.id === v) ? v : undefined));
      return p;
    },
    [stop],
  );
  const open = useCallback(
    async (id: string) => {
      stop();
      setSelected([]);
      setVariantId(undefined);
      setTimeUs(0);
      sRef.current = '';
      await refresh(id);
      localStorage.setItem('muweave-project', id);
      setDialog(null);
    },
    [refresh, stop],
  );
  const seek = useCallback(
    (us: number, id?: string) => {
      stop();
      const p = pRef.current;
      if (!p) return;
      const t = Math.max(0, Math.min(duration(p), Math.round(us)));
      setTimeUs(t);
      setSceneId(id ?? sceneAt(p, t).scene.id);
      setVariantId(undefined);
    },
    [stop],
  );
  useEffect(() => {
    let disposed = false,
      connection: ReturnType<typeof connectAgent> | undefined;
    const unsubscribe = store.subscribe((change) => {
      if (change.projectId !== pRef.current?.id) return;
      if (change.type === 'change') void refresh().catch(fail);
      else if (change.jobId)
        void getJob(change.jobId)
          .then((job) => {
            if (job.projectId === pRef.current?.id)
              setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
          })
          .catch(fail);
    });
    (async () => {
      await initialize();
      const list = await store.list();
      if (disposed) return;
      setProjects(list);
      const saved = localStorage.getItem('muweave-project');
      await open(list.find((p) => p.id === saved)?.id ?? list[0].id);
      if (disposed) return;
      connection = connectAgent({
        project: () => pRef.current,
        sceneId: () => sRef.current,
        selectedIds: () => selRef.current,
        open,
        refresh: async () => {
          await refresh();
        },
        seek,
        prepareImport: async (id) => {
          const ticket = await prepareImport(id);
          setAgentImport({ importId: ticket.importId, status: '请选择素材文件' });
          setDialog('assets');
          return ticket;
        },
      });
      setMode(connection.mode);
    })().catch(fail);
    return () => {
      disposed = true;
      unsubscribe();
      connection?.dispose();
      transport.current.close();
      cancelAnimationFrame(raf.current);
    };
  }, [open, refresh, seek, fail]);
  async function commit(commands: Command[], label = '编辑画布', expectedRevision?: number) {
    const p = pRef.current;
    if (!p) return;
    setSaving((n) => n + 1);
    setError('');
    try {
      await apply(p.id, {
        expectedRevision: expectedRevision ?? p.revision,
        requestId: uid('request'),
        label,
        commands,
      });
      return await refresh(p.id);
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') await refresh(p.id);
      throw e;
    } finally {
      setSaving((n) => n - 1);
    }
  }
  const execute = (commands: Command[], label?: string, revision?: number) => {
    void commit(commands, label, revision).catch(() => {});
  };
  async function undo(action: 'undo' | 'redo') {
    const p = pRef.current;
    if (!p) return;
    try {
      await store.mutate(p.id, {
        action,
        expectedRevision: p.revision,
        requestId: uid('history'),
      });
      await refresh();
      setSelected([]);
    } catch (e) {
      fail(e);
    }
  }
  const scene = project?.scenes.find((s) => s.id === sceneId) ?? project?.scenes[0],
    variant = project?.variants.find((v) => v.id === variantId);
  const nodes = variant?.nodes ?? scene?.nodes ?? [],
    node = nodes.find((n) => n.id === selected[0]),
    total = project ? duration(project) : 0;
  useEffect(() => {
    inspectorPanel.current?.scrollTo({ top: 0 });
  }, [inspector, scene?.id, variantId, node?.id]);
  const chooseScene = (id: string) => {
    const p = pRef.current;
    if (!p) return;
    const item = timeline(p).find((t) => t.scene.id === id);
    if (!item) return;
    stop();
    sRef.current = id;
    setSceneId(id);
    setTimeUs(item.startUs);
    setVariantId(undefined);
    setSelected([]);
  };
  function changeNode(changes: Partial<VisualNode>, revision?: number) {
    if (!scene || !node) return;
    execute(
      [{ type: 'node.update', sceneId: scene.id, variantId, nodeId: node.id, changes }],
      '修改 ' + node.name,
      revision,
    );
  }
  function selectNode(id: string, add = false) {
    if (!id) {
      setSelected([]);
      return;
    }
    const n = nodes.find((n) => n.id === id),
      ids = n?.groupId ? nodes.filter((k) => k.groupId === n.groupId).map((k) => k.id) : [id];
    setSelected((old) =>
      add
        ? old.includes(id)
          ? old.filter((k) => !ids.includes(k))
          : [...new Set([...old, ...ids])]
        : ids,
    );
    setInspector('properties');
  }
  const hooks: EditHooks | undefined =
    !playing && scene
      ? {
          selectedIds: selected,
          onSelect: selectNode,
          onChange: (changes) =>
            execute(
              changes.map((c) => ({
                type: 'node.update',
                sceneId: scene.id,
                variantId,
                nodeId: c.id,
                changes: c.changes,
              })),
              '调整图层',
            ),
          onEdit: (id) => {
            selectNode(id);
            setInspector('properties');
            setTimeout(
              () =>
                document
                  .querySelector<HTMLTextAreaElement>('textarea[aria-label="文字内容"]')
                  ?.focus(),
              0,
            );
          },
        }
      : undefined;
  function addNode(type: VisualNode['type'], asset?: Asset) {
    if (!scene) return;
    const id = uid(type),
      width = variant?.width ?? 1920;
    const n = nodeSchema.parse({
      id,
      type,
      name: type === 'text' ? '新文字' : (asset?.name ?? '形状'),
      x: width * 0.22,
      y: 380,
      width: asset ? Math.min(900, width * 0.6) : type === 'text' ? 900 : 420,
      height: asset
        ? Math.min(500, (900 * (asset.height ?? 1)) / (asset.width ?? 1))
        : type === 'text'
          ? 160
          : 240,
      text: type === 'text' ? '写下你的想法' : '',
      fontSize: 64,
      bold: true,
      fill: type === 'text' ? '#153b37' : '#d4e5da',
      radius: 24,
      assetId: asset?.id,
    });
    void commit([{ type: 'node.add', sceneId: scene.id, variantId, node: n }], '添加图层')
      .then(() => {
        setSelected([id]);
        setDialog(null);
        setInspector('properties');
      })
      .catch(() => {});
  }
  function removeSelected() {
    if (!scene || !selected.length) return;
    execute(
      selected.map((nodeId) => ({ type: 'node.remove', sceneId: scene.id, variantId, nodeId })),
      '删除图层',
    );
    setSelected([]);
  }
  function removeScene(id = scene?.id) {
    const p = pRef.current;
    if (!p || !id || p.scenes.length < 2 || !p.scenes.some((s) => s.id === id)) return;
    void commit([{ type: 'scene.remove', sceneId: id }], '删除场景')
      .then(() => notify('场景已删除，可撤销恢复'))
      .catch(() => {});
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,dialog') || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo(e.shiftKey ? 'redo' : 'undo');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const focusedScene = target.closest<HTMLElement>('[data-scene-id]');
        if (focusedScene) removeScene(focusedScene.dataset.sceneId);
        else removeSelected();
      } else if (e.key === 'Escape') {
        setSelected([]);
        setDialog(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  async function play() {
    if (!project) return;
    if (playing) {
      stop();
      return;
    }
    setVariantId(undefined);
    setSelected([]);
    setError('');
    const from = timeUs >= total ? 0 : timeUs;
    try {
      if (!(await transport.current.play(project, from))) return;
      setPlaying(true);
      const tick = () => {
        const t = transport.current.timeUs();
        if (t >= total) {
          setTimeUs(total);
          stop();
          return;
        }
        setTimeUs(t);
        setSceneId(sceneAt(project, t).scene.id);
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      fail(e);
      stop();
    }
  }
  async function upload(selectedFiles: FileList | File[]) {
    for (const file of Array.from(selectedFiles)) {
      const p = pRef.current;
      if (!p) return;
      setSaving((n) => n + 1);
      try {
        const r = await importFile(p.id, file, p.revision, uid('upload'));
        await refresh();
        notify('已导入 ' + r.asset.name);
      } catch (e) {
        fail(e);
      } finally {
        setSaving((n) => n - 1);
      }
    }
    setDialog('assets');
  }
  async function cover() {
    if (!project || !scene) return;
    if (variantId) {
      setVariantId(undefined);
      return;
    }
    stop();
    const existing = project.variants.find((v) => v.sourceSceneId === scene.id);
    if (existing) {
      setVariantId(existing.id);
      setSelected([]);
      return;
    }
    const id = uid('cover');
    try {
      await commit(
        [{ type: 'variant.create', sceneId: scene.id, id, title: '4:3 封面' }],
        '创建独立封面',
      );
      setVariantId(id);
      setSelected([]);
      notify('已创建独立封面，可以单独调整排版');
    } catch {}
  }
  async function exportFile(format: Job['format']) {
    if (!project) return;
    try {
      const j = await startExport(project.id, {
        format,
        expectedRevision: project.revision,
        requestId: uid('export'),
        ...(format === 'png' ? (variantId ? { variantId } : { sceneId }) : {}),
      });
      setJobs((old) => [j, ...old.filter((x) => x.id !== j.id)]);
      notify('已开始浏览器导出，请保持页面打开');
    } catch (e) {
      fail(e);
    }
  }
  const openCaptions = () => {
    if (!project || !scene) return;
    setSrt(toSrt({ ...project, scenes: [scene] }));
    setDialog('captions');
  };
  async function analyze() {
    if (!project) return;
    setAnalysis(null);
    setDialog('analysis');
    setAnalyzing(true);
    try {
      setAnalysis(await analyzeTimeline(project));
    } catch (e) {
      fail(e);
    } finally {
      setAnalyzing(false);
    }
  }
  function attachAudio(asset: Asset) {
    if (!scene) return;
    execute(
      [
        {
          type: 'narration.set',
          sceneId: scene.id,
          narration: {
            assetId: asset.id,
            trimStartUs: 0,
            trimEndUs: asset.durationUs!,
            offsetUs: 0,
            gain: 1,
          },
          fitDuration: true,
        },
      ],
      '设置配音',
    );
    setDialog(null);
    notify('已按配音实际时长调整场景');
  }
  function reorderScene(delta: number) {
    if (!project || !scene) return;
    const ids = project.scenes.map((s) => s.id),
      i = ids.indexOf(scene.id),
      j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    execute([{ type: 'scene.reorder', ids }], '调整场景顺序');
  }
  function reorderNode(delta: number) {
    if (!node || !scene) return;
    const ids = nodes.map((n) => n.id),
      i = ids.indexOf(node.id),
      j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    execute([{ type: 'node.reorder', sceneId: scene.id, variantId, ids }], '调整图层层级');
  }
  if (!project || !scene)
    return (
      <main className="boot">
        <img src="/mark.svg" width="52" alt="Muweave" />
        <h1>让想法，慢慢成形。</h1>
        <p>{error || '正在打开你的创作空间…'}</p>
        {error && <button onClick={() => location.reload()}>重新连接</button>}
      </main>
    );
  const audioAssets = Object.values(project.assets).filter((a) => a.kind === 'audio'),
    fontAssets = Object.values(project.assets).filter((a) => a.kind === 'font'),
    entries = timeline(project);
  return (
    <div className="studio">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            void store.list().then(setProjects);
            setDialog('projects');
          }}
          aria-label="打开工程列表"
        >
          <img src="/mark.svg" alt="" width="30" />
          <span>
            Muweave<small>幕织</small>
          </span>
        </button>
        <div className="project-context">
          <span className="project-kind">{variant ? '独立封面' : '图文视频'}</span>
          <button
            className="project-name"
            onClick={() => {
              void store.list().then(setProjects);
              setDialog('projects');
            }}
          >
            <span>{project.title}</span>
            <ChevronDown size={14} />
          </button>
        </div>
        <span className="save-state" title={saving ? '正在保存' : '已保存到浏览器'}>
          {saving ? <span className="spinner" /> : <CheckCircle2 size={14} />}
          <span>{saving ? '正在保存' : '已保存到浏览器'}</span>
        </span>
        <div className="top-actions">
          <div className="history-actions">
            <Button
              label="撤销"
              disabled={!history.undoAvailable}
              onClick={() => void undo('undo')}
            >
              <Undo2 size={18} />
            </Button>
            <Button
              label="重做"
              disabled={!history.redoAvailable}
              onClick={() => void undo('redo')}
            >
              <Redo2 size={18} />
            </Button>
          </div>
          <span className="header-divider" />
          <button className="asset-library-button" onClick={() => setDialog('assets')}>
            <ImageIcon size={16} />
            素材库 <span className="count">{Object.keys(project.assets).length}</span>
          </button>
          <button className="primary" onClick={() => setDialog('export')}>
            <Download size={16} />
            导出作品
          </button>
        </div>
      </header>
      <main className="workbench">
        <aside className="scene-rail">
          <div className="rail-heading">
            <span>
              场景 <b>{project.scenes.length.toString().padStart(2, '0')}</b>
            </span>
            <Button
              label="添加场景"
              onClick={() => {
                const s = blankScene();
                void commit([{ type: 'scene.add', scene: s, afterId: scene.id }], '添加场景')
                  .then(() => chooseScene(s.id))
                  .catch(() => {});
              }}
            >
              <Plus size={16} />
            </Button>
          </div>
          <div className="scene-list">
            {project.scenes.map((s, i) => (
              <button
                key={s.id}
                className={'scene-card ' + (s.id === scene.id ? 'selected' : '')}
                onClick={() => chooseScene(s.id)}
                aria-label={'选择场景 ' + (i + 1) + ' ' + s.title}
                aria-current={s.id === scene.id}
                data-scene-id={s.id}
              >
                <div className="scene-thumbnail">
                  <Canvas project={project} sceneId={s.id} timeUs={entries[i].startUs} thumbnail />
                  <span className="scene-duration">{(s.durationUs / 1e6).toFixed(1)}s</span>
                </div>
                <span className="scene-meta">
                  <span className="scene-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="scene-title">{s.title}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="rail-actions">
            <button
              className="rail-add"
              onClick={() => {
                const s = blankScene();
                void commit([{ type: 'scene.add', scene: s }], '添加场景')
                  .then(() => chooseScene(s.id))
                  .catch(() => {});
              }}
            >
              <Plus size={16} />
              添加场景
            </button>
            <button
              className="rail-delete"
              aria-label="删除当前场景"
              title={project.scenes.length < 2 ? '至少保留一个场景' : '删除当前场景，可撤销恢复'}
              disabled={project.scenes.length < 2 || saving > 0}
              onClick={() => removeScene()}
            >
              <Trash2 size={14} />
              删除场景
            </button>
          </div>
        </aside>
        <section className="canvas-workspace" aria-label="画布编辑区">
          <div className="canvas-toolbar">
            <div className="toolbar-group">
              <Button label="选择工具" active>
                <MousePointer2 size={16} />
              </Button>
              <span className="toolbar-divider" />
              <button onClick={() => addNode('text')}>
                <Type size={16} />
                文字
              </button>
              <button onClick={() => setDialog('assets')}>
                <ImageIcon size={16} />
                图片
              </button>
              <button onClick={() => addNode('rect')}>
                <Square size={15} />
                形状
              </button>
              <button
                onClick={() => addNode('ellipse')}
                className="compact-tool"
                title="添加圆形"
                aria-label="添加圆形"
              >
                <Circle size={16} />
              </button>
            </div>
            <div className="toolbar-group">
              <button
                className={variant ? 'cover-toggle active' : 'cover-toggle'}
                aria-pressed={Boolean(variant)}
                onClick={() => void cover()}
              >
                <Maximize2 size={14} />
                {variant ? '返回视频' : '4:3 封面'}
              </button>
              <span className="toolbar-divider" />
              <Button label="删除选中图层" disabled={!selected.length} onClick={removeSelected}>
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
          <div
            className="canvas-area"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            <Canvas
              project={project}
              sceneId={scene.id}
              variantId={variantId}
              timeUs={timeUs}
              playing={playing}
              hooks={hooks}
              zoom={zoom}
              onError={fail}
            />
            <div className="canvas-caption">
              <span className="canvas-scene-label">
                <span className="canvas-scene-number">
                  {variant
                    ? '独立封面布局'
                    : '场景 ' + String(project.scenes.indexOf(scene) + 1).padStart(2, '0')}
                </span>
                <span className="canvas-scene-title">{scene.title}</span>
              </span>
              <span>
                {variant ? '1440 × 1080' : '1920 × 1080'}
                <span className="canvas-dot">·</span>
                {variant ? '4:3' : '16:9'}
              </span>
            </div>
          </div>
          <div className="transport">
            <button
              className="play-button"
              aria-label={playing ? '暂停预览' : '播放预览'}
              onClick={() => void play()}
            >
              {playing ? (
                <Pause size={15} fill="currentColor" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
            </button>
            <span className="timecode">
              {timeLabel(timeUs)} <span>/ {timeLabel(total)}</span>
            </span>
            <input
              className="seek"
              type="range"
              aria-label="播放位置"
              min={0}
              max={total}
              step={10000}
              value={Math.min(total, timeUs)}
              style={{
                background: `linear-gradient(to right, var(--accent) ${Math.min(100, (timeUs / total) * 100)}%, var(--line) ${Math.min(100, (timeUs / total) * 100)}%)`,
              }}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span className="scene-counter">
              {String(project.scenes.indexOf(scene) + 1).padStart(2, '0')} /{' '}
              {String(project.scenes.length).padStart(2, '0')}
            </span>
            <span className="toolbar-divider" />
            <Button label="缩小画布" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
              <ZoomOut size={15} />
            </Button>
            <button className="zoom-label" onClick={() => setZoom(1)}>
              {zoom === 1 ? '适合画布' : Math.round(zoom * 100) + '%'}
            </button>
            <Button label="放大画布" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
              <ZoomIn size={15} />
            </Button>
          </div>
        </section>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={inspector === 'properties' ? 'active' : ''}
              aria-pressed={inspector === 'properties'}
              onClick={() => setInspector('properties')}
            >
              属性
            </button>
            <button
              className={inspector === 'script' ? 'active' : ''}
              aria-pressed={inspector === 'script'}
              onClick={() => setInspector('script')}
            >
              文案
            </button>
            <button
              className={inspector === 'layers' ? 'active' : ''}
              aria-pressed={inspector === 'layers'}
              onClick={() => setInspector('layers')}
            >
              图层<span>{nodes.length}</span>
            </button>
          </div>
          <div className="inspector-content" ref={inspectorPanel}>
            {inspector === 'properties' &&
              (node ? (
                <>
                  <div className="section-heading">
                    <span>
                      {node.type === 'text'
                        ? '文字图层'
                        : node.type === 'image'
                          ? '图片图层'
                          : '形状图层'}
                    </span>
                    <Button
                      label={node.locked ? '解锁图层' : '锁定图层'}
                      onClick={() => changeNode({ locked: !node.locked })}
                    >
                      {node.locked ? <Lock size={14} /> : <Unlock size={14} />}
                    </Button>
                  </div>
                  {node.locked && <p className="hint">图层已锁定，解锁后可以调整。</p>}
                  <fieldset disabled={node.locked}>
                    {node.type === 'text' && (
                      <>
                        <Field
                          label="文字内容"
                          value={node.text}
                          rows={4}
                          revision={project.revision}
                          onSave={(text, r) => changeNode({ text }, r)}
                        />
                        <div className="field-row">
                          <Field
                            label="字号"
                            value={node.fontSize}
                            type="number"
                            revision={project.revision}
                            onSave={(v, r) => changeNode({ fontSize: Number(v) }, r)}
                          />
                          <label className="field">
                            <span>字重</span>
                            <select
                              aria-label="字重"
                              value={node.bold ? 'bold' : 'normal'}
                              onChange={(e) => changeNode({ bold: e.target.value === 'bold' })}
                            >
                              <option value="normal">常规</option>
                              <option value="bold">加粗</option>
                            </select>
                          </label>
                        </div>
                        <label className="field">
                          <span>字体</span>
                          <select
                            aria-label="字体"
                            value={node.fontFamily}
                            onChange={(e) => changeNode({ fontFamily: e.target.value })}
                          >
                            {BUILTIN_FONTS.map((font) => (
                              <option key={font.family} value={font.family}>
                                {font.label}
                              </option>
                            ))}
                            {fontAssets.map((a) => (
                              <option key={a.id} value={a.fontFamily}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    <div className="field-row">
                      <Field
                        label="X"
                        value={Math.round(node.x)}
                        type="number"
                        revision={project.revision}
                        onSave={(v, r) => changeNode({ x: Number(v) }, r)}
                      />
                      <Field
                        label="Y"
                        value={Math.round(node.y)}
                        type="number"
                        revision={project.revision}
                        onSave={(v, r) => changeNode({ y: Number(v) }, r)}
                      />
                    </div>
                    <div className="field-row">
                      <Field
                        label="宽度"
                        value={Math.round(node.width)}
                        type="number"
                        revision={project.revision}
                        onSave={(v, r) => changeNode({ width: Number(v) }, r)}
                      />
                      <Field
                        label="高度"
                        value={Math.round(node.height)}
                        type="number"
                        revision={project.revision}
                        onSave={(v, r) => changeNode({ height: Number(v) }, r)}
                      />
                    </div>
                    <div className="field-row">
                      <Field
                        label="颜色"
                        value={node.fill.slice(0, 7)}
                        type="color"
                        revision={project.revision}
                        onSave={(fill, r) => changeNode({ fill }, r)}
                      />
                      <Field
                        label="透明度"
                        value={Math.round(node.opacity * 100)}
                        type="number"
                        revision={project.revision}
                        onSave={(v, r) => changeNode({ opacity: Number(v) / 100 }, r)}
                      />
                    </div>
                    {node.type === 'image' && (
                      <label className="field">
                        <span>图片适配</span>
                        <select
                          aria-label="图片适配"
                          value={node.fit}
                          onChange={(e) => changeNode({ fit: e.target.value as VisualNode['fit'] })}
                        >
                          <option value="cover">填充裁切</option>
                          <option value="contain">完整显示</option>
                        </select>
                      </label>
                    )}
                    <div className="section-heading">对齐与层级</div>
                    <div className="property-actions">
                      <Button
                        label="水平居中"
                        onClick={() =>
                          changeNode({ x: ((variant?.width ?? 1920) - node.width) / 2 })
                        }
                      >
                        <AlignCenter size={16} />
                      </Button>
                      <Button
                        label="垂直居中"
                        onClick={() => changeNode({ y: (1080 - node.height) / 2 })}
                      >
                        <AlignHorizontalJustifyCenter size={16} />
                      </Button>
                      <Button label="图层上移" onClick={() => reorderNode(1)}>
                        <ArrowUp size={16} />
                      </Button>
                      <Button label="图层下移" onClick={() => reorderNode(-1)}>
                        <ArrowDown size={16} />
                      </Button>
                    </div>
                    {selected.length > 1 && (
                      <button
                        className="secondary full"
                        onClick={() =>
                          execute(
                            [
                              {
                                type: 'nodes.group',
                                sceneId,
                                variantId,
                                ids: selected,
                                groupId: uid('group'),
                              },
                            ],
                            '编组图层',
                          )
                        }
                      >
                        <Group size={15} />
                        编组 {selected.length} 个图层
                      </button>
                    )}
                    {node.groupId && (
                      <button
                        className="secondary full"
                        onClick={() =>
                          execute(
                            [
                              {
                                type: 'nodes.group',
                                sceneId,
                                variantId,
                                ids: nodes
                                  .filter((n) => n.groupId === node.groupId)
                                  .map((n) => n.id),
                                groupId: null,
                              },
                            ],
                            '取消编组',
                          )
                        }
                      >
                        <Ungroup size={15} />
                        取消编组
                      </button>
                    )}
                    <label className="field">
                      <span>入场动效</span>
                      <select
                        aria-label="入场动效"
                        value={node.enter}
                        onChange={(e) =>
                          changeNode({ enter: e.target.value as VisualNode['enter'] })
                        }
                      >
                        <option value="none">无</option>
                        <option value="fade">淡入</option>
                        <option value="slide">向上浮现</option>
                        <option value="zoom">轻微放大</option>
                      </select>
                    </label>
                  </fieldset>
                  <button className="text-button" onClick={() => setSelected([])}>
                    <ArrowLeft size={14} />
                    返回场景设置
                  </button>
                </>
              ) : (
                <>
                  <div className="section-heading">
                    <span>场景设置</span>
                    <Settings2 size={14} />
                  </div>
                  <Field
                    label="场景名称"
                    value={scene.title}
                    revision={project.revision}
                    onSave={(title, r) =>
                      execute(
                        [{ type: 'scene.update', sceneId, changes: { title } }],
                        '修改场景名称',
                        r,
                      )
                    }
                  />
                  <div className="field-row">
                    <Field
                      label="时长 · 秒"
                      value={scene.durationUs / 1e6}
                      type="number"
                      revision={project.revision}
                      onSave={(v, r) =>
                        execute(
                          [
                            {
                              type: 'scene.update',
                              sceneId,
                              changes: { durationUs: Math.round(Number(v) * 1e6) },
                            },
                          ],
                          '调整时长',
                          r,
                        )
                      }
                    />
                    <Field
                      label="背景色"
                      value={scene.background}
                      type="color"
                      revision={project.revision}
                      onSave={(background, r) =>
                        execute(
                          [{ type: 'scene.update', sceneId, changes: { background } }],
                          '修改背景',
                          r,
                        )
                      }
                    />
                  </div>
                  <label className="field">
                    <span>进入场景时</span>
                    <select
                      aria-label="场景转场"
                      value={scene.transition}
                      onChange={(e) =>
                        execute(
                          [
                            {
                              type: 'scene.update',
                              sceneId,
                              changes: { transition: e.target.value as Scene['transition'] },
                            },
                          ],
                          '修改转场',
                        )
                      }
                    >
                      <option value="cut">直接切换</option>
                      <option value="crossfade">交叉淡化</option>
                    </select>
                  </label>
                  <div className="section-heading">
                    <span>声音与节奏</span>
                    <AudioLines size={14} />
                  </div>
                  <label className="field">
                    <span>配音素材</span>
                    <select
                      aria-label="配音素材"
                      value={scene.narration?.assetId ?? ''}
                      onChange={(e) => {
                        if (e.target.value) attachAudio(project.assets[e.target.value]);
                        else
                          execute(
                            [
                              {
                                type: 'narration.set',
                                sceneId,
                                narration: null,
                                fitDuration: false,
                              },
                            ],
                            '移除配音',
                          );
                      }}
                    >
                      <option value="">未设置配音</option>
                      {audioAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {scene.narration ? (
                    <>
                      <div className="field-row">
                        <Field
                          label="裁剪起点 · 秒"
                          value={scene.narration.trimStartUs / 1e6}
                          type="number"
                          revision={project.revision}
                          onSave={(v, r) =>
                            execute(
                              [
                                {
                                  type: 'narration.set',
                                  sceneId,
                                  narration: {
                                    ...scene.narration!,
                                    trimStartUs: Math.round(Number(v) * 1e6),
                                  },
                                  fitDuration: true,
                                },
                              ],
                              '裁剪配音',
                              r,
                            )
                          }
                        />
                        <Field
                          label="裁剪终点 · 秒"
                          value={scene.narration.trimEndUs / 1e6}
                          type="number"
                          revision={project.revision}
                          onSave={(v, r) =>
                            execute(
                              [
                                {
                                  type: 'narration.set',
                                  sceneId,
                                  narration: {
                                    ...scene.narration!,
                                    trimEndUs: Math.round(Number(v) * 1e6),
                                  },
                                  fitDuration: true,
                                },
                              ],
                              '裁剪配音',
                              r,
                            )
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <button className="subtle-upload" onClick={() => files.current?.click()}>
                      <Upload size={14} />
                      导入配音文件
                    </button>
                  )}
                  <Field
                    label="本页之后停顿 · 秒"
                    value={scene.gapUs / 1e6}
                    type="number"
                    revision={project.revision}
                    onSave={(v, r) =>
                      execute(
                        [
                          {
                            type: 'scene.update',
                            sceneId,
                            changes: { gapUs: Math.round(Number(v) * 1e6) },
                          },
                        ],
                        '调整场景间隔',
                        r,
                      )
                    }
                  />
                  <button className="secondary full" onClick={() => void analyze()}>
                    <SlidersHorizontal size={14} />
                    检查首尾静音
                  </button>
                  <div className="section-heading">场景操作</div>
                  <div className="property-actions">
                    <Button label="场景前移" onClick={() => reorderScene(-1)}>
                      <ArrowUp size={16} />
                    </Button>
                    <Button label="场景后移" onClick={() => reorderScene(1)}>
                      <ArrowDown size={16} />
                    </Button>
                    <Button
                      label="复制场景"
                      onClick={() =>
                        execute(
                          [{ type: 'scene.duplicate', sceneId, newId: uid('scene') }],
                          '复制场景',
                        )
                      }
                    >
                      <Copy size={16} />
                    </Button>
                    <Button
                      label="删除场景"
                      disabled={project.scenes.length < 2 || saving > 0}
                      onClick={() => removeScene()}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </>
              ))}
            {inspector === 'script' && (
              <>
                <div className="section-heading">口播文案</div>
                <p className="hint">交给 Agent 生成配音后，将音频导入此场景。</p>
                <Field
                  label="口播文案"
                  value={scene.narrationText}
                  rows={7}
                  revision={project.revision}
                  onSave={(narrationText, r) =>
                    execute(
                      [{ type: 'scene.update', sceneId, changes: { narrationText } }],
                      '修改口播文案',
                      r,
                    )
                  }
                />
                <div className="section-heading">字幕</div>
                <p className="hint">使用配音对应的时间信息，或导入此场景的 SRT 文件。</p>
                <button className="secondary full" onClick={openCaptions}>
                  <Subtitles size={15} />
                  编辑字幕 <span>{scene.captions.length}</span>
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={project.showCaptions}
                    onChange={(e) =>
                      execute(
                        [{ type: 'project.captions', visible: e.target.checked }],
                        '切换字幕显示',
                      )
                    }
                  />
                  成片显示字幕
                </label>
                <div className="section-heading">制作备注</div>
                <Field
                  label="制作备注"
                  value={scene.notes}
                  rows={5}
                  revision={project.revision}
                  onSave={(notes, r) =>
                    execute(
                      [{ type: 'scene.update', sceneId, changes: { notes } }],
                      '修改制作备注',
                      r,
                    )
                  }
                />
                <p className="hint">仅供制作参考，始终与口播、字幕分开。</p>
              </>
            )}
            {inspector === 'layers' && (
              <>
                <div className="section-heading">
                  图层 <span className="muted">从上到下</span>
                </div>
                <div className="layer-list">
                  {[...nodes].reverse().map((n) => (
                    <button
                      key={n.id}
                      className={selected.includes(n.id) ? 'active' : ''}
                      onClick={() => selectNode(n.id)}
                    >
                      {n.type === 'text' ? (
                        <Type size={14} />
                      ) : n.type === 'image' ? (
                        <ImageIcon size={14} />
                      ) : (
                        <Square size={14} />
                      )}
                      <span>{n.name || n.text || '图层'}</span>
                      {n.locked && <Lock size={12} />}
                    </button>
                  ))}
                </div>
                {!nodes.length && (
                  <div className="empty-layers">
                    <Layers size={24} />
                    <p>这里还没有图层</p>
                    <span>从工具栏添加文字、图片或形状</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="inspector-status">
            <span
              className={'agent-state ' + (mode.startsWith('native') ? 'connected' : '')}
              title={
                mode.startsWith('native')
                  ? '浏览器原生 WebMCP 已注册'
                  : '此浏览器可手动编辑；Agent 接入需要支持 WebMCP 的浏览器'
              }
            >
              <span className="tiny-dot" />
              {mode.startsWith('native') ? 'Agent 已就绪' : '本地编辑'}
            </span>
            <span className="local-label">浏览器工作空间</span>
          </div>
        </aside>
      </main>
      <section className="timeline" aria-label="时间轴">
        <div className="timeline-top">
          <span>
            <Layers size={15} />
            时间轴
            <span className="timeline-summary">
              {project.scenes.length} 个场景 · {timeLabel(total)}
            </span>
          </span>
          <div>
            <button onClick={openCaptions}>
              <Subtitles size={14} />
              字幕
            </button>
            <button onClick={() => setDialog('assets')}>
              <Music2 size={14} />
              声音
            </button>
            <span className="muted">30 FPS</span>
          </div>
        </div>
        <div className="timeline-body">
          <div className="track-labels">
            <div />
            <span>
              <Film size={13} />
              画面
            </span>
            <span>
              <AudioLines size={13} />
              配音
            </span>
            <span>
              <Subtitles size={13} />
              字幕
            </span>
          </div>
          <div className="tracks">
            <div className="ruler">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} style={{ left: (i / 6) * 100 + '%' }}>
                  {timeLabel((total * i) / 6)}
                </span>
              ))}
            </div>
            <div className="track-row video-track">
              {entries.map(({ scene: s, startUs }) => (
                <button
                  key={s.id}
                  className={s.id === scene.id ? 'active' : ''}
                  style={{
                    left: (startUs / total) * 100 + '%',
                    width: (s.durationUs / total) * 100 + '%',
                  }}
                  onClick={() => chooseScene(s.id)}
                >
                  <span>{String(project.scenes.indexOf(s) + 1).padStart(2, '0')}</span>
                  {s.title}
                </button>
              ))}
            </div>
            <div className="track-row audio-track">
              {entries.map(({ scene: s, startUs }) => (
                <button
                  key={s.id}
                  className={s.narration ? 'has-audio' : 'empty-track'}
                  style={{
                    left: (startUs / total) * 100 + '%',
                    width: (s.durationUs / total) * 100 + '%',
                  }}
                  onClick={() => {
                    chooseScene(s.id);
                    setInspector('properties');
                  }}
                >
                  {s.narration ? (
                    <svg viewBox="0 0 320 28" preserveAspectRatio="none" aria-label="音频波形">
                      {(project.assets[s.narration.assetId]?.peaks ?? []).map((peak, i) => (
                        <rect
                          key={i}
                          x={i * 2}
                          y={14 - Math.max(1, peak * 12)}
                          width="1.2"
                          height={Math.max(2, peak * 24)}
                          rx=".6"
                        />
                      ))}
                    </svg>
                  ) : (
                    <span>＋ 添加配音</span>
                  )}
                </button>
              ))}
            </div>
            <div className="track-row caption-track">
              {entries.map(({ scene: s, startUs }) =>
                s.captions.length ? (
                  s.captions.map((c) => (
                    <button
                      key={s.id + c.id}
                      style={{
                        left: ((startUs + c.startUs) / total) * 100 + '%',
                        width: ((c.endUs - c.startUs) / total) * 100 + '%',
                      }}
                      onClick={() => {
                        chooseScene(s.id);
                        setInspector('script');
                      }}
                    >
                      {c.text}
                    </button>
                  ))
                ) : (
                  <button
                    key={s.id}
                    className="empty-track"
                    style={{
                      left: (startUs / total) * 100 + '%',
                      width: (s.durationUs / total) * 100 + '%',
                    }}
                    onClick={() => {
                      chooseScene(s.id);
                      setInspector('script');
                    }}
                  >
                    ＋ 添加字幕
                  </button>
                ),
              )}
            </div>
            <div className="playhead" style={{ left: Math.min(100, (timeUs / total) * 100) + '%' }}>
              <i />
            </div>
            <input
              className="timeline-seek"
              aria-label="时间轴跳转"
              type="range"
              min={0}
              max={total}
              step={10000}
              value={Math.min(timeUs, total)}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
        </div>
      </section>
      <footer className="statusbar">
        <span>
          <span className="tiny-dot" />
          {variant ? '封面独立保存，不影响视频场景' : '自动保存在此浏览器 · 建议定期导出工程包备份'}
        </span>
        <span>
          ⌘ Z 撤销 <span className="status-separator">·</span> Shift 点击多选{' '}
          <span className="status-separator">·</span> Muweave 0.1
        </span>
      </footer>
      <input
        ref={files}
        type="file"
        hidden
        multiple
        accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.mp3,.wav,.m4a,.aac,.flac,.ogg,.ttf,.otf,.woff,.woff2"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={bundle}
        type="file"
        hidden
        accept=".zip"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const p = await importBundle(f);
            await open(p.id);
            notify('工程包已打开');
          } catch (e) {
            fail(e);
          }
        }}
      />
      <input
        ref={captionFile}
        type="file"
        hidden
        accept=".srt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setSrt(await f.text());
          e.target.value = '';
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <Button label="关闭错误提示" onClick={() => setError('')}>
            <X size={16} />
          </Button>
        </div>
      )}
      {dialog === 'assets' && (
        <Modal title="素材库" wide onClose={() => setDialog(null)}>
          {agentImport && (
            <div className="agent-import-box">
              <strong>Agent 素材导入</strong>
              <p role="status">{agentImport.status}</p>
              <button
                className="secondary"
                disabled={
                  agentImport.status === '正在处理素材…' ||
                  agentImport.status === '素材已准备好，Agent 可提交导入'
                }
                onClick={() => document.getElementById('muweave-agent-file')?.click()}
              >
                选择 Agent 素材
              </button>
              <input
                id="muweave-agent-file"
                type="file"
                hidden
                accept=".png,.jpg,.jpeg,.webp,.svg,.wav,.mp3,.m4a,.aac,.flac,.ogg,.ttf,.otf,.woff,.woff2"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const importId = agentImport.importId;
                  setAgentImport({ importId, status: '正在处理素材…' });
                  try {
                    await stageImport(importId, file);
                    setAgentImport({ importId, status: '素材已准备好，Agent 可提交导入' });
                  } catch (error) {
                    setAgentImport({ importId, status: '处理失败，请重新选择文件' });
                    fail(error);
                  }
                }}
              />
            </div>
          )}

          <div className="modal-intro">
            <p>把图片、配音和字体放在这里，随时编入故事。</p>
            <button className="primary" onClick={() => files.current?.click()}>
              <Upload size={15} />
              {saving ? '导入中…' : '导入素材'}
            </button>
          </div>
          <div className="asset-grid">
            {Object.values(project.assets).map((a) => (
              <article className="asset-card" key={a.id}>
                {a.kind === 'image' ? (
                  <img src={assetUrl(project, a.id)} alt={a.name} />
                ) : a.kind === 'audio' ? (
                  <div className="asset-symbol">
                    <AudioLines size={34} />
                    <span>{timeLabel(a.durationUs ?? 0)}</span>
                  </div>
                ) : (
                  <div className="asset-symbol">Aa</div>
                )}
                <strong title={a.name}>{a.name}</strong>
                <small>
                  {a.kind === 'image'
                    ? a.width + ' × ' + a.height
                    : a.kind === 'audio'
                      ? '音频素材'
                      : '字体素材'}
                </small>
                {a.kind === 'image' ? (
                  <button className="secondary" onClick={() => addNode('image', a)}>
                    加入画布
                  </button>
                ) : a.kind === 'audio' ? (
                  <>
                    <audio controls preload="none" src={assetUrl(project, a.id)} />
                    <div className="asset-actions">
                      <button onClick={() => attachAudio(a)}>设为本页配音</button>
                      <button
                        onClick={() => {
                          execute(
                            [
                              {
                                type: 'music.set',
                                music: { assetId: a.id, gain: 0.12, trimStartUs: 0 },
                              },
                            ],
                            '设置背景音乐',
                          );
                          setDialog(null);
                        }}
                      >
                        背景音乐
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="hint">可在文字属性中选择</span>
                )}
              </article>
            ))}
          </div>
          {!Object.keys(project.assets).length && (
            <div className="empty-state" onClick={() => files.current?.click()}>
              <div className="empty-icon">
                <ImageIcon size={28} />
              </div>
              <h3>为故事添一点画面和声音</h3>
              <p>拖入文件，或点击「导入素材」。</p>
              <span>图片 / 音频 / 字体 · 单个文件最大 100 MB</span>
            </div>
          )}
          {project.music && (
            <div className="music-setting">
              <Music2 size={18} />
              <span>背景音乐：{project.assets[project.music.assetId].name}</span>
              <label>
                音量{' '}
                <input
                  aria-label="背景音乐音量"
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  defaultValue={project.music.gain}
                  onPointerUp={(e) =>
                    execute(
                      [
                        {
                          type: 'music.set',
                          music: { ...project.music!, gain: Number(e.currentTarget.value) },
                        },
                      ],
                      '调整音乐音量',
                    )
                  }
                />
              </label>
              <button onClick={() => execute([{ type: 'music.set', music: null }], '移除背景音乐')}>
                移除
              </button>
            </div>
          )}
        </Modal>
      )}
      {dialog === 'projects' && (
        <Modal title="你的创作" onClose={() => setDialog(null)}>
          <div className="project-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={p.id === project.id ? 'active' : ''}
                onClick={() => void open(p.id)}
              >
                <Film size={19} />
                <span>{p.title}</span>
                {p.id === project.id ? <Check size={16} /> : <ArrowRight size={16} />}
              </button>
            ))}
          </div>
          <form
            className="new-project"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const p = await store.create(newTitle.trim() || '未命名的故事');
                setNewTitle('');
                await open(p.id);
              } catch (e) {
                fail(e);
              }
            }}
          >
            <label className="field">
              <span>新工程名称</span>
              <input
                aria-label="新工程名称"
                placeholder="下一个故事，关于什么？"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <button className="primary" type="submit">
              <Plus size={16} />
              新建工程
            </button>
          </form>
          <div className="modal-bottom-actions">
            <button onClick={() => bundle.current?.click()}>
              <FileArchive size={15} />
              打开工程包
            </button>
            <button
              onClick={async () => {
                const p = await store.create('Muweave 创作示例', true);
                await open(p.id);
              }}
            >
              <Sparkles size={15} />
              新建示例
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'export' && (
        <Modal title="让作品，走出画布" wide onClose={() => setDialog(null)}>
          <p className="modal-description">导出当前保存的版本。导出期间，可以继续编辑。</p>
          <p className="hint">
            在此浏览器生成并保存。视频首次使用需加载约 31 MB 编码器，完成前请保持页面打开。
          </p>
          <div className="export-options">
            <button onClick={() => void exportFile('mp4')}>
              <Film size={28} />
              <strong>视频</strong>
              <span>1920 × 1080 · MP4 · 30fps</span>
              <small>画面、配音与字幕，一起出发</small>
            </button>
            <button onClick={() => void exportFile('png')}>
              <ImageIcon size={28} />
              <strong>{variant ? '4:3 封面' : '当前画面'}</strong>
              <span>{variant ? '1440 × 1080' : '1920 × 1080'} · PNG</span>
              <small>{variant ? '导出独立排版后的封面' : '可先切换到 4:3 封面进行排版'}</small>
            </button>
            <button onClick={() => void exportFile('bundle')}>
              <FileArchive size={28} />
              <strong>工程包</strong>
              <span>可编辑工程 + 全部素材</span>
              <small>换一台设备，接着创作</small>
            </button>
          </div>
          {previewJob && (
            <div className="export-preview">
              <div className="section-heading">
                成片预览
                <button className="text-button" onClick={() => setPreviewJob(undefined)}>
                  收起
                </button>
              </div>
              <video
                key={previewJob}
                aria-label="成片预览"
                controls
                playsInline
                preload="auto"
                src={jobs.find((j) => j.id === previewJob)?.downloadUrl}
              />
            </div>
          )}
          <div className="section-heading">导出记录</div>
          {jobs.length ? (
            <div className="job-list">
              {jobs.map((j) => (
                <div className="job" key={j.id}>
                  <div className="job-icon">
                    {j.format === 'mp4' ? (
                      <Film size={18} />
                    ) : j.format === 'png' ? (
                      <ImageIcon size={18} />
                    ) : (
                      <FileArchive size={18} />
                    )}
                  </div>
                  <div className="job-info">
                    <strong>
                      {j.format === 'bundle' ? '工程包' : j.format.toUpperCase()}{' '}
                      <span>· 版本 {j.revision}</span>
                      {j.format === 'mp4' && <span> · 浏览器</span>}
                    </strong>
                    <p className={j.status === 'failed' ? 'failed' : ''}>
                      {j.error ||
                        (j.status === 'running' ? j.stage : undefined) ||
                        jobLabels[j.status]}
                    </p>
                    {j.status === 'succeeded' && j.report?.renderSeconds != null && (
                      <p className="export-metrics">
                        耗时 {Number(j.report.renderSeconds).toFixed(1)} 秒
                        {j.report.outputBytes
                          ? ` · ${(Number(j.report.outputBytes) / 1024 / 1024).toFixed(2)} MB`
                          : ''}
                      </p>
                    )}
                    {['queued', 'running'].includes(j.status) && (
                      <progress max="1" value={j.progress} />
                    )}
                  </div>
                  {j.status === 'succeeded' ? (
                    <div className="job-actions">
                      {j.format === 'mp4' && (
                        <button className="text-button" onClick={() => setPreviewJob(j.id)}>
                          <Play size={14} />
                          预览
                        </button>
                      )}
                      <a className="secondary" href={j.downloadUrl} download={j.file}>
                        <Download size={14} />
                        下载
                      </a>
                    </div>
                  ) : ['queued', 'running'].includes(j.status) ? (
                    <button
                      className="text-button"
                      onClick={() => void cancelExport(j.id).catch(fail)}
                    >
                      取消
                    </button>
                  ) : (
                    <span className="muted">{jobLabels[j.status]}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">选择一种格式，开始第一次导出。</p>
          )}
          <button
            className="text-button"
            onClick={() =>
              downloadBlob(
                new Blob([toSrt(project)], { type: 'application/x-subrip' }),
                project.title + '.srt',
              )
            }
          >
            <Subtitles size={14} />
            单独下载字幕 SRT
          </button>
        </Modal>
      )}
      {dialog === 'captions' && (
        <Modal title={'字幕 · ' + scene.title} wide onClose={() => setDialog(null)}>
          <p className="modal-description">时间从此场景起点开始计算。请使用实际配音的时间信息。</p>
          <textarea
            className="srt-editor"
            aria-label="SRT 字幕"
            value={srt}
            placeholder={'1\n00:00:00,000 --> 00:00:03,000\n第一句话的字幕'}
            onChange={(e) => setSrt(e.target.value)}
          />
          <div className="modal-bottom-actions">
            <button onClick={() => captionFile.current?.click()}>
              <Upload size={15} />
              导入 SRT
            </button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await commit(
                    [{ type: 'captions.set', sceneId, captions: parseSrt(srt) }],
                    '更新字幕',
                  );
                  setDialog(null);
                  notify('字幕已更新');
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <Check size={15} />
              保存字幕
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'analysis' && (
        <Modal title="声音与停顿" onClose={() => setDialog(null)}>
          {analyzing ? (
            <div className="empty-state">
              <span className="spinner" />
              <p>正在检测配音片段的首尾静音…</p>
            </div>
          ) : analysis ? (
            <>
              <p className="modal-description">
                检测片段首尾，保留句中自然停顿。建议裁剪后，可播放试听。
              </p>
              <div className="analysis-list">
                {analysis.trims.length ? (
                  analysis.trims.map((t: any) => (
                    <div key={t.sceneId}>
                      <strong>{project.scenes.find((s) => s.id === t.sceneId)?.title}</strong>
                      <span>
                        开头 {(t.leadingUs / 1e6).toFixed(2)}s · 结尾{' '}
                        {(t.trailingUs / 1e6).toFixed(2)}s
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="hint">还没有配音素材。导入配音后再检查。</p>
                )}
              </div>
              <div className="modal-bottom-actions">
                <button
                  onClick={() =>
                    execute([{ type: 'timeline.set_gap', gapUs: 0 }], '移除额外切页间隔')
                  }
                >
                  移除额外切页间隔
                </button>
                <button
                  className="primary"
                  disabled={!analysis.trims.some((t: any) => t.suggestion)}
                  onClick={async () => {
                    try {
                      await commit(
                        analysis.trims
                          .filter((t: any) => t.suggestion)
                          .map((t: any) => ({
                            type: 'narration.set',
                            sceneId: t.sceneId,
                            narration: t.suggestion,
                            fitDuration: true,
                          })),
                        '裁剪配音首尾静音',
                      );
                      setDialog(null);
                      notify('首尾裁剪已应用，字幕同步调整');
                    } catch {}
                  }}
                >
                  应用首尾裁剪
                </button>
              </div>
            </>
          ) : (
            <p className="hint">检测未完成，请关闭后重试。</p>
          )}
        </Modal>
      )}
    </div>
  );
}
