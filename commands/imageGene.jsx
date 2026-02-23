// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

// 热力图固定 3×3 分箱，总计 9 格
const HISTOGRAM_BINS = 3;
const MAX_EDGE = 512;
const MAX_SAMPLES_PER_IMAGE = 70000;
const PALETTE_SIZE = 8;
const PALETTE_KMEANS_ITERATIONS = 16;
const PALETTE_MIN_LAB_DISTANCE = 12;
const HEATMAP_LEVELS = 8;
const HEATMAP_UPPER_QUANTILE = 0.96;
const HEATMAP_GAMMA = 0.72;
const BACKGROUND_MIN_BORDER_SAMPLES = 24;
const BACKGROUND_DOMINANCE_THRESHOLD = 0.6;
const BACKGROUND_DISTANCE_LOW_CHROMA = 18;
const BACKGROUND_DISTANCE_HIGH_CHROMA = 12;
// sRGB 色域内 CIELAB 色度 C* 的实际上限约 120（高饱和红/绿）
// 除以 100 会导致 C* > 100 的像素全堆到最高 bin，失真严重
const CIELAB_CHROMA_MAX = 120;

const createBins = () => Array.from({ length: HISTOGRAM_BINS }, () => 0);

const createAccumulator = () => ({
  lightnessBins: createBins(),
  saturationBins: createBins(),
  heatmapBins: Array.from({ length: HISTOGRAM_BINS * HISTOGRAM_BINS }, () => 0),
  pixelCount: 0,
  paletteMap: new Map(),
});

const resolveImageUrl = (imagePath, canvasName, apiBaseUrl) => {
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

const getImageDisplayName = (imagePath, itemId) => {
  const normalized = `${imagePath || ""}`.replace(/\\/g, "/");
  const filename = normalized.split("/").pop();
  if (filename && filename.trim().length > 0) return filename;
  return `${itemId}`;
};

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = url;
  });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const labF = (value) => {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  return value > epsilon ? Math.cbrt(value) : (kappa * value + 16) / 116;
};

const rgbToLab = (r, g, b) => {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;

  const xn = 0.95047;
  const yn = 1;
  const zn = 1.08883;
  const fx = labF(x / xn);
  const fy = labF(y / yn);
  const fz = labF(z / zn);

  return {
    l: clamp(116 * fy - 16, 0, 100),
    a: 500 * (fx - fy),
    labB: 200 * (fy - fz),
  };
};

const toBinIndex = (value, max = 100) => {
  const ratio = clamp(value / max, 0, 1);
  return Math.min(HISTOGRAM_BINS - 1, Math.floor(ratio * HISTOGRAM_BINS));
};

const quantizeColorKey = (r8, g8, b8) =>
  ((r8 >> 3) << 10) | ((g8 >> 3) << 5) | (b8 >> 3);

const toHex = (value) => value.toString(16).padStart(2, "0");

const getSaturation = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 0 ? 0 : ((max - min) / max) * 100;
};

const squaredLabDistance = (x1, y1, z1, x2, y2, z2) => {
  const dl = x1 - x2;
  const da = y1 - y2;
  const db = z1 - z2;
  return dl * dl + da * da + db * db;
};

