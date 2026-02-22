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

const buildPackagePaths = (storageDir, canvasName, platform) => {
  const safeCanvasName = sanitizeCanvasNameForPath(canvasName);
  const timestamp = formatTimestamp();

  if (platform === "win") {
    const base = trimTrailingSeparators(toWindowsPath(storageDir));
    const canvasDir = `${base}\\canvases\\${safeCanvasName}`;
    const assetsDir = `${canvasDir}\\assets`;
    const outputDir = `${base}\\exports\\canvas-assets`;
    const zipPath = `${outputDir}\\${safeCanvasName}_assets_${timestamp}.zip`;
    return {
      canvasDir,
      assetsDir,
      outputDir,
      zipPath,
    };
  }

  const base = trimTrailingSeparators(normalizePath(storageDir));
  const canvasDir = `${base}/canvases/${safeCanvasName}`;
  const assetsDir = `${canvasDir}/assets`;
  const outputDir = `${base}/exports/canvas-assets`;
  const zipPath = `${outputDir}/${safeCanvasName}_assets_${timestamp}.zip`;
  return {
    canvasDir,
    assetsDir,
    outputDir,
    zipPath,
  };
};

const runShell = async (shell, payload) =>
  shell({
    timeoutMs: COMMAND_TIMEOUT_MS,
    ...payload,
  });

const ensureOutputDir = async (shell, platform, outputDir) => {
  if (platform === "win") {
    const dir = escapePowerShellSingleQuoted(outputDir);
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
    args: ["-p", outputDir],
  });
};

const createZipOnUnix = async (shell, canvasDir, assetsDir, zipPath) => {
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

  const removeExisting = await runShell(shell, {
    command: "rm",
    args: ["-f", zipPath],
  });
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

const runPackage = async (context, canvasName) => {
  const { actions, shell } = context;
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

  const paths = buildPackagePaths(storageDir, canvasName, platform);
  const prepareResult = await ensureOutputDir(shell, platform, paths.outputDir);
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
      : await createZipOnUnix(shell, paths.canvasDir, paths.assetsDir, paths.zipPath);

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

  actions.globalActions.pushToast(
    {
      key: "toast.command.packageAssets.success",
      params: { path: paths.zipPath },
    },
    "success",
  );

  const revealResult = await revealArchive(shell, platform, paths.zipPath);
  if (!revealResult.success) {
    actions.globalActions.pushToast(
      {
        key: "toast.command.packageAssets.revealFailed",
        params: {
          path: paths.zipPath,
        },
      },
      "warning",
    );
  }
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
      "toast.command.packageAssets.failed": "Packaging failed: {{error}}",
      "toast.command.packageAssets.success": "Assets packaged: {{path}}",
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
      "toast.command.packageAssets.failed": "素材打包失败：{{error}}",
      "toast.command.packageAssets.success": "素材打包成功：{{path}}",
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
          canvasSnap.currentCanvasName,
        );
      } finally {
        actions.commandActions.close();
      }
    };

    void start();
  }, [actions, canvasSnap.currentCanvasName, shell]);

  return (
    <div className="px-4 py-6 text-sm text-neutral-300">
      {t("command.packageCanvasAssetsZip.running")}
    </div>
  );
};
