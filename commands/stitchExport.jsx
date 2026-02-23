// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

const getImageUrl = (imagePath, canvasName, apiBaseUrl) => {
  let normalized = imagePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  if (normalized.startsWith("assets/")) {
    const filename = normalized.split("/").pop() || normalized;
    const safeCanvasName = encodeURIComponent(canvasName || "Default");
    const safeFilename = encodeURIComponent(filename);
    return `${apiBaseUrl}/api/assets/${safeCanvasName}/${safeFilename}`;
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

const clampPositive = (value) =>
  Number.isFinite(value) && value > 0 ? value : 0;

const getRenderBbox = (width, height, rotationDeg) => {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const hw = width / 2;
  const hh = height / 2;

  // Corners relative to center
  const x1 = -hw * cos - -hh * sin;
  const y1 = -hw * sin + -hh * cos;

  const x2 = hw * cos - -hh * sin;
  const y2 = hw * sin + -hh * cos;

  const x3 = hw * cos - hh * sin;
  const y3 = hw * sin + hh * cos;

  const x4 = -hw * cos - hh * sin;
  const y4 = -hw * sin + hh * cos;

  const xs = [x1, x2, x3, x4];
  const ys = [y1, y2, y3, y4];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    width: maxX - minX,
    height: maxY - minY,
    offsetX: minX,
    offsetY: minY,
  };
};

const buildExportBounds = (items) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  items.forEach((item) => {
    const baseScale = item.scale ?? 1;
    const rawW =
      clampPositive(item.width) * baseScale;
    const rawH =
      clampPositive(item.height) * baseScale;
    if (!rawW || !rawH) return;
    const bbox = getRenderBbox(rawW, rawH, item.rotation ?? 0);
    minX = Math.min(minX, item.x + bbox.offsetX);
    minY = Math.min(minY, item.y + bbox.offsetY);
    maxX = Math.max(maxX, item.x + bbox.offsetX + bbox.width);
    maxY = Math.max(maxY, item.y + bbox.offsetY + bbox.height);
  });

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const trimTransparentEdges = (canvasEl) => {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return canvasEl;

  try {
    const { width, height } = canvasEl;
    const imageData = ctx.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    // 扫描非透明像素，计算最小包围盒，消除导出空边
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = imageData[(y * width + x) * 4 + 3];
        if (alpha === 0) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return canvasEl;

    const trimWidth = maxX - minX + 1;
    const trimHeight = maxY - minY + 1;
    if (trimWidth === width && trimHeight === height && minX === 0 && minY === 0) {
      return canvasEl;
    }

    const trimmed = document.createElement("canvas");
    trimmed.width = trimWidth;
    trimmed.height = trimHeight;
    const trimmedCtx = trimmed.getContext("2d");
    if (!trimmedCtx) return canvasEl;
    trimmedCtx.drawImage(
      canvasEl,
      minX,
      minY,
      trimWidth,
      trimHeight,
      0,
      0,
      trimWidth,
      trimHeight,
    );
    return trimmed;
  } catch {
    // 跨域图像会导致画布污染，此时保留原始画布避免流程中断
    return canvasEl;
  }
};

const applyBackground = (canvasEl, background) => {
  const output = document.createElement("canvas");
  output.width = canvasEl.width;
  output.height = canvasEl.height;
  const ctx = output.getContext("2d");
  if (!ctx) return canvasEl;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvasEl, 0, 0);
  return output;
};