const estimateBackgroundFromBorder = (imageData, width, height) => {
  const borderMap = new Map();
  let borderCount = 0;

  const collect = (x, y) => {
    const offset = (y * width + x) * 4;
    const alpha = imageData[offset + 3];
    if (alpha <= 16) return;
    const alphaWeight = alpha / 255;
    const r8 = imageData[offset];
    const g8 = imageData[offset + 1];
    const b8 = imageData[offset + 2];
    const colorKey = quantizeColorKey(r8, g8, b8);
    const bucket = borderMap.get(colorKey);
    if (!bucket) {
      borderMap.set(colorKey, {
        weight: alphaWeight,
        rSum: r8 * alphaWeight,
        gSum: g8 * alphaWeight,
        bSum: b8 * alphaWeight,
      });
    } else {
      bucket.weight += alphaWeight;
      bucket.rSum += r8 * alphaWeight;
      bucket.gSum += g8 * alphaWeight;
      bucket.bSum += b8 * alphaWeight;
    }
    borderCount += alphaWeight;
  };

  for (let x = 0; x < width; x += 1) {
    collect(x, 0);
    if (height > 1) collect(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    collect(0, y);
    if (width > 1) collect(width - 1, y);
  }

  if (borderCount < BACKGROUND_MIN_BORDER_SAMPLES) return null;

  let dominant = null;
  borderMap.forEach((bucket) => {
    if (!dominant || bucket.weight > dominant.weight) {
      dominant = bucket;
    }
  });
  if (!dominant) return null;

  const dominance = dominant.weight / borderCount;
  if (dominance < BACKGROUND_DOMINANCE_THRESHOLD) return null;

  const r = clamp(dominant.rSum / dominant.weight / 255, 0, 1);
  const g = clamp(dominant.gSum / dominant.weight / 255, 0, 1);
  const b = clamp(dominant.bSum / dominant.weight / 255, 0, 1);
  const lab = rgbToLab(r, g, b);
  const chroma = Math.sqrt(lab.a * lab.a + lab.labB * lab.labB);
  const distance =
    chroma < 16 ? BACKGROUND_DISTANCE_LOW_CHROMA : BACKGROUND_DISTANCE_HIGH_CHROMA;

  return {
    l: lab.l,
    a: lab.a,
    labB: lab.labB,
    threshold2: distance * distance,
  };
};

const buildPalettePoints = (paletteMap) =>
  Array.from(paletteMap.values())
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => {
      const weight = bucket.count;
      const r = clamp(bucket.rSum / weight / 255, 0, 1);
      const g = clamp(bucket.gSum / weight / 255, 0, 1);
      const b = clamp(bucket.bSum / weight / 255, 0, 1);
      const lab = rgbToLab(r, g, b);
      return {
        weight,
        r,
        g,
        b,
        l: lab.l,
        a: lab.a,
        labB: lab.labB,
        saturation: getSaturation(r, g, b),
      };
    });

const seedPaletteCenters = (points, clusterCount) => {
  const selected = [];
  if (clusterCount <= 0 || points.length === 0) return selected;

  const first = points.reduce((best, point) => {
    const pointScore = point.weight * (0.6 + 0.4 * (point.saturation / 100));
    if (!best || pointScore > best.score) {
      return { score: pointScore, point };
    }
    return best;
  }, null);

  if (!first) return selected;
  selected.push({ l: first.point.l, a: first.point.a, labB: first.point.labB });

  while (selected.length < clusterCount) {
    let bestPoint = null;
    let bestScore = -1;
    for (const point of points) {
      let minDist2 = Number.POSITIVE_INFINITY;
      for (const center of selected) {
        const dist2 = squaredLabDistance(
          point.l,
          point.a,
          point.labB,
          center.l,
          center.a,
          center.labB,
        );
        if (dist2 < minDist2) minDist2 = dist2;
      }
      const score = minDist2 * point.weight * (0.5 + 0.5 * (point.saturation / 100));
      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
    }
    if (!bestPoint) break;
    selected.push({ l: bestPoint.l, a: bestPoint.a, labB: bestPoint.labB });
  }

  return selected;
};

