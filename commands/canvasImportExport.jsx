// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

export const config = {
  id: "canvasImportExport",
  i18n: {
    en: {
      "Canvas Import/Export": "Canvas Import/Export",
      "Import and export canvas data (.lb files)":
        "Import and export canvas data (.lb files)",
      "command.canvasImportExport.tab.export": "Export",
      "command.canvasImportExport.tab.import": "Import",
      "command.canvasImportExport.export.tip": "Select canvases to export",
      "command.canvasImportExport.export.selectAll": "Select All",
      "command.canvasImportExport.export.deselectAll": "Deselect All",
      "command.canvasImportExport.import.title": "Drop or select .lb files",
      "command.canvasImportExport.import.subtitle":
        "Import will add canvases without overwriting existing names.",
      "command.canvasImportExport.import.selectFiles": "Select Files",
      "command.canvasImportExport.status.exporting": "Exporting...",
      "command.canvasImportExport.status.exported":
        "Exported {{current}}/{{total}}",
      "command.canvasImportExport.status.importing": "Importing...",
      "command.canvasImportExport.status.imported":
        "Imported {{current}}/{{total}}",
      "command.canvasImportExport.status.listFailed": "Failed to load canvases",
      "command.canvasImportExport.action.export": "Export ({{count}})",
      "toast.command.canvasExportSaved": "Canvases exported",
      "toast.command.exportPartial": "Some canvases failed to export",
      "toast.command.importSaved": "Imported {{count}} canvases",
    },
    zh: {
      "Canvas Import/Export": "画布导入导出",
      "Import and export canvas data (.lb files)":
        "导入导出画布数据 (.lb 文件)",
      "command.canvasImportExport.tab.export": "导出",
      "command.canvasImportExport.tab.import": "导入",
      "command.canvasImportExport.export.tip": "选择要导出的画布",
      "command.canvasImportExport.export.selectAll": "全选",
      "command.canvasImportExport.export.deselectAll": "取消全选",
      "command.canvasImportExport.import.title": "拖拽或选择 .lb 文件",
      "command.canvasImportExport.import.subtitle":
        "导入将新增画布，不会覆盖已有名称。",
      "command.canvasImportExport.import.selectFiles": "选择文件",
      "command.canvasImportExport.status.exporting": "导出中...",
      "command.canvasImportExport.status.exported":
        "已导出 {{current}}/{{total}}",
      "command.canvasImportExport.status.importing": "导入中...",
      "command.canvasImportExport.status.imported":
        "已导入 {{current}}/{{total}}",
      "command.canvasImportExport.status.listFailed": "获取画布列表失败",
      "command.canvasImportExport.action.export": "导出 ({{count}})",
      "toast.command.canvasExportSaved": "画布导出成功",
      "toast.command.exportPartial": "部分画布导出失败",
      "toast.command.importSaved": "已导入 {{count}} 个画布",
    },
  },
  titleKey: "Canvas Import/Export",
  title: "Canvas Import/Export",
  descriptionKey: "Import and export canvas data (.lb files)",
  description: "Import and export canvas data (.lb files)",
  keywords: ["import", "export", "canvas", "backup"],
};

const getAllCanvases = async (apiBaseUrl) => {
  const res = await fetch(`${apiBaseUrl}/api/canvases`);
  if (!res.ok) throw new Error("Failed to list canvases");
  return res.json();
};

