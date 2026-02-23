// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

const STORAGE_KEY = "command.screenshot.mode";

const getImageUrl = (imagePath, canvasName, apiBaseUrl) => {
  let normalized = imagePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (normalized.startsWith("assets/")) {
    const filename = normalized.split("/").pop() || normalized;
    const safeCanvas = encodeURIComponent(canvasName || "Default");
    const safeFile = encodeURIComponent(filename);
    return `${apiBaseUrl}/api/assets/${safeCanvas}/${safeFile}`;
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }
  return `${apiBaseUrl}/${normalized}`;
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });

// 将裁剪区域从图片中提取为 base64 png
const cropImage = (img, crop) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w));
  canvas.height = Math.max(1, Math.round(crop.h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return canvas.toDataURL("image/png");
};

const uploadScreenshot = async (dataUrl, filename, canvasName, apiBaseUrl) => {
  const res = await fetch(`${apiBaseUrl}/api/upload-temp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: dataUrl, filename, canvasName }),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
};

export const config = {
  id: "screenshot",
  i18n: {
    en: {
      "command.screenshot.title": "Clip Image",
      "command.screenshot.description": "Crop and save selected image",
      "command.screenshot.mode.overwrite": "Overwrite",
      "command.screenshot.mode.duplicate": "New Copy",
      "command.screenshot.preview.empty": "Select an image first",
      "command.screenshot.preview.loading": "Loading...",
      "command.screenshot.action.save": "Save",
      "command.screenshot.saving": "Saving...",
      "toast.command.screenshot.noSelection": "No image selected",
      "toast.command.screenshot.success.overwrite": "Image replaced",
      "toast.command.screenshot.success.duplicate": "New copy added",
      "toast.command.screenshot.failed": "Screenshot failed: {{error}}",
    },
    zh: {
      "command.screenshot.title": "裁剪图片",
      "command.screenshot.description": "裁剪并保存选中图片",
      "command.screenshot.mode.overwrite": "覆盖当前",
      "command.screenshot.mode.duplicate": "新建副本",
      "command.screenshot.preview.empty": "请先选中一张图片",
      "command.screenshot.preview.loading": "加载中...",
      "command.screenshot.action.save": "保存",
      "command.screenshot.saving": "保存中...",
      "toast.command.screenshot.noSelection": "未选中图片",
      "toast.command.screenshot.success.overwrite": "图片已替换",
      "toast.command.screenshot.success.duplicate": "已新建图片副本",
      "toast.command.screenshot.failed": "截图失败：{{error}}",
    },
  },
  titleKey: "command.screenshot.title",
  title: "Clip Image",
  descriptionKey: "command.screenshot.description",
  description: "Crop and save selected image",
  keywords: ["screenshot", "crop", "capture", "save", "截图", "裁剪", "保存"],
};

// ──────────────────────────────────────────────
// CropBox — 可拖拽调整的裁剪选框组件
// ──────────────────────────────────────────────
const HANDLE_SIZE = 8;
const MIN_CROP = 16;

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize",
  e: "ew-resize", se: "nwse-resize", s: "ns-resize",
  sw: "nesw-resize", w: "ew-resize", move: "move",
};

const makeCropBox = ({ React }) => {
  const { useRef, useState, useLayoutEffect, useEffect } = React;

  return ({ imageW, imageH, crop, onChange, containerRef }) => {
    // crop: { x, y, w, h } 单位为图片像素
    const dragRef = useRef(null);

    // useLayoutEffect 同步测量，确保首帧 scale 就是正确值，避免 rezise 前出现大框
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const measure = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [containerRef]);

    // 图片在容器内的显示参数（object-contain）
    const getScale = () => {
      const { w: cw, h: ch } = containerSize;
      if (!cw || !ch || !imageW || !imageH) return { scale: 1, offX: 0, offY: 0 };
      const scale = Math.min(cw / imageW, ch / imageH);
      const dispW = imageW * scale;
      const dispH = imageH * scale;
      return { scale, offX: (cw - dispW) / 2, offY: (ch - dispH) / 2 };
    };

    // 把图片像素坐标转换为容器内 px
    const toDisp = (v, scale) => v * scale;
    const toPx = (v, scale) => v / scale;

    const onMouseDown = (e, type) => {
      e.preventDefault();
      e.stopPropagation();
      const { scale, offX, offY } = getScale();
      dragRef.current = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCrop: { ...crop },
        scale,
        offX,
        offY,
      };
    };

    useEffect(() => {
      const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = toPx(e.clientX - d.startX, d.scale);
        const dy = toPx(e.clientY - d.startY, d.scale);
        const sc = d.startCrop;

        let { x, y, w, h } = sc;

        if (d.type === "move") {
          x = Math.max(0, Math.min(imageW - w, sc.x + dx));
          y = Math.max(0, Math.min(imageH - h, sc.y + dy));
        } else {
          if (d.type.includes("e")) {
            w = Math.max(MIN_CROP, Math.min(imageW - sc.x, sc.w + dx));
          }
          if (d.type.includes("s")) {
            h = Math.max(MIN_CROP, Math.min(imageH - sc.y, sc.h + dy));
          }
          if (d.type.includes("w")) {
            const newW = Math.max(MIN_CROP, sc.w - dx);
            if (newW !== sc.w) {
              x = Math.max(0, sc.x + sc.w - newW);
              w = sc.w + sc.x - x;
            }
          }
          if (d.type.includes("n")) {
            const newH = Math.max(MIN_CROP, sc.h - dy);
            if (newH !== sc.h) {
              y = Math.max(0, sc.y + sc.h - newH);
              h = sc.h + sc.y - y;
            }
          }
        }

        onChange({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      };

      const onUp = () => { dragRef.current = null; };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }, [imageW, imageH, onChange]);

    const { scale, offX, offY } = getScale();
    const dispX = offX + toDisp(crop.x, scale);
    const dispY = offY + toDisp(crop.y, scale);
    const dispW = toDisp(crop.w, scale);
    const dispH = toDisp(crop.h, scale);

    const handlePos = (dir) => {
      const hx = dir.includes("e") ? dispW : dir.includes("w") ? 0 : dispW / 2;
      const hy = dir.includes("s") ? dispH : dir.includes("n") ? 0 : dispH / 2;
      return { left: hx - HANDLE_SIZE / 2, top: hy - HANDLE_SIZE / 2 };
    };

    return (
      <div
        style={{
          position: "absolute",
          left: dispX,
          top: dispY,
          width: dispW,
          height: dispH,
          boxSizing: "border-box",
          border: "1.5px solid rgba(255,255,255,0.9)",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          cursor: CURSORS.move,
          userSelect: "none",
        }}
        onMouseDown={(e) => onMouseDown(e, "move")}
      >
        {/* 三等分辅助线 */}
        {[1, 2].map((i) => (
          <div key={`v${i}`} style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${(i / 3) * 100}%`, width: 1,
            background: "rgba(255,255,255,0.2)", pointerEvents: "none",
          }} />
        ))}
        {[1, 2].map((i) => (
          <div key={`h${i}`} style={{
            position: "absolute", left: 0, right: 0,
            top: `${(i / 3) * 100}%`, height: 1,
            background: "rgba(255,255,255,0.2)", pointerEvents: "none",
          }} />
        ))}

        {/* 8 方向手柄 */}
        {HANDLES.map((dir) => {
          const pos = handlePos(dir);
          return (
            <div
              key={dir}
              style={{
                position: "absolute",
                ...pos,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "#fff",
                border: "1.5px solid rgba(0,0,0,0.4)",
                borderRadius: 2,
                cursor: CURSORS[dir],
              }}
              onMouseDown={(e) => onMouseDown(e, dir)}
            />
          );
        })}
      </div>
    );
  };
};