const buildPaletteClusters = (points, centerCount) => {
  if (points.length === 0 || centerCount <= 0) return [];

  const centers = seedPaletteCenters(points, centerCount);
  const effectiveCount = centers.length;
  if (effectiveCount === 0) return [];

  const assignments = Array.from({ length: points.length }, () => -1);

  for (let iter = 0; iter < PALETTE_KMEANS_ITERATIONS; iter += 1) {
    const sums = Array.from({ length: effectiveCount }, () => ({
      weight: 0,
      r: 0,
      g: 0,
      b: 0,
      l: 0,
      a: 0,
      labB: 0,
      saturation: 0,
    }));

    let hasChange = false;

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      let bestCenter = 0;
      let bestDist2 = Number.POSITIVE_INFINITY;
      for (let c = 0; c < effectiveCount; c += 1) {
        const center = centers[c];
        const dist2 = squaredLabDistance(
          point.l,
          point.a,
          point.labB,
          center.l,
          center.a,
          center.labB,
        );
        if (dist2 < bestDist2) {
          bestDist2 = dist2;
          bestCenter = c;
        }
      }

      if (assignments[i] !== bestCenter) {
        assignments[i] = bestCenter;
        hasChange = true;
      }

      const acc = sums[bestCenter];
      const w = point.weight;
      acc.weight += w;
      acc.r += point.r * w;
      acc.g += point.g * w;
      acc.b += point.b * w;
      acc.l += point.l * w;
      acc.a += point.a * w;
      acc.labB += point.labB * w;
      acc.saturation += point.saturation * w;
    }

    for (let c = 0; c < effectiveCount; c += 1) {
      const acc = sums[c];
      if (acc.weight <= 0) continue;
      centers[c] = {
        l: acc.l / acc.weight,
        a: acc.a / acc.weight,
        labB: acc.labB / acc.weight,
      };
    }

    if (!hasChange) break;
  }

  const clusterSums = Array.from({ length: effectiveCount }, () => ({
    weight: 0,
    r: 0,
    g: 0,
    b: 0,
    l: 0,
    a: 0,
    labB: 0,
    saturation: 0,
  }));

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const centerIndex = assignments[i];
    if (centerIndex < 0) continue;
    const acc = clusterSums[centerIndex];
    const w = point.weight;
    acc.weight += w;
    acc.r += point.r * w;
    acc.g += point.g * w;
    acc.b += point.b * w;
    acc.l += point.l * w;
    acc.a += point.a * w;
    acc.labB += point.labB * w;
    acc.saturation += point.saturation * w;
  }

  return clusterSums
    .filter((acc) => acc.weight > 0)
    .map((acc) => ({
      weight: acc.weight,
      r: acc.r / acc.weight,
      g: acc.g / acc.weight,
      b: acc.b / acc.weight,
      l: acc.l / acc.weight,
      a: acc.a / acc.weight,
      labB: acc.labB / acc.weight,
      saturation: acc.saturation / acc.weight,
    }));
};

const finalizePalette = (paletteMap, pixelCount) => {
  if (pixelCount <= 0) return [];

  const points = buildPalettePoints(paletteMap);
  if (points.length === 0) return [];

  const clusters = buildPaletteClusters(points, Math.min(PALETTE_SIZE, points.length));
  if (clusters.length === 0) return [];

  const totalWeight = clusters.reduce((sum, item) => sum + item.weight, 0) || 1;
  const ranked = [...clusters].sort((left, right) => {
    const leftWeight = left.weight / totalWeight;
    const rightWeight = right.weight / totalWeight;
    const leftScore = leftWeight * (0.7 + 0.3 * (left.saturation / 100));
    const rightScore = rightWeight * (0.7 + 0.3 * (right.saturation / 100));
    return rightScore - leftScore;
  });

  const selected = [];
  const threshold2 = PALETTE_MIN_LAB_DISTANCE * PALETTE_MIN_LAB_DISTANCE;
  for (const candidate of ranked) {
    const isNear = selected.some((item) => {
      const dist2 = squaredLabDistance(
        candidate.l,
        candidate.a,
        candidate.labB,
        item.l,
        item.a,
        item.labB,
      );
      return dist2 < threshold2;
    });
    if (!isNear) {
      selected.push(candidate);
    }
    if (selected.length >= PALETTE_SIZE) break;
  }

  if (selected.length < PALETTE_SIZE) {
    for (const candidate of ranked) {
      if (selected.includes(candidate)) continue;
      selected.push(candidate);
      if (selected.length >= PALETTE_SIZE) break;
    }
  }

  return selected.slice(0, PALETTE_SIZE).map((cluster) => {
    const r = Math.round(clamp(cluster.r * 255, 0, 255));
    const g = Math.round(clamp(cluster.g * 255, 0, 255));
    const b = Math.round(clamp(cluster.b * 255, 0, 255));
    return {
      hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
      ratio: cluster.weight / pixelCount,
    };
  });
};

