'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { drawRequest, fetchPointsConfig } from '@/lib/draw/api/client';
import { toast } from 'sonner';
import { goAuthorize } from '@/lib/auth-bridge';
import { Spinner } from '@/components/ui/spinner';

const MODELS = ['4x-ESRGAN.pth', '4x-UltraSharp.pth', '4xNomos8kDAT.pth', 'BSRGANx2.pth'];

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

export function UpscaleTab({ onQueueUpdate }: { onQueueUpdate?: () => void }) {
  const [image, setImage] = useState<{ file: File; dataUrl: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState('4x-ESRGAN.pth');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pointsCost, setPointsCost] = useState(5);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('forum-auth-token');
    setIsLoggedIn(!!token);
    fetchPointsConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      if (typeof c.image_upscale === 'number') setPointsCost(c.image_upscale);
    }).catch(() => {});
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage({ file, dataUrl: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  }, []);

  const removeImage = useCallback(() => {
    if (image) URL.revokeObjectURL(image.dataUrl);
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [image]);

  const scaleFactor = selectedModel === 'BSRGANx2.pth' ? 2.0 : 4.0;

  const startGeneration = useCallback(async () => {
    if (!image) { toast.error('请先上传图片'); return; }
    if (!isLoggedIn) { toast.error('请先登录', { description: '正在前往论坛授权…' }); goAuthorize(); return; }

    setUploading(true);
    setUploadProgress(0);

    try {
      const token = localStorage.getItem('forum-auth-token');
      const baseUrl = localStorage.getItem('draw-api-base-url') || 'https://api-ai.acofork.com';

      // 1. Upload image
      const form = new FormData();
      form.append('image1', image.file);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const uploadResp = await uploadFileWithProgress(
        `${baseUrl}/api/img2img/upload`, headers, form, setUploadProgress,
      );
      if (!uploadResp.ok) {
        const text = await uploadResp.text();
        throw new Error(text || '图片上传失败');
      }
      const uploadData = await uploadResp.json();
      if (!uploadData.image1_name) throw new Error('未获取到已上传的文件名');

      // 2. Queue upscale job
      const res = await drawRequest<{ queued?: boolean; position?: number }>('/api/draw/queue', {
        method: 'POST',
        body: JSON.stringify({
          direct_prompt: selectedModel,
          workflow_path: 'Upscale/超分辨率.json',
          image1_name: uploadData.image1_name,
          denoise: scaleFactor,
        }),
      });

      if (res.queued || res.position != null) {
        toast.success('已加入超分队列', {
          description: res.position ? `当前排在第 ${res.position} 位。请切换到「我的」页面查看结果。` : undefined,
        });
        setImage(null);
        if (onQueueUpdate) onQueueUpdate();
      } else {
        throw new Error('入队失败');
      }
    } catch (e) {
      toast.error('超分处理失败', { description: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setUploading(false);
    }
  }, [image, isLoggedIn, selectedModel, scaleFactor, onQueueUpdate]);

  return (
    <div className="space-y-4">
      {/* Image Upload */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Icon icon="mdi:image-plus" className="size-4" />
          上传需要超分的图片
        </h3>

        <div className="flex gap-3 flex-wrap">
          {image ? (
            <div className="relative group">
              <img
                src={image.dataUrl}
                alt="Original"
                className="size-36 object-cover rounded-lg border border-border"
              />
              <button
                onClick={removeImage}
                className="absolute -top-2 -right-2 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 transition-colors"
                title="移除"
              >
                <Icon icon="mdi:close" className="size-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="size-36 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-primary/50 transition-colors text-muted-foreground"
            >
              <Icon icon="mdi:plus" className="size-8" />
              <span className="text-xs">选择图片</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Model Selection */}
      {/* 这块嵌在生图页的内层容器里，负边距对不准，改为保留左右内边距 */}
      <div className="space-y-3 p-3 border-y sm:border bg-card text-card-foreground">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Icon icon="mdi:cog-outline" className="size-4" />
          超分设置
        </h3>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">选择放大模型</p>
          <div className="flex gap-2 flex-wrap">
            {MODELS.map((model) => (
              <Button
                key={model}
                size="sm"
                variant={selectedModel === model ? 'default' : 'outline'}
                onClick={() => setSelectedModel(model)}
              >
                {model.replace('.pth', '')}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Submit */}
      <Button
        onClick={startGeneration}
        disabled={!isLoggedIn || uploading || !image}
        size="lg"
        className="w-full gap-2"
      >
        {uploading ? (
          <>
            <Spinner className="size-5" />
            上传处理中 {uploadProgress}%
          </>
        ) : (
          <>
            <Icon icon="mdi:auto-fix" className="size-5" />
            开始超分处理
            <span className="ml-1.5 inline-flex items-center text-[10px] px-1 bg-secondary text-secondary-foreground"><Icon icon="mdi:lightning-bolt" className="size-3" />{pointsCost}</span>
          </>
        )}
      </Button>
    </div>
  );
}
