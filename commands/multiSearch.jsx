// This file is intended to be dynamically loaded.
// Imports are not allowed. Dependencies are passed via context.

const SEARCH_SOURCES = [
  {
    key: "pinterest",
    labelKey: "command.multiSearch.source.pinterest",
    buildUrl: (query) => `https://www.pinterest.com/search/pins/?q=${query}`,
  },
  {
    key: "huaban",
    labelKey: "command.multiSearch.source.huaban",
    buildUrl: (query) => `https://huaban.com/search?q=${query}`,
  },
  {
    key: "pixiv",
    labelKey: "command.multiSearch.source.pixiv",
    buildUrl: (query) => `https://www.pixiv.net/tags/${query}/artworks`,
  },
];

const SOURCE_STORAGE_KEY = "command.multiSearch.selectedSources";
const DEFAULT_SELECTED_SOURCES = {
  pinterest: true,
  huaban: true,
  pixiv: true,
};

const loadSelectedSources = () => {
  const rawValue = window.localStorage.getItem(SOURCE_STORAGE_KEY);
  if (!rawValue) return DEFAULT_SELECTED_SOURCES;
  try {
    const parsed = JSON.parse(rawValue);
    return {
      pinterest: parsed.pinterest === true,
      huaban: parsed.huaban === true,
      pixiv: parsed.pixiv === true,
    };
  } catch {
    return DEFAULT_SELECTED_SOURCES;
  }
};

export const config = {
  id: "multiSearch",
  i18n: {
    en: {
      "command.multiSearch.title": "Multi Search",
      "command.multiSearch.description": "Search keyword across multiple websites",
      "command.multiSearch.input.label": "Keyword",
      "command.multiSearch.input.placeholder": "Enter keyword",
      "command.multiSearch.source.label": "Search Sources",
      "command.multiSearch.source.pinterest": "Pinterest",
      "command.multiSearch.source.huaban": "Huaban",
      "command.multiSearch.source.pixiv": "Pixiv",
      "command.multiSearch.submit": "Search",
      "command.multiSearch.tip": "Only checked websites will be opened",
      "toast.command.multiSearch.empty": "Please enter a keyword",
      "toast.command.multiSearch.noSource": "Please select at least one website",
      "toast.command.multiSearch.unsupported": "Current environment cannot open external links",
      "toast.command.multiSearch.opened": "Opened {{count}} websites for \"{{keyword}}\"",
    },
    zh: {
      "command.multiSearch.title": "多路搜索",
      "command.multiSearch.description": "输入关键词后按勾选站点分别搜索",
      "command.multiSearch.input.label": "搜索词",
      "command.multiSearch.input.placeholder": "请输入搜索词",
      "command.multiSearch.source.label": "搜索站点",
      "command.multiSearch.source.pinterest": "Pinterest",
      "command.multiSearch.source.huaban": "花瓣",
      "command.multiSearch.source.pixiv": "Pixiv",
      "command.multiSearch.submit": "搜索",
      "command.multiSearch.tip": "仅会打开已勾选的站点",
      "toast.command.multiSearch.empty": "请输入搜索词",
      "toast.command.multiSearch.noSource": "请至少勾选一个站点",
      "toast.command.multiSearch.unsupported": "当前环境无法打开外部链接",
      "toast.command.multiSearch.opened": "已为“{{keyword}}”打开 {{count}} 个站点",
    },
  },
  titleKey: "command.multiSearch.title",
  title: "Multi Search",
  descriptionKey: "command.multiSearch.description",
  description: "Search keyword across multiple websites",
  keywords: ["search", "multi", "pinterest", "huaban", "pixiv", "多路", "花瓣", "搜索"],
};

const buildSearchTargets = (keyword, selectedSources) => {
  const query = encodeURIComponent(keyword.trim());
  return SEARCH_SOURCES.filter((source) => selectedSources[source.key]).map((source) => source.buildUrl(query));
};

const hasAnySourceSelected = (selectedSources) =>
  Object.values(selectedSources).some(Boolean);

export const ui = ({ context }) => {
  const { React, hooks, actions } = context;
  const { useEffect, useRef, useState } = React;
  const { useT } = hooks;
  const { t } = useT();

  const [keyword, setKeyword] = useState("");
  const [selectedSources, setSelectedSources] = useState(loadSelectedSources);
  const inputRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.select();
    });
  }, []);

  const handleSourceToggle = (sourceKey) => {
    setSelectedSources((prev) => {
      const next = {
        ...prev,
        [sourceKey]: !prev[sourceKey],
      };
      window.localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSubmit = async (event) => {
    if (event) {
      event.preventDefault();
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      actions.globalActions.pushToast(
        { key: "toast.command.multiSearch.empty" },
        "warning",
      );
      return;
    }

    if (!hasAnySourceSelected(selectedSources)) {
      actions.globalActions.pushToast(
        { key: "toast.command.multiSearch.noSource" },
        "warning",
      );
      return;
    }

    if (!window.electron?.openExternal) {
      actions.globalActions.pushToast(
        { key: "toast.command.multiSearch.unsupported" },
        "error",
      );
      return;
    }

    const targets = buildSearchTargets(trimmedKeyword, selectedSources);

    // 顺序打开目标站点，避免系统并发调起导致顺序不稳定。
    for (const target of targets) {
      await window.electron.openExternal(target);
    }

    actions.globalActions.pushToast(
      {
        key: "toast.command.multiSearch.opened",
        params: {
          keyword: trimmedKeyword,
          count: String(targets.length),
        },
      },
      "success",
    );
    actions.commandActions.close();
  };

  const submitDisabled = !keyword.trim() || !hasAnySourceSelected(selectedSources);

  return (
    <form
      className="px-4 py-4 space-y-3"
      onSubmit={handleSubmit}
    >
      <label className="block text-sm text-neutral-300">
        {t("command.multiSearch.input.label")}
      </label>
      <input
        ref={inputRef}
        type="text"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t("command.multiSearch.input.placeholder")}
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />

      <div className="space-y-2">
        <div className="text-sm text-neutral-300">
          {t("command.multiSearch.source.label")}
        </div>
        {SEARCH_SOURCES.map((source) => (
          <label
            key={source.key}
            className="flex items-center gap-2 text-sm text-neutral-200"
          >
            <input
              type="checkbox"
              checked={selectedSources[source.key]}
              onChange={() => handleSourceToggle(source.key)}
              className="h-4 w-4 accent-primary"
            />
            <span>{t(source.labelKey)}</span>
          </label>
        ))}
      </div>

      <div className="text-xs text-neutral-500">
        {t("command.multiSearch.tip")}
      </div>
      <button
        type="submit"
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={submitDisabled}
      >
        {t("command.multiSearch.submit")}
      </button>
    </form>
  );
};
