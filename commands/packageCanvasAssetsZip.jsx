// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

const COMMAND_TIMEOUT_MS = 120000;
const WINDOWS_MISSING_MARKER = "__ERR_MISSING_ASSETS__";
const WINDOWS_EMPTY_MARKER = "__ERR_EMPTY_ASSETS__";

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const normalizePath = (value) => String(value || "").replace(/\\/g, "/");

const trimTrailingSeparators = (value) => value.replace(/[\\/]+$/, "");

const sanitizeCanvasNameForPath = (value) => {
  const safe = String(value || "").replace(/[/\\:*?"<>|]/g, "_").trim();
  return safe || "Default";
};

const formatTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const detectPlatform = () => {
  const raw = String(navigator.platform || "").toLowerCase();
  if (raw.includes("win")) return "win";
  if (raw.includes("mac")) return "mac";
  if (raw.includes("linux")) return "linux";
  return "unknown";
};

const toWindowsPath = (value) => normalizePath(value).replace(/\//g, "\\");

const escapePowerShellSingleQuoted = (value) => String(value).replace(/'/g, "''");

const getPathDirname = (value) => {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return normalized;
  return normalized.slice(0, index);
};

const getPathBasename = (value) => {
  const normalized = normalizePath(value);
  const parts = normalized.split("/");
  const name = parts[parts.length - 1];
  return name || "";
};

const sanitizeFileName = (value) => {
  const safe = String(value || "").replace(/[\\/]/g, "_").trim();
  return safe || "file.bin";
};

const joinPlatformPath = (base, child, platform) => {
  const root = trimTrailingSeparators(base);
  if (platform === "win") return `${root}\\${child}`;
  return `${root}/${child}`;
};

const buildPackagePaths = (storageDir, canvasName, platform) => {
  const safeCanvasName = sanitizeCanvasNameForPath(canvasName);
  const timestamp = formatTimestamp();

  if (platform === "win") {
    const base = trimTrailingSeparators(toWindowsPath(storageDir));
    const canvasDir = `${base}\\canvases\\${safeCanvasName}`;
    const assetsDir = `${canvasDir}\\assets`;
    const outputDir = `${base}\\exports\\canvas-assets`;
    const tempRootDir = `${outputDir}\\.tmp`;
    const stagingDir = `${tempRootDir}\\${safeCanvasName}_${timestamp}`;
    const stagingAssetsDir = `${stagingDir}\\assets`;
    const zipPath = `${outputDir}\\${safeCanvasName}_assets_${timestamp}.zip`;
    return {
      canvasDir,
      assetsDir,
      outputDir,
      tempRootDir,
      stagingDir,
      stagingAssetsDir,
      zipPath,
    };
  }

  const base = trimTrailingSeparators(normalizePath(storageDir));
  const canvasDir = `${base}/canvases/${safeCanvasName}`;
  const assetsDir = `${canvasDir}/assets`;
  const outputDir = `${base}/exports/canvas-assets`;
  const tempRootDir = `${outputDir}/.tmp`;
  const stagingDir = `${tempRootDir}/${safeCanvasName}_${timestamp}`;
  const stagingAssetsDir = `${stagingDir}/assets`;
  const zipPath = `${outputDir}/${safeCanvasName}_assets_${timestamp}.zip`;
  return {
    canvasDir,
    assetsDir,
    outputDir,
    tempRootDir,
    stagingDir,
    stagingAssetsDir,
    zipPath,
  };
};

const runShell = async (shell, payload) =>
  shell({
    timeoutMs: COMMAND_TIMEOUT_MS,
    ...payload,
  });

const ensureDir = async (shell, platform, dirPath) => {
  if (platform === "win") {
    const dir = escapePowerShellSingleQuoted(dirPath);
    const script = [
      "$ErrorActionPreference='Stop'",
      `$dir='${dir}'`,
      "if (!(Test-Path -LiteralPath $dir -PathType Container)) {",
      "  New-Item -ItemType Directory -Path $dir -Force | Out-Null",
      "}",
    ].join("; ");
    return runShell(shell, {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", script],
    });
  }

  return runShell(shell, {
    command: "mkdir",
    args: ["-p", dirPath],
  });
};

const removeFile = async (shell, platform, filePath) => {
  if (platform === "win") {
    const safePath = escapePowerShellSingleQuoted(filePath);
    const script = [
      "$ErrorActionPreference='Stop'",
      `$file='${safePath}'`,
      "if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }",
    ].join("; ");
    return runShell(shell, {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", script],
    });
  }

  return runShell(shell, {
    command: "rm",
    args: ["-f", filePath],
  });
};

const removeDir = async (shell, platform, dirPath) => {
  if (platform === "win") {
    const safePath = escapePowerShellSingleQuoted(dirPath);
    const script = [
      "$ErrorActionPreference='Stop'",
      `$dir='${safePath}'`,
      "if (Test-Path -LiteralPath $dir -PathType Container) {",
      "  Remove-Item -LiteralPath $dir -Recurse -Force",
      "}",
    ].join("; ");
    return runShell(shell, {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", script],
    });
  }

  return runShell(shell, {
    command: "rm",
    args: ["-rf", dirPath],
  });
};

const isFileExists = async (shell, platform, filePath) => {
  if (platform === "win") {
    const safePath = escapePowerShellSingleQuoted(filePath);
    const script = [
      `$file='${safePath}'`,
      "if (Test-Path -LiteralPath $file -PathType Leaf) { exit 0 }",
      "exit 1",
    ].join("; ");
    const result = await runShell(shell, {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", script],
    });
    return result.success;
  }

  const result = await runShell(shell, {
    command: "test",
    args: ["-f", filePath],
  });
  return result.success;
};

const copyFile = async (shell, platform, sourcePath, targetPath) => {
  if (platform === "win") {
    const safeSource = escapePowerShellSingleQuoted(sourcePath);
    const safeTarget = escapePowerShellSingleQuoted(targetPath);
    const script = [
      "$ErrorActionPreference='Stop'",
      `$source='${safeSource}'`,
      `$target='${safeTarget}'`,
      "Copy-Item -LiteralPath $source -Destination $target -Force",
    ].join("; ");
    return runShell(shell, {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", script],
    });
  }

  return runShell(shell, {
    command: "cp",
    args: [sourcePath, targetPath],
  });
};

const createZipOnUnix = async (shell, canvasDir, assetsDir, zipPath, platform) => {
  const hasAssetsDir = await runShell(shell, {
    command: "test",
    args: ["-d", assetsDir],
  });
  if (!hasAssetsDir.success) {
    return { success: false, reason: "missingAssets" };
  }

  const hasFiles = await runShell(shell, {
    command: "find",
    args: [assetsDir, "-type", "f", "-print", "-quit"],
  });
  if (!hasFiles.success) {
    return {
      success: false,
      reason: "failed",
      error: hasFiles.error || hasFiles.stderr || "find failed",
    };
  }
  if (!hasFiles.stdout.trim()) {
    return { success: false, reason: "emptyAssets" };
  }

  const removeExisting = await removeFile(shell, platform, zipPath);
  if (!removeExisting.success) {
    return {
      success: false,
      reason: "failed",
      error: removeExisting.error || removeExisting.stderr || "remove failed",
    };
  }

  const zipResult = await runShell(shell, {
    command: "zip",
    args: ["-r", "-q", zipPath, "assets"],
    cwd: canvasDir,
  });
  if (!zipResult.success) {
    return {
      success: false,
      reason: "failed",
      error: zipResult.error || zipResult.stderr || "zip failed",
    };
  }
  return { success: true };
};

const createZipOnWindows = async (shell, assetsDir, zipPath) => {
  const safeAssets = escapePowerShellSingleQuoted(assetsDir);
  const safeZip = escapePowerShellSingleQuoted(zipPath);
  // 用显式 marker 标记失败原因，避免依赖系统语言导致解析不稳定。
  const script = [
    "$ErrorActionPreference='Stop'",
    `$assetsDir='${safeAssets}'`,
    `$zipPath='${safeZip}'`,
    `if (!(Test-Path -LiteralPath $assetsDir -PathType Container)) { Write-Output '${WINDOWS_MISSING_MARKER}'; exit 2 }`,
    "$files = Get-ChildItem -LiteralPath $assetsDir -File -Recurse",
    `if ($null -eq $files -or $files.Count -eq 0) { Write-Output '${WINDOWS_EMPTY_MARKER}'; exit 3 }`,
    "if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }",
    "Compress-Archive -Path (Join-Path $assetsDir '*') -DestinationPath $zipPath -Force",
  ].join("; ");

  const result = await runShell(shell, {
    command: "powershell.exe",
    args: ["-NoProfile", "-Command", script],
  });
  if (result.success) {
    return { success: true };
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (output.includes(WINDOWS_MISSING_MARKER)) {
    return { success: false, reason: "missingAssets" };
  }
  if (output.includes(WINDOWS_EMPTY_MARKER)) {
    return { success: false, reason: "emptyAssets" };
  }
  return {
    success: false,
    reason: "failed",
    error: result.error || result.stderr || "Compress-Archive failed",
  };
};

const getSelectedImageItems = (canvasItems) =>
  Array.isArray(canvasItems)
    ? canvasItems.filter((item) => item && item.type === "image" && item.isSelected)
    : [];

const collectSelectedLocalFiles = async (
  context,
  selectedItems,
  canvasName,
  platform,
) => {
  const { actions, shell } = context;
  const files = [];
  const pathSet = new Set();
  let skippedCount = 0;

  for (const item of selectedItems) {
    const rawPath = String(item.imagePath || "").trim();
    if (!rawPath) {
      skippedCount += 1;
      continue;
    }
    if (actions.canvasActions.isRemoteImagePath(rawPath)) {
      skippedCount += 1;
      continue;
    }

    const resolved = await actions.canvasActions.resolveLocalImagePath(rawPath, canvasName);
    const normalized = platform === "win" ? toWindowsPath(resolved) : normalizePath(resolved);
    if (!isNonEmptyString(normalized)) {
      skippedCount += 1;
      continue;
    }

    const key = platform === "win" ? normalized.toLowerCase() : normalized;
    if (pathSet.has(key)) {
      continue;
    }

    const exists = await isFileExists(shell, platform, normalized);
    if (!exists) {
      skippedCount += 1;
      continue;
    }

    pathSet.add(key);
    files.push(normalized);
  }

  return { files, skippedCount };
};

const revealArchive = async (shell, platform, zipPath) => {
  if (platform === "win") {
    return runShell(shell, {
      command: "explorer.exe",
      args: [`/select,${zipPath}`],
    });
  }
  if (platform === "mac") {
    return runShell(shell, {
      command: "open",
      args: ["-R", zipPath],
    });
  }
  if (platform === "linux") {
    return runShell(shell, {
      command: "xdg-open",
      args: [getPathDirname(zipPath)],
    });
  }
  return {
    success: false,
    code: null,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    error: "Unsupported platform",
  };
};

const pushFailedToast = (actions, error) => {
  actions.globalActions.pushToast(
    {
      key: "toast.command.packageAssets.failed",
      params: {
        error: error || "Unknown error",
      },
    },
    "error",
  );
};

const packageAllAssets = async (context, platform, paths) => {
  const { actions, shell } = context;
  const prepareResult = await ensureDir(shell, platform, paths.outputDir);
  if (!prepareResult.success) {
    pushFailedToast(
      actions,
      prepareResult.error || prepareResult.stderr || "Failed to prepare output dir",
    );
    return;
  }

  const archiveResult =
    platform === "win"
      ? await createZipOnWindows(shell, paths.assetsDir, paths.zipPath)
      : await createZipOnUnix(shell, paths.canvasDir, paths.assetsDir, paths.zipPath, platform);

  if (!archiveResult.success) {
    if (archiveResult.reason === "missingAssets") {
      actions.globalActions.pushToast(
        { key: "toast.command.packageAssets.missingAssets" },
        "warning",
      );
      return;
    }
    if (archiveResult.reason === "emptyAssets") {
      actions.globalActions.pushToast(
        { key: "toast.command.packageAssets.emptyAssets" },
        "warning",
      );
      return;
    }
    pushFailedToast(actions, archiveResult.error);
    return;
  }

  const revealResult = await revealArchive(shell, platform, paths.zipPath);
  actions.globalActions.pushToast(
    {
      key: revealResult.success
        ? "toast.command.packageAssets.success"
        : "toast.command.packageAssets.successRevealFailed",
      params: { path: paths.zipPath },
    },
    revealResult.success ? "success" : "warning",
  );
};

const packageSelectedAssets = async (context, platform, paths, canvasName, selectedItems) => {
  const { actions, shell } = context;
  const selected = await collectSelectedLocalFiles(
    context,
    selectedItems,
    canvasName,
    platform,
  );

  if (selected.files.length === 0) {
    actions.globalActions.pushToast(
      { key: "toast.command.packageAssets.selectedNoPackable" },
      "warning",
    );
    return;
  }

  const prepareOutput = await ensureDir(shell, platform, paths.outputDir);
  if (!prepareOutput.success) {
    pushFailedToast(
      actions,
      prepareOutput.error || prepareOutput.stderr || "Failed to prepare output dir",
    );
    return;
  }

  const prepareTempRoot = await ensureDir(shell, platform, paths.tempRootDir);
  if (!prepareTempRoot.success) {
    pushFailedToast(
      actions,
      prepareTempRoot.error || prepareTempRoot.stderr || "Failed to prepare temp root dir",
    );
    return;
  }

  const prepareStaging = await ensureDir(shell, platform, paths.stagingAssetsDir);
  if (!prepareStaging.success) {
    pushFailedToast(
      actions,
      prepareStaging.error || prepareStaging.stderr || "Failed to prepare staging dir",
    );
    return;
  }

  let copiedCount = 0;
  try {
    for (let index = 0; index < selected.files.length; index += 1) {
      const sourcePath = selected.files[index];
      const sourceFileName = sanitizeFileName(getPathBasename(sourcePath));
      const archiveFileName = `${String(index + 1).padStart(3, "0")}_${sourceFileName}`;
      const targetPath = joinPlatformPath(paths.stagingAssetsDir, archiveFileName, platform);
      const copyResult = await copyFile(shell, platform, sourcePath, targetPath);
      if (copyResult.success) {
        copiedCount += 1;
      }
    }

    if (copiedCount === 0) {
      actions.globalActions.pushToast(
        { key: "toast.command.packageAssets.selectedNoPackable" },
        "warning",
      );
      return;
    }

    const archiveResult =
      platform === "win"
        ? await createZipOnWindows(shell, paths.stagingAssetsDir, paths.zipPath)
        : await createZipOnUnix(
            shell,
            paths.stagingDir,
            paths.stagingAssetsDir,
            paths.zipPath,
            platform,
          );

    if (!archiveResult.success) {
      pushFailedToast(actions, archiveResult.error);
      return;
    }

    const skippedCount = selected.skippedCount + (selected.files.length - copiedCount);
    const revealResult = await revealArchive(shell, platform, paths.zipPath);
    const hasSkipped = skippedCount > 0;
    const successKey = revealResult.success
      ? hasSkipped
        ? "toast.command.packageAssets.successSelectedWithSkipped"
        : "toast.command.packageAssets.successSelected"
      : hasSkipped
        ? "toast.command.packageAssets.successSelectedWithSkippedRevealFailed"
        : "toast.command.packageAssets.successSelectedRevealFailed";
    actions.globalActions.pushToast(
      {
        key: successKey,
        params: {
          count: copiedCount,
          skipped: skippedCount,
          path: paths.zipPath,
        },
      },
      revealResult.success && !hasSkipped ? "success" : "warning",
    );
  } finally {
    await removeDir(shell, platform, paths.stagingDir);
  }
};

const runPackage = async (context, canvasState) => {
  const { actions } = context;
  const storageDir = await window.electron?.getStorageDir?.();
  if (!isNonEmptyString(storageDir)) {
    actions.globalActions.pushToast(
      { key: "toast.command.packageAssets.noStorageDir" },
      "error",
    );
    return;
  }

  const platform = detectPlatform();
  if (platform !== "win" && platform !== "mac" && platform !== "linux") {
    actions.globalActions.pushToast(
      { key: "toast.command.packageAssets.unsupported" },
      "warning",
    );
    return;
  }

  const canvasName = canvasState.currentCanvasName;
  const selectedItems = getSelectedImageItems(canvasState.canvasItems);
  const paths = buildPackagePaths(storageDir, canvasName, platform);

  if (selectedItems.length > 0) {
    await packageSelectedAssets(context, platform, paths, canvasName, selectedItems);
    return;
  }

  await packageAllAssets(context, platform, paths);
};

let lastCommandRunAt = 0;

export const config = {
  id: "packageCanvasAssetsZip",
  i18n: {
    en: {
      "command.packageCanvasAssetsZip.title": "Package Canvas Assets",
      "command.packageCanvasAssetsZip.description":
        "Compress current canvas assets into a zip file",
      "command.packageCanvasAssetsZip.running": "Packaging assets...",
      "toast.command.packageAssets.noStorageDir": "Storage directory is unavailable",
      "toast.command.packageAssets.unsupported": "Current platform is not supported",
      "toast.command.packageAssets.missingAssets":
        "Assets directory does not exist for current canvas",
      "toast.command.packageAssets.emptyAssets":
        "Assets directory is empty, nothing to package",
      "toast.command.packageAssets.selectedNoPackable":
        "No packable local files in selected images",
      "toast.command.packageAssets.failed": "Packaging failed: {{error}}",
      "toast.command.packageAssets.success": "Assets packaged: {{path}}",
      "toast.command.packageAssets.successRevealFailed":
        "Assets packaged, but failed to reveal file: {{path}}",
      "toast.command.packageAssets.successSelected":
        "Packaged {{count}} selected images: {{path}}",
      "toast.command.packageAssets.successSelectedWithSkipped":
        "Packaged {{count}} selected images (skipped {{skipped}}): {{path}}",
      "toast.command.packageAssets.successSelectedRevealFailed":
        "Packaged {{count}} selected images, but failed to reveal file: {{path}}",
      "toast.command.packageAssets.successSelectedWithSkippedRevealFailed":
        "Packaged {{count}} selected images (skipped {{skipped}}), but failed to reveal file: {{path}}",
      "toast.command.packageAssets.selectedSkipped":
        "Skipped {{count}} selected images that are not local files",
      "toast.command.packageAssets.revealFailed":
        "Packaged, but failed to reveal file. Path: {{path}}",
    },
    zh: {
      "command.packageCanvasAssetsZip.title": "打包当前画布素材",
      "command.packageCanvasAssetsZip.description":
        "将当前画布素材压缩为 zip 文件",
      "command.packageCanvasAssetsZip.running": "素材打包中...",
      "toast.command.packageAssets.noStorageDir": "存储目录不可用",
      "toast.command.packageAssets.unsupported": "当前平台暂不支持该命令",
      "toast.command.packageAssets.missingAssets": "当前画布不存在 assets 素材目录",
      "toast.command.packageAssets.emptyAssets": "assets 素材目录为空，无需打包",
      "toast.command.packageAssets.selectedNoPackable":
        "当前选中图片没有可打包的本地文件",
      "toast.command.packageAssets.failed": "素材打包失败：{{error}}",
      "toast.command.packageAssets.success": "素材打包成功：{{path}}",
      "toast.command.packageAssets.successRevealFailed":
        "素材打包成功，但无法定位文件：{{path}}",
      "toast.command.packageAssets.successSelected":
        "已打包 {{count}} 张选中图片：{{path}}",
      "toast.command.packageAssets.successSelectedWithSkipped":
        "已打包 {{count}} 张选中图片（跳过 {{skipped}} 张）：{{path}}",
      "toast.command.packageAssets.successSelectedRevealFailed":
        "已打包 {{count}} 张选中图片，但无法定位文件：{{path}}",
      "toast.command.packageAssets.successSelectedWithSkippedRevealFailed":
        "已打包 {{count}} 张选中图片（跳过 {{skipped}} 张），但无法定位文件：{{path}}",
      "toast.command.packageAssets.selectedSkipped":
        "已跳过 {{count}} 张非本地选中图片",
      "toast.command.packageAssets.revealFailed":
        "已完成打包，但无法定位文件。路径：{{path}}",
    },
  },
  titleKey: "command.packageCanvasAssetsZip.title",
  title: "Package Canvas Assets",
  descriptionKey: "command.packageCanvasAssetsZip.description",
  description: "Compress current canvas assets into a zip file",
  keywords: ["package", "zip", "assets", "canvas", "素材", "打包", "压缩"],
};

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
    // StrictMode 会导致短时间重复挂载，避免同一次触发重复打包。
    if (now - lastCommandRunAt < 300) {
      actions.commandActions.close();
      return;
    }
    lastCommandRunAt = now;

    const start = async () => {
      try {
        await runPackage(
          {
            actions,
            shell,
          },
          canvasSnap,
        );
      } finally {
        actions.commandActions.close();
      }
    };

    void start();
  }, [actions, canvasSnap, shell]);

  return (
    <div className="px-4 py-6 text-sm text-neutral-300">
      {t("command.packageCanvasAssetsZip.running")}
    </div>
  );
};
