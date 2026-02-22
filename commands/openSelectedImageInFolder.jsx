// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

export const config = {
  id: "openSelectedImageInFolder",
  i18n: {
    en: {
      "command.openSelectedImageInFolder.title": "Reveal Selected Image",
      "command.openSelectedImageInFolder.description": "Open selected image in system folder",
      "command.openSelectedImageInFolder.running": "Opening system folder...",
      "toast.command.openInFolder.noSelection": "Select one image first",
      "toast.command.openInFolder.unsupported": "Only local files can be opened in folder",
      "toast.command.openInFolder.failed": "Failed to open folder: {{error}}",
    },
    zh: {
      "command.openSelectedImageInFolder.title": "在文件夹中打开选中图片",
      "command.openSelectedImageInFolder.description": "在系统文件夹中定位当前选中图片",
      "command.openSelectedImageInFolder.running": "正在打开系统文件夹...",
      "toast.command.openInFolder.noSelection": "请先选中一张图片",
      "toast.command.openInFolder.unsupported": "仅支持本地文件路径",
      "toast.command.openInFolder.failed": "打开文件夹失败：{{error}}",
    },
  },
  titleKey: "command.openSelectedImageInFolder.title",
  title: "Reveal Selected Image",
  descriptionKey: "command.openSelectedImageInFolder.description",
  description: "Open selected image in system folder",
  keywords: ["open", "folder", "reveal", "image", "文件夹", "定位", "图片"],
};

const detectPlatform = () => {
  const raw = (navigator.platform || "").toLowerCase();
  if (raw.includes("mac")) return "mac";
  if (raw.includes("win")) return "win";
  if (raw.includes("linux")) return "linux";
  return "unknown";
};

const buildRevealCommand = (filePath, platform) => {
  if (platform === "mac") {
    return {
      command: "open",
      args: ["-R", filePath],
    };
  }
  if (platform === "win") {
    return {
      command: "explorer.exe",
      args: [`/select,${filePath.replace(/\//g, "\\")}`],
    };
  }
  if (platform === "linux") {
    return {
      command: "xdg-open",
      args: [filePath],
    };
  }
  return null;
};

const pickSelectedImagePath = (items) => {
  if (!Array.isArray(items)) return "";
  const selected = items.find(
    (item) => item && item.type === "image" && item.isSelected,
  );
  if (!selected || typeof selected.imagePath !== "string") return "";
  return selected.imagePath.trim();
};

let lastCommandRunAt = 0;

export const ui = ({ context }) => {
  const { React, hooks, actions, shell } = context;
  const { useEffect, useRef } = React;
  const { useEnvState, useT } = hooks;
  const { t } = useT();
  const { canvas: canvasSnap } = useEnvState();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const now = Date.now();
    // StrictMode 下会短时间重复挂载，避免同一次触发重复执行系统命令。
    if (now - lastCommandRunAt < 300) {
      actions.commandActions.close();
      return;
    }
    lastCommandRunAt = now;

    const openFolder = async () => {
      const selectedPath = pickSelectedImagePath(canvasSnap.canvasItems);
      if (!selectedPath) {
        actions.globalActions.pushToast(
          { key: "toast.command.openInFolder.noSelection" },
          "warning",
        );
        actions.commandActions.close();
        return;
      }
      if (actions.canvasActions.isRemoteImagePath(selectedPath)) {
        actions.globalActions.pushToast(
          { key: "toast.command.openInFolder.unsupported" },
          "warning",
        );
        actions.commandActions.close();
        return;
      }

      const resolvedPath = await actions.canvasActions.resolveLocalImagePath(
        selectedPath,
        canvasSnap.currentCanvasName,
      );
      const targetPath = resolvedPath;
      if (!targetPath) {
        actions.globalActions.pushToast(
          {
            key: "toast.command.openInFolder.failed",
            params: { error: "Invalid target path" },
          },
          "error",
        );
        actions.commandActions.close();
        return;
      }

      const platform = detectPlatform();
      const revealTargetPath =
        platform === "linux"
          ? actions.canvasActions.getPathDirname(targetPath)
          : targetPath;
      const command = buildRevealCommand(revealTargetPath, platform);
      if (!command) {
        actions.globalActions.pushToast(
          { key: "toast.command.openInFolder.unsupported" },
          "warning",
        );
        actions.commandActions.close();
        return;
      }

      try {
        const result = await shell(command);
        if (!result.success) {
          actions.globalActions.pushToast(
            {
              key: "toast.command.openInFolder.failed",
              params: { error: result.error || result.stderr || "Unknown error" },
            },
            "error",
          );
        }
      } catch (error) {
        actions.globalActions.pushToast(
          {
            key: "toast.command.openInFolder.failed",
            params: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
          "error",
        );
      }
      actions.commandActions.close();
    };

    void openFolder();
  }, [actions.commandActions, actions.globalActions, canvasSnap, shell]);

  return (
    <div className="px-4 py-6 text-sm text-neutral-300">
      {t("command.openSelectedImageInFolder.running")}
    </div>
  );
};