const exportCanvas = async (canvasName, context) => {
  const {
    config: { API_BASE_URL },
  } = context;

  try {
    const res = await fetch(
      `${API_BASE_URL}/api/canvas-export?canvasName=${encodeURIComponent(canvasName)}`,
    );
    if (!res.ok) {
      throw new Error(`Export failed: ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${canvasName}.lb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error(`Failed to export ${canvasName}:`, error);
    return false;
  }
};

const importCanvas = async (file, existingNames, context) => {
  const {
    config: { API_BASE_URL },
  } = context;

  try {
    const res = await fetch(`${API_BASE_URL}/api/canvas-import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Import failed: ${res.status}`);
    }
    const data = await res.json();
    const name = String(data?.name || file.name.replace(/\.lb$/, ""));
    return name;
  } catch (error) {
    console.error(`Failed to import ${file.name}:`, error);
    throw error;
  }
};

export const ui = ({ context }) => {
  const { React, actions, components, hooks } = context;
  const { useState, useEffect, useRef } = React;
  const { useT } = hooks;
  const { t } = useT();
  const { API_BASE_URL } = context.config;
  const CanvasButton = components?.CanvasButton;

  const [activeTab, setActiveTab] = useState("export"); // 'export' | 'import'
  const [canvases, setCanvases] = useState([]);
  const [selectedCanvases, setSelectedCanvases] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const fileInputRef = useRef(null);

  const CheckIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const FileIcon = ({ className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );

  const refreshCanvases = async () => {
    try {
      setLoading(true);
      const list = await getAllCanvases(API_BASE_URL);
      setCanvases(list);
    } catch (err) {
      setStatus({ key: "command.canvasImportExport.status.listFailed" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCanvases();
  }, [API_BASE_URL]);

  const toggleCanvas = (name) => {
    const newSet = new Set(selectedCanvases);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    setSelectedCanvases(newSet);
  };

  const handleExport = async () => {
    if (selectedCanvases.size === 0) return;

    setLoading(true);
    setStatus({ key: "command.canvasImportExport.status.exporting" });

    let successCount = 0;
    for (const name of selectedCanvases) {
      const success = await exportCanvas(name, context);
      if (success) successCount++;
    }

    setStatus({
      key: "command.canvasImportExport.status.exported",
      params: { current: successCount, total: selectedCanvases.size },
    });
    setLoading(false);

    if (successCount === selectedCanvases.size) {
      actions.globalActions.pushToast(
        { key: "toast.command.canvasExportSaved" },
        "success",
      );
    } else {
      actions.globalActions.pushToast(
        { key: "toast.command.exportPartial" },
        "warning",
      );
    }
  };

  const handleImport = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setLoading(true);
    setStatus({ key: "command.canvasImportExport.status.importing" });

    let successCount = 0;
    const currentCanvases = await getAllCanvases(API_BASE_URL);
    const existingNames = currentCanvases.map((c) => c.name);

    for (const file of files) {
      try {
        const newName = await importCanvas(file, existingNames, context);
        existingNames.push(newName);
        successCount++;
      } catch (err) {
        console.error(err);
      }
    }

    setStatus({
      key: "command.canvasImportExport.status.imported",
      params: { current: successCount, total: files.length },
    });
    setLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    await refreshCanvases();
    actions.globalActions.pushToast(
      { key: "toast.command.importSaved", params: { count: successCount } },
      "success",
    );
  };

  return (
    <div className="flex flex-col h-full text-neutral-200 bg-neutral-950">
      <div className="flex border-b border-neutral-800 bg-neutral-950/60 px-4 pt-2">
        <button
          className={`flex-1 pb-3 pt-2 text-xs font-medium transition-all relative ${activeTab === "export"
              ? "text-primary"
              : "text-neutral-500 hover:text-neutral-300"
            }`}
          onClick={() => setActiveTab("export")}
        >
          {t('command.canvasImportExport.tab.export')}
          {activeTab === "export" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full mx-8" />
          )}
        </button>
        <button
          className={`flex-1 pb-3 pt-2 text-xs font-medium transition-all relative ${activeTab === "import"
              ? "text-primary"
              : "text-neutral-500 hover:text-neutral-300"
            }`}
          onClick={() => setActiveTab("import")}
        >
          {t("command.canvasImportExport.tab.import")}
          {activeTab === "import" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full mx-8" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "export" ? (
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">
                {t("command.canvasImportExport.export.tip")}
              </span>
              <button
                onClick={() => {
                  if (selectedCanvases.size === canvases.length) {
                    setSelectedCanvases(new Set());
                  } else {
                    setSelectedCanvases(new Set(canvases.map((c) => c.name)));
                  }
                }}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {selectedCanvases.size === canvases.length
                  ? t("command.canvasImportExport.export.deselectAll")
                  : t("command.canvasImportExport.export.selectAll")}
              </button>
            </div>

            <div className="grid gap-2">
              {canvases.map((canvas) => {
                const isSelected = selectedCanvases.has(canvas.name);
                return (
                  <div
                    key={canvas.name}
                    onClick={() => toggleCanvas(canvas.name)}
                    className={`
                      group relative flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 border
                      ${isSelected
                        ? "border-primary/40 bg-primary/10 shadow-[0_0_15px_-5px_rgba(var(--primary-rgb),0.3)]"
                        : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800 hover:border-neutral-700"
                      }
                    `}
                  >
                    <div
                      className={`
                      w-10 h-10 rounded-lg flex items-center justify-center transition-colors
                      ${isSelected ? "bg-primary/20 text-primary" : "bg-neutral-800 text-neutral-600 group-hover:text-neutral-500"}
                    `}
                    >
                      <FileIcon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium truncate mb-0.5 ${isSelected ? "text-white" : "text-neutral-300"}`}
                      >
                        {canvas.name}
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono">
                        {new Date(canvas.lastModified).toLocaleDateString()}
                      </div>
                    </div>

                    <div
                      className={`
                      w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-200
                      ${isSelected
                          ? "bg-primary border-primary scale-100"
                          : "border-neutral-600 bg-transparent group-hover:border-neutral-500"
                        }
                    `}
                    >
                      {isSelected && (
                        <CheckIcon className="text-white w-3 h-3" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full p-4">
            <div
              className="flex-1 flex p-4 flex-col items-center justify-center gap-6 border-2 border-dashed border-neutral-800 rounded-2xl bg-neutral-900/20 hover:bg-neutral-900/40 hover:border-neutral-700 transition-all cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-20 h-20 rounded-2xl bg-neutral-900 flex items-center justify-center text-neutral-600 group-hover:text-primary group-hover:scale-110 transition-all duration-300 shadow-xl">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="text-center space-y-2">
                <p className="text-base font-medium text-neutral-200 group-hover:text-white transition-colors">
                  {t("command.canvasImportExport.import.title")}
                </p>
                <p className="text-xs text-neutral-500 max-w-[240px] mx-auto leading-relaxed">
                  {t("command.canvasImportExport.import.subtitle")}
                </p>
              </div>

              {CanvasButton ? (
                <CanvasButton
                  disabled={loading}
                  className="pointer-events-none"
                >
                  {t("command.canvasImportExport.import.selectFiles")}
                </CanvasButton>
              ) : (
                <span className="px-5 py-2.5 bg-neutral-800 text-neutral-300 text-xs font-medium rounded-lg group-hover:bg-primary group-hover:text-white transition-colors">
                  {t("command.canvasImportExport.import.selectFiles")}
                </span>
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept=".lb"
              multiple
              className="hidden"
              onChange={handleImport}
            />
          </div>
        )}
      </div>

      <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-neutral-500 truncate max-w-[200px]">
            {status ? t(status.key, status.params) : ""}
          </span>
          {activeTab === "export" &&
            (CanvasButton ? (
              <CanvasButton
                onClick={handleExport}
                disabled={loading || selectedCanvases.size === 0}
              >
                {loading
                  ? t("command.canvasImportExport.status.exporting")
                  : t("command.canvasImportExport.action.export", {
                    count: selectedCanvases.size,
                  })}
              </CanvasButton>
            ) : (
              <button
                onClick={handleExport}
                disabled={loading || selectedCanvases.size === 0}
                className={`px-6 py-2.5 rounded-lg text-xs font-medium transition-all shadow-lg ${loading || selectedCanvases.size === 0
                    ? "bg-neutral-900 text-neutral-500 cursor-not-allowed shadow-none"
                    : "bg-primary hover:bg-primary/90 text-white shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0"
                  }`}
              >
                {loading
                  ? t("command.canvasImportExport.status.exporting")
                  : t("command.canvasImportExport.action.export", {
                    count: selectedCanvases.size,
                  })}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
};
