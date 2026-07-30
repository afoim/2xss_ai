'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { goAuthorize } from '@/lib/auth-bridge';
import { addToQueue } from '@/lib/draw/api/client';
import { saveImages, loadImages } from '@/lib/draw/image-store';
import { Spinner } from '@/components/ui/spinner';

const API_BASE = 'https://api-ai.acofork.com';
const MAX_IMAGES = 2;

interface Props {
  pointsCost?: number;
  workflowPath?: string;
  onQueueUpdate?: () => void;
}

interface ImageItem {
  file: File;
  dataUrl: string;
}

function uploadFileWithProgress(
  url: string,
  headers: Record<string, string>,
  form: FormData,
  onProgress: (pct: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
    xhr.onerror = () => reject(new Error('上传失败'));
    xhr.send(form);
  });
}

const STORAGE_KEY = 'draw-img2img-flux';

export function Img2imgForm({ pointsCost, workflowPath, onQueueUpdate }: Props) {
  const [images, setImages] = useState<ImageItem[]>([]);
  const imagesRef = useRef<ImageItem[]>([]);
  const [cnPrompt, setCnPrompt] = useState('');
  const [enPrompt, setEnPrompt] = useState('');
  const cnPromptRef = useRef('');
  const enPromptRef = useRef('');
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoringRef = useRef(true);

  // 保持 ref 与 state 同步——saveState 总是从 ref 读，不走闭包
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { cnPromptRef.current = cnPrompt; }, [cnPrompt]);
  useEffect(() => { enPromptRef.current = enPrompt; }, [enPrompt]);

  // Restore: 图片从 IndexedDB，文本从 localStorage
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const parsed = saved ? JSON.parse(saved) : null;
        if (parsed?.cnPrompt) setCnPrompt(parsed.cnPrompt);
        if (parsed?.enPrompt) setEnPrompt(parsed.enPrompt);

        const files = await loadImages();
        if (files.length) {
          // FileReader 生成 dataUrl 用于预览
          const items: ImageItem[] = [];
          let loaded = 0;
          for (const f of files) {
            const reader = new FileReader();
            reader.onload = () => {
              items.push({ file: f, dataUrl: reader.result as string });
              loaded++;
              if (loaded === files.length) setImages(items);
            };
            reader.readAsDataURL(f);
          }
        }
      } catch {}
      restoringRef.current = false;
    })();
  }, []);

  // 图片→IndexedDB，文本→localStorage；参数为 null 时从 ref 取当前值
  const saveState = useCallback((imgs?: ImageItem[] | null, cn?: string | null, en?: string | null) => {
    if (restoringRef.current) return;
    const targetImgs = imgs ?? imagesRef.current;
    const targetCn = cn ?? cnPromptRef.current;
    const targetEn = en ?? enPromptRef.current;

    // 图片存 IndexedDB（大文件，无配额问题）
    saveImages(targetImgs.map((i) => i.file)).catch(() => {});

    // 文本存 localStorage（小文本，同步快）
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cnPrompt: targetCn, enPrompt: targetEn }));
    } catch {}
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    if (!input.files?.length) return;
    const newFiles = Array.from(input.files);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;
    const added = newFiles.slice(0, remaining);
    const newImages = [...images];
    let loaded = 0;
    for (const f of added) {
      const idx = newImages.length;
      const url = URL.createObjectURL(f);
      newImages.push({ file: f, dataUrl: url });
      const reader = new FileReader();
      reader.onload = () => {
        newImages[idx] = { ...newImages[idx], dataUrl: reader.result as string };
        URL.revokeObjectURL(url);
        loaded++;
        if (loaded >= added.length) {
          setImages([...newImages]);
          saveState([...newImages]);
        }
      };
      reader.readAsDataURL(f);
    }
    input.value = '';
  }, [images, saveState]);

  const removeImage = useCallback((idx: number) => {
    URL.revokeObjectURL(images[idx].dataUrl);
    const next = images.filter((_, i) => i !== idx);
    setImages(next);
    saveState(next);
  }, [images, saveState]);

  // Drag reorder
  const handleDragStart = (i: number) => setDraggedIdx(i);
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverIdx(i); };
  const handleDrop = (i: number) => {
    if (draggedIdx === null || draggedIdx === i) { setDraggedIdx(null); setDragOverIdx(null); return; }
    const arr = [...images];
    const [moved] = arr.splice(draggedIdx, 1);
    arr.splice(i, 0, moved);
    setImages(arr);
    saveState(arr);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDraggedIdx(null); setDragOverIdx(null); };

  const handleTranslate = useCallback(async () => {
    if (!cnPrompt.trim()) return;
    setTranslating(true);
    try {
      const token = localStorage.getItem('forum-auth-token');
      const baseUrl = localStorage.getItem('draw-api-base-url') || API_BASE;
      const res = await fetch(`${baseUrl}/api/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: cnPrompt, mode: 'anima' }),
      });
      const data = await res.json();
      if (data.ok) {
        setEnPrompt(data.positive);
        saveState(null, null, data.positive as string);
      } else {
        toast.error('翻译失败', { description: data.detail || data.error || '' });
      }
    } catch (e) {
      toast.error('翻译失败', { description: e instanceof Error ? e.message : '未知错误' });
    } finally {
      setTranslating(false);
    }
  }, [cnPrompt, images, saveState]);

  const handleCnChange = useCallback((v: string) => {
    setCnPrompt(v);
    saveState(null, v);
  }, [saveState]);

  const handleEnChange = useCallback((v: string) => {
    setEnPrompt(v);
    saveState(null, null, v);
  }, [saveState]);

  const startGeneration = useCallback(async () => {
    if (uploading || images.length === 0) return;
    const token = localStorage.getItem('forum-auth-token');
    if (!token) { toast.error('请先登录', { description: '正在前往论坛授权…' }); goAuthorize(); return; }
    if (!enPrompt.trim() && !cnPrompt.trim()) { toast.error('请输入描述'); return; }

    setUploading(true);
    setUploadProgress(0);
    try {
      const baseUrl = localStorage.getItem('draw-api-base-url') || API_BASE;
      // 1. Upload images
      const form = new FormData();
      form.append('image1', images[0].file);
      if (images.length > 1) form.append('image2', images[1].file);

      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const uploadResp = await uploadFileWithProgress(
        `${baseUrl}/api/img2img/upload`, headers, form, setUploadProgress,
      );
      if (!uploadResp.ok) {
        const body = await uploadResp.json().catch(() => ({ message: uploadResp.statusText }));
        throw new Error(body.error || body.message || body.detail || '上传失败');
      }
      const uploadData = await uploadResp.json();

      // 2. Add to queue
      const payload: Record<string, unknown> = {
        direct_prompt: enPrompt.trim() || cnPrompt.trim(),
        image1_name: uploadData.image1_name,
      };
      if (uploadData.image2_name) payload.image2_name = uploadData.image2_name;
      if (workflowPath) payload.workflow_path = workflowPath;
      await addToQueue(payload);

      toast.success('已加入队列', { description: '等待生图中，前往"我的"页面查看详情。' });
      if (onQueueUpdate) onQueueUpdate();
    } catch (e) {
      toast.error('加入队列失败', { description: e instanceof Error ? e.message : '生成失败' });
    } finally {
      setUploading(false);
    }
  }, [uploading, images, enPrompt, cnPrompt, workflowPath, onQueueUpdate]);

  return (
    <div className="space-y-4">
      {/* Image Upload */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Icon icon="mdi:image-plus" className="size-4" />
            上传图片
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{images.length}/{MAX_IMAGES}</span>
          </h3>
          {images.length > 1 && (
            <span className="text-xs text-muted-foreground">拖拽调整顺序</span>
          )}
        </div>

        <div className="flex gap-3 flex-wrap">
          {images.map((item, i) => (
            <div
              key={i}
              className={`relative group ${dragOverIdx === i && draggedIdx !== null && draggedIdx !== i ? 'ring-2 ring-primary rounded-lg' : ''}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
            >
              <img
                src={item.dataUrl}
                alt={`preview ${i}`}
                className="size-28 object-cover rounded-lg border border-border"
              />
              <div className="absolute top-1 left-1 size-5 rounded-full bg-background/80 flex items-center justify-center text-xs font-medium text-muted-foreground">
                {i + 1}
              </div>
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 transition-colors"
                title="移除"
              >
                <Icon icon="mdi:close" className="size-3" />
              </button>
            </div>
          ))}

          {images.length < MAX_IMAGES && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="size-28 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground"
            >
              <Icon icon="mdi:plus" className="size-6" />
              <span className="text-xs">{images.length === 0 ? '选择图片' : '上传更多'}</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          multiple
          onChange={handleFileInput}
        />
      </div>

      {/* Prompt */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Icon icon="mdi:text-box-outline" className="size-4" />
          描述
        </h3>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">中文描述</label>
          <Textarea
            value={cnPrompt}
            onChange={(e) => handleCnChange(e.target.value)}
            placeholder="把人物的衣服换成红色…"
            rows={2}
            disabled={uploading}
            className="resize-none min-h-[52px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleTranslate} disabled={translating || !cnPrompt.trim()}>
            {translating ? (
              <Spinner className="size-4" />
            ) : (
              <Icon icon="mdi:auto-fix" className="size-4" />
            )}
            翻译为英文
          </Button>
          <span className="text-[11px] text-muted-foreground">支持中文，但英文遵从度更好</span>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">英文描述（最终使用的提示词）</label>
          <Textarea
            value={enPrompt}
            onChange={(e) => handleEnChange(e.target.value)}
            placeholder="change the character's clothes to red…"
            rows={3}
            disabled={uploading}
            className="resize-none min-h-[72px]"
          />
        </div>
      </div>

      {/* Submit */}
      <Button
        onClick={startGeneration}
        disabled={!images.length || uploading}
        size="lg"
        className="w-full gap-2"
      >
        {uploading ? (
          <>
            <Spinner className="size-5" />
            上传中 {uploadProgress}%
          </>
        ) : (
          <>
            <Icon icon="mdi:playlist-plus" className="size-5" />
            加入队列
            {pointsCost ? (
              <span className="ml-1.5 inline-flex items-center text-[10px] px-1 bg-secondary text-secondary-foreground"><Icon icon="mdi:lightning-bolt" className="size-3" />{pointsCost}</span>
            ) : null}
          </>
        )}
      </Button>
    </div>
  );
}