const generateStitchPreview = async (context, canvasState, options = {}) => {
  const {
    config: { API_BASE_URL },
  } = context;

  const { background = "#ffffff", transparent = false } = options;

  const selectedItems = canvasState.canvasItems.filter(
    (item) => item.isSelected && item.type === "image",
  );

  if (selectedItems.length === 0) return null;

  const bounds = buildExportBounds(selectedItems);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  // Limit preview size to avoid performance issues
  const MAX_PREVIEW_SIZE = 800;
  const scale = Math.min(
    1,
    MAX_PREVIEW_SIZE / Math.max(bounds.width, bounds.height),
  );

  const exportWidth = Math.max(1, Math.ceil(bounds.width * scale));
  const exportHeight = Math.max(1, Math.ceil(bounds.height * scale));

  const canvasEl = document.createElement("canvas");
  canvasEl.width = exportWidth;
  canvasEl.height = exportHeight;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return null;

  ctx.scale(scale, scale);

  const orderedItems = selectedItems;

  const loadedImages = await Promise.all(
    orderedItems.map(async (item) => {
      const url = getImageUrl(
        item.imagePath,
        canvasState.currentCanvasName,
        API_BASE_URL,
      );
      try {
        const img = await loadImage(url);
        return { item, img };
      } catch (e) {
        return null;
      }
    }),
  );

  loadedImages.forEach((data) => {
    if (!data) return;
    const { item, img } = data;
    const baseScale = item.scale ?? 1;
    const flipX = item.flipX === true;
    const rotation = (item.rotation ?? 0) * (Math.PI / 180);
    const drawX = item.x - bounds.x;
    const drawY = item.y - bounds.y;
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(rotation);
    ctx.scale(baseScale * (flipX ? -1 : 1), baseScale);
    ctx.drawImage(
      img,
      -item.width / 2,
      -item.height / 2,
      item.width,
      item.height,
    );
    ctx.restore();
  });

  const trimmedCanvas = trimTransparentEdges(canvasEl);
  const outputCanvas = transparent
    ? trimmedCanvas
    : applyBackground(trimmedCanvas, background);
  return outputCanvas.toDataURL("image/png");
};

const exportStitchedImage = async (context, canvasState, options = {}) => {
  const {
    actions: { globalActions },
    config: { API_BASE_URL },
    electron,
  } = context;

  const { background = "#ffffff", transparent = false } = options;

  const selectedItems = canvasState.canvasItems.filter(
    (item) => item.isSelected && item.type === "image",
  );

  if (selectedItems.length === 0) {
    globalActions.pushToast(
      { key: "toast.command.exportNoSelection" },
      "warning",
    );
    return;
  }

  try {
    const bounds = buildExportBounds(selectedItems);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      globalActions.pushToast({ key: "toast.command.exportFailed" }, "error");
      return;
    }

    const exportWidth = Math.max(1, Math.ceil(bounds.width));
    const exportHeight = Math.max(1, Math.ceil(bounds.height));
    const canvasEl = document.createElement("canvas");
    canvasEl.width = exportWidth;
    canvasEl.height = exportHeight;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) {
      globalActions.pushToast({ key: "toast.command.exportFailed" }, "error");
      return;
    }

    const orderedItems = selectedItems;

    const loadedImages = await Promise.all(
      orderedItems.map(async (item) => {
        const url = getImageUrl(
          item.imagePath,
          canvasState.currentCanvasName,
          API_BASE_URL,
        );
        const img = await loadImage(url);
        return { item, img };
      }),
    );

    loadedImages.forEach(({ item, img }) => {
      const scale = item.scale ?? 1;
      const flipX = item.flipX === true;
      const rotation = (item.rotation ?? 0) * (Math.PI / 180);
      const drawX = item.x - bounds.x;
      const drawY = item.y - bounds.y;
      ctx.save();
      ctx.translate(drawX, drawY);
      ctx.rotate(rotation);
      ctx.scale(scale * (flipX ? -1 : 1), scale);
      ctx.drawImage(
        img,
        -item.width / 2,
        -item.height / 2,
        item.width,
        item.height,
      );
      ctx.restore();
    });

    const trimmedCanvas = trimTransparentEdges(canvasEl);
    const outputCanvas = transparent
      ? trimmedCanvas
      : applyBackground(trimmedCanvas, background);
    const imageBase64 = outputCanvas.toDataURL("image/png");
    const filename = `stitched_${Date.now()}.png`;

    if (electron?.saveImageFile) {
      const result = await electron.saveImageFile(imageBase64, filename);
      if (result?.canceled) {
        return;
      }
      if (!result?.success) {
        globalActions.pushToast({ key: "toast.command.exportFailed" }, "error");
        return;
      }
      globalActions.pushToast({ key: "toast.command.exportSaved" }, "success");
      return;
    }

    const link = document.createElement("a");
    link.href = imageBase64;
    link.download = filename;
    link.click();
    globalActions.pushToast({ key: "toast.command.exportSaved" }, "success");
  } catch (error) {
    void error;
    globalActions.pushToast({ key: "toast.command.exportFailed" }, "error");
  }
};