const sampleImageGene = async (url, removeBackground) => {
  const image = await loadImage(url);
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  const ratio = Math.min(1, MAX_EDGE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * ratio));
  const sampleHeight = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const totalPixels = sampleWidth * sampleHeight;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLES_PER_IMAGE));
  const background = removeBackground
    ? estimateBackgroundFromBorder(imageData, sampleWidth, sampleHeight)
    : null;

  const acc = createAccumulator();

  // 单次采样同时统计明度、饱和度二维分布与色板；自动剔除边缘背景主色
  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += stride) {
    const offset = pixelIndex * 4;
    const alpha = imageData[offset + 3];
    if (alpha <= 16) continue;
    const alphaWeight = alpha / 255;

    const r8 = imageData[offset];
    const g8 = imageData[offset + 1];
    const b8 = imageData[offset + 2];

    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;

    const lab = rgbToLab(r, g, b);
    if (background) {
      const dist2 = squaredLabDistance(
        lab.l,
        lab.a,
        lab.labB,
        background.l,
        background.a,
        background.labB,
      );
      if (dist2 <= background.threshold2) continue;
    }
    const lStar = lab.l;
    // 使用 CIELAB 色度 C* 作为饱和轴（感知均匀），归一化到 sRGB 实际上限 CIELAB_CHROMA_MAX
    const chroma = Math.sqrt(lab.a * lab.a + lab.labB * lab.labB);

    const lightnessBin = toBinIndex(lStar);
    // 色度归一化须用 CIELAB_CHROMA_MAX，而非 100，否则高饱和像素全挤进最高 bin
    const saturationBin = toBinIndex(chroma, CIELAB_CHROMA_MAX);
    acc.lightnessBins[lightnessBin] += alphaWeight;
    acc.saturationBins[saturationBin] += alphaWeight;
    acc.heatmapBins[saturationBin * HISTOGRAM_BINS + lightnessBin] += alphaWeight;
    acc.pixelCount += alphaWeight;

    const colorKey = quantizeColorKey(r8, g8, b8);
    const bucket = acc.paletteMap.get(colorKey);
    if (!bucket) {
      acc.paletteMap.set(colorKey, {
        count: alphaWeight,
        rSum: r8 * alphaWeight,
        gSum: g8 * alphaWeight,
        bSum: b8 * alphaWeight,
      });
      continue;
    }
    bucket.count += alphaWeight;
    bucket.rSum += r8 * alphaWeight;
    bucket.gSum += g8 * alphaWeight;
    bucket.bSum += b8 * alphaWeight;
  }

  return acc;
};

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

