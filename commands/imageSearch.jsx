// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

export const config = {
  id: "imageSearch",
  i18n: {
    en: {
      "command.imageSearch.title": "Image Search",
      "command.imageSearch.description": "Search images by tone and color",
      "command.imageSearch.filter.tone": "Tone",
      "command.imageSearch.filter.color": "Color",
      "command.imageSearch.filter.clear": "Clear All",
      "command.imageSearch.tone.axis.short": "S",
      "command.imageSearch.tone.axis.mid": "M",
      "command.imageSearch.tone.axis.long": "L",
      "command.imageSearch.tone.axis.high": "H",
      "command.imageSearch.tone.axis.low": "L",
      "command.imageSearch.tone.title": "{{tone}} key / {{range}} range",
      "command.imageSearch.color.change": "Change this color",
      "command.imageSearch.empty.withFilters": "No images found",
      "command.imageSearch.empty.noFilters": "Select tone or color to search",
      "command.imageSearch.distance": "Dist: {{value}}",
    },
    zh: {
      "command.imageSearch.title": "图像搜索",
      "command.imageSearch.description": "按色调与颜色搜索图片",
      "command.imageSearch.filter.tone": "色调",
      "command.imageSearch.filter.color": "颜色",
      "command.imageSearch.filter.clear": "清除",
      "command.imageSearch.tone.axis.short": "短",
      "command.imageSearch.tone.axis.mid": "中",
      "command.imageSearch.tone.axis.long": "长",
      "command.imageSearch.tone.axis.high": "高",
      "command.imageSearch.tone.axis.low": "低",
      "command.imageSearch.tone.title": "{{tone}} / {{range}}",
      "command.imageSearch.color.change": "更改颜色",
      "command.imageSearch.empty.withFilters": "没有找到图片",
      "command.imageSearch.empty.noFilters": "选择色调或颜色进行搜索",
      "command.imageSearch.distance": "距离：{{value}}",
    },
  },
  titleKey: "command.imageSearch.title",
  title: "Image Search",
  descriptionKey: "command.imageSearch.description",
  description: "Search images by tone and color",
  keywords: ["search", "image", "find", "color", "tone"],
};

// --- Helpers ---
const isHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value.trim());

const hexToRgb = (value) => {
  const normalized = value.trim().replace("#", "");
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
};