export const config = {
  id: "stitchExport",
  i18n: {
    en: {
      "command.stitchExport.title": "Stitch Export",
      "command.stitchExport.description":
        "Export selected images as a stitched image",
      "command.stitchExport.preview.loading": "Loading preview...",
      "command.stitchExport.preview.empty": "No images selected",
      "command.stitchExport.transparent": "Transparent",
      "command.stitchExport.action.export": "Export Stitch",
    },
    zh: {
      "command.stitchExport.title": "拼接导出",
      "command.stitchExport.description": "将选中图片拼接并导出",
      "command.stitchExport.preview.loading": "预览生成中...",
      "command.stitchExport.preview.empty": "未选择图片",
      "command.stitchExport.transparent": "透明背景",
      "command.stitchExport.action.export": "导出拼接图",
    },
  },
  titleKey: "command.stitchExport.title",
  title: "Stitch Export",
  descriptionKey: "command.stitchExport.description",
  description: "Export selected images as a stitched image",
  keywords: ["export", "stitch", "image", "combine"],
};

export const ui = ({ context }) => {
  const { React, actions, hooks } = context;
  const { useState, useEffect } = React;
  const { useT } = hooks;
  const { t } = useT();
  const { useEnvState } = hooks;
  const { canvas: canvasSnap } = useEnvState();

  const [background, setBackground] = useState("#ffffff");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [previewBackground, setPreviewBackground] = useState(background);

  const handleExport = async () => {
    await exportStitchedImage(context, canvasSnap, { background, transparent });
    actions.commandActions.close();
  };

  useEffect(() => {
    const handle = setTimeout(() => {
      setPreviewBackground(background);
    }, 300);
    return () => clearTimeout(handle);
  }, [background]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    generateStitchPreview(context, canvasSnap, {
      background: previewBackground,
      transparent,
    }).then((url) => {
      if (active) {
        setPreviewUrl(url);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [previewBackground, transparent, context, canvasSnap]);

  return (
    <div className="flex flex-col h-full">
      {/* Preview Area */}
      <div className="h-96 flex items-center justify-center bg-neutral-900/50 p-4 border-b border-neutral-800 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <span className="text-xs text-neutral-400">
              {t("command.stitchExport.preview.loading")}
            </span>
          </div>
        )}
        {previewUrl ? (
          <img
            src={previewUrl}
            className="h-full object-contain shadow-lg"
          />
        ) : (
          <span className="text-xs text-neutral-500">
            {t("command.stitchExport.preview.empty")}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 p-4 text-xs text-neutral-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-neutral-400">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
                className="h-3.5 w-3.5 rounded border border-neutral-700 bg-neutral-900"
              />
              <span>{t("command.stitchExport.transparent")}</span>
            </label>
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              disabled={transparent}
              className={`h-6 w-8 rounded border bg-neutral-900 ${
                transparent
                  ? "border-neutral-800 opacity-40 cursor-not-allowed"
                  : "border-neutral-700"
              }`}
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-white transition-colors"
          >
            {t("command.stitchExport.action.export")}
          </button>
        </div>
      </div>
    </div>
  );
};