// 返回 HISTOGRAM_BINS*HISTOGRAM_BINS 个 cell 颜色，行=satIndex(0=低)，Y 翻转后第0行显示高饱和
const computeHeatmapCells = (bins, pixelCount) => {
  const expectedSize = HISTOGRAM_BINS * HISTOGRAM_BINS;
  if (bins.length !== expectedSize || pixelCount <= 0) return null;

  const normalizedBins = bins.map((value) => value / pixelCount);
  const nonZeroBins = normalizedBins.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonZeroBins.length === 0) return null;

  const maxCount = nonZeroBins[nonZeroBins.length - 1];
  if (maxCount <= 0) return null;

  const quantileIndex = Math.min(
    nonZeroBins.length - 1,
    Math.floor(nonZeroBins.length * HEATMAP_UPPER_QUANTILE),
  );
  const quantileCap = nonZeroBins[quantileIndex];
  const normalizedCap = Math.max(quantileCap, maxCount / HEATMAP_LEVELS);

  // cells[rowIndex][colIndex]，rowIndex=0 对应高饱和（Y 轴翻转）
  const cells = [];
  for (let rowIndex = 0; rowIndex < HISTOGRAM_BINS; rowIndex += 1) {
    // 翻转 satIndex：rowIndex=0 → 高饱和
    const satIndex = HISTOGRAM_BINS - 1 - rowIndex;
    const row = [];
    for (let lightIndex = 0; lightIndex < HISTOGRAM_BINS; lightIndex += 1) {
      const count = normalizedBins[satIndex * HISTOGRAM_BINS + lightIndex];
      if (count <= 0) {
        row.push("transparent");
        continue;
      }
      const normalized = clamp(count / normalizedCap, 0, 1);
      const perceptual = normalized ** HEATMAP_GAMMA;
      const stepIndex = Math.ceil(perceptual * (HEATMAP_LEVELS - 1));
      const intensity = stepIndex / (HEATMAP_LEVELS - 1);

      const lowR = 56, lowG = 96, lowB = 160;
      const highR = 255, highG = 156, highB = 72;
      const r = Math.round(lowR + (highR - lowR) * intensity);
      const g = Math.round(lowG + (highG - lowG) * intensity);
      const b = Math.round(lowB + (highB - lowB) * intensity);
      const a = (56 + 199 * intensity) / 255;
      row.push(`rgba(${r},${g},${b},${a.toFixed(2)})`);
    }
    cells.push(row);
  }
  return cells;
};

export const config = {
  id: "imageGene",
  i18n: {
    en: {
      "command.imageGene.title": "Image Gene",
      "command.imageGene.description": "Analyze palette, lightness and chroma distributions",
      "command.imageGene.empty": "Select one or more images first",
      "command.imageGene.loading": "Analyzing image gene...",
      "command.imageGene.failed": "Image gene analysis failed. Check image accessibility.",
      "command.imageGene.sourceCount": "Images: {{count}}",
      "command.imageGene.samples": "Sampled pixels: {{count}}",
      "command.imageGene.failedCount": "{{count}} images failed to load and were skipped",
      "command.imageGene.removeBackground": "Auto remove background",
      "command.imageGene.palette": "Palette",
      "command.imageGene.lightness": "Lightness Distribution",
      "command.imageGene.saturation": "Saturation Distribution",
      "command.imageGene.chroma": "Chroma Distribution",
      "command.imageGene.low": "Low",
      "command.imageGene.mid": "Mid",
      "command.imageGene.high": "High",
      "command.imageGene.copy": "Click to copy color",
      "command.imageGene.copied": "Copied",
      "command.imageGene.mean": "Mean",
      "command.imageGene.std": "Std Dev",
      "command.imageGene.p10": "P10",
      "command.imageGene.p50": "P50",
      "command.imageGene.p90": "P90",
      "command.imageGene.shadowClip": "Shadow Clip",
      "command.imageGene.highlightClip": "Highlight Clip",
    },
    zh: {
      "command.imageGene.title": "图像基因",
      "command.imageGene.description": "分析调色板、亮度及色度分布",
      "command.imageGene.empty": "请先选中一张或多张图片",
      "command.imageGene.loading": "正在分析图片基因…",
      "command.imageGene.failed": "图片基因分析失败，请检查图片是否可访问",
      "command.imageGene.sourceCount": "图片数：{{count}}",
      "command.imageGene.samples": "采样像素：{{count}}",
      "command.imageGene.failedCount": "{{count}} 张图片读取失败，已跳过",
      "command.imageGene.removeBackground": "自动去除背景色",
      "command.imageGene.palette": "主色板",
      "command.imageGene.lightness": "明度分布",
      "command.imageGene.saturation": "饱和度分布",
      "command.imageGene.chroma": "色度分布",
      "command.imageGene.low": "低",
      "command.imageGene.mid": "中",
      "command.imageGene.high": "高",
      "command.imageGene.copy": "点击复制色值",
      "command.imageGene.copied": "已复制",
      "command.imageGene.mean": "均值",
      "command.imageGene.std": "标准差",
      "command.imageGene.p10": "P10",
      "command.imageGene.p50": "P50",
      "command.imageGene.p90": "P90",
      "command.imageGene.shadowClip": "暗部裁剪",
      "command.imageGene.highlightClip": "高光裁剪",
    },
  },
  titleKey: "command.imageGene.title",
  title: "Image Gene",
  descriptionKey: "command.imageGene.description",
  description: "Analyze palette, lightness and chroma distributions",
  keywords: ["image", "gene", "palette", "lightness", "chroma", "histogram"],
};