const colorDistance = (a, b) => {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const dr = ra.r - rb.r;
  const dg = ra.g - rb.g;
  const db = ra.b - rb.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

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

const COLOR_DISTANCE_THRESHOLD = 90;

export const ui = ({ context }) => {
  const { React, hooks, state, actions, config: appConfig } = context;
  const { useEnvState } = hooks;
  const { useMemo, useState } = React;
  const { useT } = hooks;
  const { t } = useT();
  const { global: globalSnap, canvas: canvasSnap } = useEnvState();

  const API_BASE_URL = appConfig?.API_BASE_URL || "";

  // 3x3 Grid
  // Y-axis: High, Mid, Low (Key)
  // X-axis: Short, Mid, Long (Range)
  const rows = ["high", "mid", "low"];
  const cols = ["short", "mid", "long"];

  const gradients = {
    "high-short": "linear-gradient(to right, #ffffff, #e5e5e5)",
    "high-mid": "linear-gradient(to right, #ffffff, #a3a3a3)",
    "high-long": "linear-gradient(to right, #ffffff, #525252)",
    "mid-short": "linear-gradient(to right, #a3a3a3, #737373)",
    "mid-mid": "linear-gradient(to right, #d4d4d4, #525252)",
    "mid-long": "linear-gradient(to right, #e5e5e5, #262626)",
    "low-short": "linear-gradient(to right, #525252, #262626)",
    "low-mid": "linear-gradient(to right, #737373, #171717)",
    "low-long": "linear-gradient(to right, #a3a3a3, #000000)",
  };

  const [selectedTones, setSelectedTones] = useState([]);
  const [selectedColors, setSelectedColors] = useState([]);

  const handleToneClick = (value) => {
    setSelectedTones((prev) => {
      if (prev.includes(value)) {
        return prev.filter((t) => t !== value);
      }
      return [...prev, value];
    });
  };

  const handleColorClick = (color) => {
    setSelectedColors((prev) => {
      if (prev.includes(color)) {
        return prev.filter((c) => c !== color);
      }
      return [...prev, color];
    });
  };

  const handleColorChange = (e, originalColor) => {
    const newColor = e.target.value;
    const index = globalSnap.colorSwatches.indexOf(originalColor);
    if (index !== -1) {
      actions.globalActions.setColorSwatch(index, newColor);
    }
    setSelectedColors((prev) =>
      prev.map((c) => (c === originalColor ? newColor : c))
    );
  };

  const handleClear = () => {
    setSelectedTones([]);
    setSelectedColors([]);
  };

  // Search Logic
  const imageResults = useMemo(() => {
    const hasTones = selectedTones.length > 0;
    const hasColors = selectedColors.length > 0;

    if (!hasTones && !hasColors) return [];

    const filtered = canvasSnap.canvasItems
      .filter((item) => item.type === "image")
      .map((item) => {
        let minDistance = null;
        if (hasColors && item.dominantColor) {
          const validDistances = selectedColors
            .map((c) => colorDistance(item.dominantColor, c))
            .filter((d) => d !== null);

          if (validDistances.length > 0) {
            minDistance = Math.min(...validDistances);
          }
        }
        return { item, distance: minDistance };
      })
      .filter(({ item, distance }) => {
        if (hasTones && !selectedTones.includes(item.tone)) return false;
        if (hasColors) {
          if (!item.dominantColor) return false;
          if (distance === null) return false;
          return distance <= COLOR_DISTANCE_THRESHOLD;
        }
        return true;
      });

    if (hasColors) {
      filtered.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    }
    return filtered;
  }, [canvasSnap.canvasItems, selectedTones, selectedColors]);

  const handleSelect = (item) => {
    actions.canvasActions.containCanvasItem(item.itemId);
    actions.commandActions.close();
  };

  const palette = useMemo(() => {
    const swatches = globalSnap.colorSwatches || [];
    const extra = selectedColors.filter((c) => !swatches.includes(c));
    return [...swatches, ...extra];
  }, [globalSnap.colorSwatches, selectedColors]);

  const getToneLabel = (value) => {
    if (value === "high") return t("tone.key.high");
    if (value === "mid") return t("tone.key.mid");
    if (value === "low") return t("tone.key.low");
    return value;
  };

  const getRangeLabel = (value) => {
    if (value === "short") return t("tone.range.short");
    if (value === "mid") return t("tone.range.mid");
    if (value === "long") return t("tone.range.long");
    return value;
  };

  return (
    <div className="flex flex-col h-full max-h-[500px]">
      {/* Header / Filters */}
      <div className="flex gap-6 px-4 py-3 border-b border-neutral-800 shrink-0 overflow-x-auto scrollbar-hide">
        {/* Tone Matrix */}
        <div className="flex flex-col gap-2 shrink-0">
          <div className="text-xs text-neutral-400 font-medium">
            {t("command.imageSearch.filter.tone")}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4" />
            <div className="grid grid-cols-3 gap-x-2 w-[136px]">
              <span className="text-[9px] text-neutral-600 text-center">
                {t("command.imageSearch.tone.axis.short")}
              </span>
              <span className="text-[9px] text-neutral-600 text-center">
                {t("command.imageSearch.tone.axis.mid")}
              </span>
              <span className="text-[9px] text-neutral-600 text-center">
                {t("command.imageSearch.tone.axis.long")}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Y-Axis Label */}
            <div className="flex flex-col gap-2 w-4">
              <div className="h-5 flex items-center justify-center">
                <span className="text-[9px] text-neutral-600 leading-none">
                  {t("command.imageSearch.tone.axis.high")}
                </span>
              </div>
              <div className="h-5 flex items-center justify-center">
                <span className="text-[9px] text-neutral-600 leading-none">
                  {t("command.imageSearch.tone.axis.mid")}
                </span>
              </div>
              <div className="h-5 flex items-center justify-center">
                <span className="text-[9px] text-neutral-600 leading-none">
                  {t("command.imageSearch.tone.axis.low")}
                </span>
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
              {rows.map((row) =>
                cols.map((col) => {
                  const value = `${row}-${col}`;
                  const active = selectedTones.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleToneClick(value)}
                      className={`w-10 h-5 rounded-md border transition-all ${active
                        ? "border-primary ring-1 ring-primary z-10"
                        : "border-neutral-800 hover:border-neutral-600 opacity-80 hover:opacity-100"
                        }`}
                      style={{ background: gradients[value] || "#333" }}
                      title={t("command.imageSearch.tone.title", {
                        tone: getToneLabel(row),
                        range: getRangeLabel(col),
                      })}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>

        <div className="w-px bg-neutral-800 mx-1 shrink-0" />

        {/* Color Palette */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400 font-medium">
              {t("command.imageSearch.filter.color")}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              {t("command.imageSearch.filter.clear")}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {palette.map((color, index) => {
              const isActive = selectedColors.includes(color);
              return (
                <div
                  key={index}
                  className="relative"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const input = e.currentTarget.querySelector(
                      'input[type="color"]'
                    );
                    if (input) {
                      input.click();
                    }
                  }}
                >
                  <button
                    type="button"
                    className={`h-4 w-8 rounded-md border transition-transform ${isActive
                      ? "border-primary ring-1 ring-primary scale-110"
                      : "border-neutral-700 hover:scale-110"
                      }`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorClick(color)}
                  />
                  <input
                    type="color"
                    value={color || "#ffffff"}
                    onChange={(e) => handleColorChange(e, color)}
                    className="absolute inset-0 w-0 h-0 opacity-0 overflow-hidden pointer-events-none"
                    title={t("command.imageSearch.color.change")}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto">
        {imageResults.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">
            {selectedTones.length > 0 || selectedColors.length > 0
              ? t("command.imageSearch.empty.withFilters")
              : t("command.imageSearch.empty.noFilters")}
          </div>
        ) : (
          <div className="flex flex-col">
            {imageResults.map(({ item, distance }) => (
              <button
                key={item.itemId}
                type="button"
                onClick={() => handleSelect(item)}
                className="w-full px-4 py-1.5 text-left flex items-center gap-4 text-sm transition-colors text-neutral-200 hover:bg-neutral-800/70 group"
              >
                <div className="h-10 w-10 rounded border border-neutral-700 overflow-hidden shrink-0 bg-neutral-900">
                  <img
                    src={getImageUrl(
                      item.imagePath,
                      canvasSnap.currentCanvasName,
                      API_BASE_URL,
                    )}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate group-hover:text-primary transition-colors">
                    {item.filename}
                  </div>
                  <div className="text-[11px] text-neutral-500 flex items-center gap-2">
                    {item.tone && <span>{item.tone}</span>}
                  </div>
                </div>
                {typeof distance === "number" && (
                  <span className="text-[10px] text-neutral-500">
                    {t("command.imageSearch.distance", {
                      value: Math.round(distance),
                    })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
