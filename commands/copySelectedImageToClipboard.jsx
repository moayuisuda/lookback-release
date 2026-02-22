export const config = {
  id: "copySelectedImageToClipboard",
  title: "Copy Image",
  titleKey: "command.copyImage.title",
  description: "Copy selected image to clipboard",
  descriptionKey: "command.copyImage.description",
  keywords: ["copy", "image", "clipboard", "复制", "剪贴板", "图片"],
  i18n: {
    en: {
      "command.copyImage.title": "Copy Image",
      "command.copyImage.description": "Copy selected image to clipboard",
      "toast.command.copyImage.success": "Image copied to clipboard",
      "toast.command.copyImage.noSelection": "No image selected",
      "toast.command.copyImage.failed": "Failed to copy image: {{error}}",
      "toast.command.copyImage.copying": "Copying image...",
    },
    zh: {
      "command.copyImage.title": "复制图片",
      "command.copyImage.description": "复制选中图片到剪贴板",
      "toast.command.copyImage.success": "图片已复制到剪贴板",
      "toast.command.copyImage.noSelection": "未选中图片",
      "toast.command.copyImage.failed": "复制图片失败：{{error}}",
      "toast.command.copyImage.copying": "正在复制图片...",
    },
  },
};

const resolveImageUrl = (imagePath, canvasName, apiBaseUrl) => {
  let normalized = String(imagePath).replace(/\\/g, "/");
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
  // Assume relative path to server root if not assets/
  return `${apiBaseUrl}/${normalized}`;
};

const pickSelectedImage = (items) => {
  if (!Array.isArray(items)) return null;
  return items.find((item) => item && item.type === "image" && item.isSelected);
};

const convertToPng = (blob) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error("Canvas toBlob failed"));
        }
      }, "image/png");
    };
    img.onerror = (e) => reject(new Error("Image load failed"));
    img.src = URL.createObjectURL(blob);
  });
};

export const ui = ({ context }) => {
  const { React, hooks, actions, config: appConfig } = context;
  const { useEffect, useRef } = React;
  const { useEnvState, useT } = hooks;
  const { t } = useT();
  const { canvas: canvasSnap } = useEnvState();
  const processingRef = useRef(false);

  useEffect(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const copyToClipboard = async () => {
      try {
        const selected = pickSelectedImage(canvasSnap.canvasItems);

        if (!selected) {
          actions.globalActions.pushToast(
            { key: "toast.command.copyImage.noSelection" },
            "warning"
          );
          actions.commandActions.close();
          return;
        }

        const url = resolveImageUrl(
          selected.imagePath,
          canvasSnap.currentCanvasName,
          appConfig.API_BASE_URL
        );

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        let blob = await response.blob();
        let item;

        // Try writing original format first (in case browser supports it, e.g. future JPEG/GIF support)
        // If it fails, fallback to PNG conversion
        try {
          // ClipboardItem constructor throws if type is not supported
          item = new ClipboardItem({ [blob.type]: blob });
          await navigator.clipboard.write([item]);
        } catch (err) {
          // Fallback to PNG if original format is not supported
          if (blob.type !== "image/png") {
            try {
               const pngBlob = await convertToPng(blob);
               item = new ClipboardItem({ "image/png": pngBlob });
               await navigator.clipboard.write([item]);
            } catch (convertErr) {
               // If conversion also fails, throw original error
               console.error("PNG conversion failed", convertErr);
               throw err;
            }
          } else {
             throw err;
          }
        }

        actions.globalActions.pushToast(
          { key: "toast.command.copyImage.success" },
          "success"
        );
      } catch (error) {
        console.error("Copy failed", error);
        actions.globalActions.pushToast(
          { 
            key: "toast.command.copyImage.failed",
            params: { error: error instanceof Error ? error.message : String(error) }
          },
          "error"
        );
      } finally {
        actions.commandActions.close();
      }
    };

    void copyToClipboard();
  }, [actions.commandActions, actions.globalActions, canvasSnap, appConfig.API_BASE_URL]);

  return (
    <div className="px-4 py-2 text-sm text-neutral-300">
      {t("toast.command.copyImage.copying")}
    </div>
  );
};