export const ui = ({ context }) => {
  const { React, hooks, config } = context;
  const { useState, useEffect, useMemo, useRef } = React;
  const { useEnvState, useT } = hooks;
  const { canvas: canvasSnap } = useEnvState();
  const { t } = useT();

  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [results, setResults] = useState(null);
  const [copiedSwatchKey, setCopiedSwatchKey] = useState("");
  const [removeBackground, setRemoveBackground] = useState(false);
  const copyTimerRef = useRef(null);

  const targetImages = useMemo(() => {
    const images = canvasSnap.canvasItems.filter((item) => item.type === "image");
    const selected = images.filter((item) => item.isSelected);
    if (selected.length > 0) {
      return selected;
    }
    if (canvasSnap.primaryId) {
      const primary = images.find((item) => item.itemId === canvasSnap.primaryId);
      if (primary) {
        return [primary];
      }
    }
    if (images.length === 1) {
      return images;
    }
    return [];
  }, [canvasSnap.canvasItems, canvasSnap.primaryId]);

  const targetImagePayload = useMemo(
    () =>
      JSON.stringify(
        targetImages.map((item) => ({
          itemId: item.itemId,
          imagePath: item.imagePath,
        })),
      ),
    [targetImages],
  );

  const analysisTargets = useMemo(
    () => JSON.parse(targetImagePayload),
    [targetImagePayload],
  );

  useEffect(() => {
    let cancelled = false;
    let debounceTimer = null;

    const run = async () => {
      if (analysisTargets.length === 0) {
        setResults(null);
        setHasError(false);
        setLoading(false);
        setFailedCount(0);
        return;
      }

      setLoading(true);
      setHasError(false);
      setFailedCount(0);

      const nextResults = [];
      let failures = 0;

      for (const image of analysisTargets) {
        try {
          const url = resolveImageUrl(
            image.imagePath,
            canvasSnap.currentCanvasName,
            config.API_BASE_URL,
          );
          const sample = await sampleImageGene(url, removeBackground);
          if (cancelled) return;
          if (sample.pixelCount <= 0) {
            failures += 1;
            continue;
          }
          nextResults.push({
            itemId: image.itemId,
            imagePath: image.imagePath,
            heatmapBins: sample.heatmapBins,
            pixelCount: sample.pixelCount,
            palette: finalizePalette(sample.paletteMap, sample.pixelCount),
          });
        } catch {
          failures += 1;
        }
      }

      if (cancelled) return;

      if (nextResults.length <= 0) {
        setResults(null);
        setFailedCount(failures);
        setHasError(true);
        setLoading(false);
        return;
      }

      setResults(nextResults);
      setFailedCount(failures);
      setHasError(false);
      setLoading(false);
    };

    // 面板打开瞬间 valtio 状态连续变化，防抖 80ms 等依赖稳定后再启动分析
    debounceTimer = setTimeout(() => {
      void run();
    }, 80);

    return () => {
      cancelled = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    };
  }, [
    analysisTargets,
    canvasSnap.currentCanvasName,
    config.API_BASE_URL,
    removeBackground,
  ]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const renderResults = useMemo(() => {
    if (!results) return [];
    return results.map((item) => ({
      ...item,
      heatmapCells: computeHeatmapCells(item.heatmapBins, item.pixelCount),
      displayName: getImageDisplayName(item.imagePath, item.itemId),
    }));
  }, [results]);

  const handleCopySwatch = async (itemId, hex) => {
    const swatchKey = `${itemId}_${hex}`;
    try {
      await copyText(hex);
      setCopiedSwatchKey(swatchKey);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedSwatchKey("");
      }, 1200);
    } catch {
      // ignore
    }
  };

  if (analysisTargets.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-neutral-500">
        {t("command.imageGene.empty")}
      </div>
    );
  }

  if (!loading && (hasError || !renderResults.length)) {
    return (
      <div className="px-4 py-6 text-xs text-red-300">
        {t("command.imageGene.failed")}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 text-xs text-neutral-200">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] text-neutral-500">
          {loading ? t("command.imageGene.loading") : ""}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300">
          <input
            type="checkbox"
            checked={removeBackground}
            onChange={(event) => {
              setRemoveBackground(event.target.checked);
            }}
            className="h-3.5 w-3.5 accent-neutral-200"
          />
          <span>{t("command.imageGene.removeBackground")}</span>
        </label>
      </div>

      {failedCount > 0 && (
        <div className="mb-3 rounded border border-amber-700/60 px-2 py-1 text-[11px] text-amber-200">
          {t("command.imageGene.failedCount", { count: failedCount })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {renderResults.map((item) => (
          <div
            key={item.itemId}
            className="rounded-md border border-neutral-800/80 bg-neutral-900/30 p-3"
          >
            <div className="mb-2 truncate font-mono text-[10px] text-neutral-400">
              {item.displayName}
            </div>

            {/* 色板 + 分布图同行 */}
            <div className="flex gap-4">
              {/* 左：色板 */}
              <div className="shrink-0">
                <div className="mb-2 text-[12px] font-medium text-neutral-200">
                  {t("command.imageGene.palette")}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {item.palette.map((swatch) => {
                    const swatchKey = `${item.itemId}_${swatch.hex}`;
                    const isCopied = copiedSwatchKey === swatchKey;
                    return (
                      <button
                        type="button"
                        key={`${swatch.hex}_${swatch.ratio}`}
                        className={`rounded border px-1.5 py-1 text-left transition-colors ${isCopied
                          ? "border-neutral-500"
                          : "border-neutral-800/70 hover:border-neutral-600"
                          }`}
                        onClick={() => void handleCopySwatch(item.itemId, swatch.hex)}
                        title={t("command.imageGene.copy")}
                      >
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <div
                            className="h-4 w-6 shrink-0 rounded border border-neutral-700"
                            style={{ backgroundColor: swatch.hex }}
                          />
                          <div className="font-mono text-[10px] text-neutral-100">{swatch.hex}</div>
                          {isCopied && (
                            <div className="text-[9px] text-neutral-500">
                              {t("command.imageGene.copied")}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 右：饱和度×明度分布图 */}
              <div className="min-w-0 flex-1">
                <div className="mb-2 text-[12px] font-medium text-neutral-200">
                  {`${t("command.imageGene.saturation")} × ${t("command.imageGene.lightness")}`}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <div className="flex flex-col items-center justify-between py-1 text-[10px] text-neutral-400">
                    <span>{t("command.imageGene.high")}</span>
                    <span
                      className="text-neutral-500"
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {t("command.imageGene.saturation")}
                    </span>
                    <span>{t("command.imageGene.low")}</span>
                  </div>
                  <div>
                    <div className="rounded bg-neutral-900/60 p-1">
                      {item.heatmapCells ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${HISTOGRAM_BINS}, 1fr)`,
                            gap: "2px",
                            height: "10rem",
                          }}
                        >
                          {item.heatmapCells.map((row, rowIndex) =>
                            row.map((color, colIndex) => (
                              <div
                                key={`${rowIndex}_${colIndex}`}
                                style={{ backgroundColor: color, borderRadius: "2px" }}
                              />
                            ))
                          )}
                        </div>
                      ) : (
                        <div className="h-40 w-full rounded bg-neutral-900" />
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-400">
                      <span>{t("command.imageGene.low")}</span>
                      <span className="text-neutral-500">{t("command.imageGene.lightness")}</span>
                      <span>{t("command.imageGene.high")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