// ──────────────────────────────────────────────
// ui 主组件
// ──────────────────────────────────────────────
export const ui = ({ context }) => {
  const { React, hooks, actions, config: appConfig } = context;
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const { useEnvState, useT } = hooks;
  const { t } = useT();
  const { canvas: canvasSnap } = useEnvState();
  const API_BASE_URL = appConfig?.API_BASE_URL || "";

  // 多选取第一张
  const targetItem = useMemo(() => {
    const selected = canvasSnap.canvasItems.filter(
      (item) => item.type === "image" && item.isSelected
    );
    return selected[0] ?? null;
  }, [canvasSnap.canvasItems]);

  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || "overwrite"; }
    catch { return "overwrite"; }
  });

  // 图片原始尺寸
  const [imageSize, setImageSize] = useState(null);
  const [imgEl, setImgEl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 裁剪区域（图片像素坐标系）
  const [crop, setCrop] = useState(null);

  const containerRef = useRef(null);
  const CropBox = useMemo(() => makeCropBox({ React }), []);

  // 加载目标图片
  useEffect(() => {
    if (!targetItem) {
      setImageSize(null);
      setImgEl(null);
      setCrop(null);
      return;
    }
    setLoading(true);
    const url = getImageUrl(targetItem.imagePath, canvasSnap.currentCanvasName, API_BASE_URL);
    loadImage(url).then((img) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      setImageSize({ w, h });
      setImgEl(img);
      // 默认选框：图片中央 80%，让用户直观感受到选框可调整
      const margin = 0.1;
      setCrop({
        x: Math.round(w * margin),
        y: Math.round(h * margin),
        w: Math.round(w * (1 - margin * 2)),
        h: Math.round(h * (1 - margin * 2)),
      });
      setLoading(false);
    }).catch(() => {
      setImageSize(null);
      setImgEl(null);
      setCrop(null);
      setLoading(false);
    });
  }, [
    targetItem?.itemId,
    targetItem?.imagePath,
    canvasSnap.currentCanvasName,
    API_BASE_URL,
  ]);

  const handleModeChange = (value) => {
    setMode(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
  };

  const handleSave = async () => {
    if (!targetItem || !imgEl || !crop) {
      actions.globalActions.pushToast(
        { key: "toast.command.screenshot.noSelection" }, "warning"
      );
      return;
    }

    setSaving(true);
    try {
      const dataUrl = cropImage(imgEl, crop);
      const timestamp = Date.now();
      const filename = `screenshot_${timestamp}.png`;
      const uploaded = await uploadScreenshot(
        dataUrl, filename, canvasSnap.currentCanvasName, API_BASE_URL
      );

      if (mode === "overwrite") {
        // 覆盖：更新原图的路径与尺寸
        actions.canvasActions.updateCanvasImage(targetItem.itemId, {
          imagePath: uploaded.path,
          width: uploaded.width || crop.w,
          height: uploaded.height || crop.h,
          dominantColor: uploaded.dominantColor ?? targetItem.dominantColor,
          tone: uploaded.tone ?? targetItem.tone,
        });
        actions.globalActions.pushToast(
          { key: "toast.command.screenshot.success.overwrite" }, "success"
        );
      } else {
        // 新建副本：在原图旁边添加
        actions.canvasActions.addToCanvas({
          type: "image",
          id: `temp_screenshot_${timestamp}`,
          filename: `screenshot_${timestamp}`,
          imagePath: uploaded.path,
          pageUrl: null,
          tags: [],
          createdAt: timestamp,
          dominantColor: uploaded.dominantColor ?? null,
          tone: uploaded.tone ?? null,
          hasVector: false,
          width: uploaded.width || crop.w,
          height: uploaded.height || crop.h,
          grayscale: false,
          flipX: false,
          flipY: false,
        }, targetItem.x + 20, targetItem.y + 20);
        actions.globalActions.pushToast(
          { key: "toast.command.screenshot.success.duplicate" }, "success"
        );
      }

      actions.commandActions.close();
    } catch (error) {
      actions.globalActions.pushToast(
        {
          key: "toast.command.screenshot.failed",
          params: { error: error instanceof Error ? error.message : String(error) },
        },
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const imageUrl = targetItem
    ? getImageUrl(targetItem.imagePath, canvasSnap.currentCanvasName, API_BASE_URL)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* 预览 + 裁剪选框 */}
      <div
        ref={containerRef}
        className="relative flex items-center justify-center bg-neutral-900/60 border-b border-neutral-800 overflow-hidden select-none"
        style={{ height: 400 }}
      >
        {loading && (
          <span className="text-xs text-neutral-400">
            {t("command.screenshot.preview.loading")}
          </span>
        )}
        {!loading && !imageUrl && (
          <span className="text-xs text-neutral-500">
            {t("command.screenshot.preview.empty")}
          </span>
        )}
        {!loading && imageUrl && (
          <>
            <img
              src={imageUrl}
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              draggable={false}
            />
            {crop && imageSize && (
              <CropBox
                imageW={imageSize.w}
                imageH={imageSize.h}
                crop={crop}
                onChange={setCrop}
                containerRef={containerRef}
              />
            )}
          </>
        )}
      </div>

      {/* 裁剪尺寸信息 */}
      {crop && (
        <div className="px-4 py-2 text-[11px] text-neutral-500 font-mono border-b border-neutral-800/50">
          {crop.w} × {crop.h} px
        </div>
      )}

      {/* 模式选择 */}
      <div className="flex gap-2 p-4 pb-3">
        {["overwrite", "duplicate"].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleModeChange(m)}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all border ${
              mode === m
                ? "bg-primary/15 border-primary/50 text-primary"
                : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {t(`command.screenshot.mode.${m}`)}
          </button>
        ))}
      </div>

      {/* 保存按钮 */}
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={!targetItem || !crop || saving || loading}
          className={`w-full py-2.5 rounded-lg text-xs font-medium transition-all ${
            !targetItem || !crop || saving || loading
              ? "bg-neutral-900 text-neutral-500 cursor-not-allowed"
              : "bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 hover:-translate-y-0.5 active:translate-y-0"
          }`}
        >
          {saving
            ? t("command.screenshot.saving")
            : t("command.screenshot.action.save")}
        </button>
      </div>
    </div>
  );
};
