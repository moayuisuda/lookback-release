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
  {
    key: "x",
    labelKey: "command.multiSearch.source.x",
    buildUrl: (query) => `https://x.com/search?q=${query}&src=typed_query`,
  },
];

const SOURCE_STORAGE_KEY = "command.multiSearch.selectedSources";
const DEFAULT_SELECTED_SOURCES = {
  pinterest: true,
  huaban: true,
  pixiv: true,
  x: true,
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
      x: parsed.x === true,
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
      "command.multiSearch.source.x": "X",
      "command.multiSearch.submit": "Search",
      "command.multiSearch.tip": "Only checked websites will be opened",
      "toast.command.multiSearch.empty": "Please enter a keyword",
      "toast.command.multiSearch.noSource": "Please select at least one website",
      "toast.command.multiSearch.unsupported": "Current environment cannot open external links",
      "toast.command.multiSearch.opened": "Opened {{count}} websites for \"{{keyword}}\"",
    },
    zh: {
      "command.multiSearch.title": "多站点搜图",
      "command.multiSearch.description": "输入关键词后按勾选站点分别搜索",
      "command.multiSearch.input.label": "搜索词",
      "command.multiSearch.input.placeholder": "请输入搜索词",
      "command.multiSearch.source.label": "搜索站点",
      "command.multiSearch.source.pinterest": "Pinterest",
      "command.multiSearch.source.huaban": "花瓣",
      "command.multiSearch.source.pixiv": "Pixiv",
      "command.multiSearch.source.x": "X",
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
  keywords: ["search", "multi", "pinterest", "huaban", "pixiv", "x", "多站点", "花瓣", "搜索"],
};

const buildSearchTargets = (keyword, selectedSources) => {
  const query = encodeURIComponent(keyword.trim());
  return SEARCH_SOURCES.filter((source) => selectedSources[source.key]).map((source) => source.buildUrl(query));
};

const hasAnySourceSelected = (selectedSources) =>
  Object.values(selectedSources).some(Boolean);

const COMMAND_STYLE_ID = "multi-search-command-style";
const COMMAND_STYLE_TEXT = `
.multi-search-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.multi-search-label {
  display: block;
  font-size: 14px;
  color: var(--color-neutral-300);
}

.multi-search-input {
  width: 100%;
  border: 1px solid var(--color-neutral-700);
  border-radius: 6px;
  background: var(--color-neutral-900);
  color: var(--color-neutral-100);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 20px;
  outline: none;
}

.multi-search-input:focus {
  border-color: var(--color-neutral-500);
}

.multi-search-sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.multi-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-neutral-200);
  font-size: 14px;
}

.multi-search-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}

.multi-search-tip {
  color: var(--color-neutral-500);
  font-size: 12px;
  line-height: 16px;
}

.multi-search-submit {
  width: 100%;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--color-white);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  padding: 8px 12px;
  transition: filter 0.15s ease, opacity 0.15s ease;
  cursor: pointer;
}

.multi-search-submit:hover {
  filter: brightness(0.92);
}

.multi-search-submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  filter: none;
}
`;

const ensureCommandStyle = () => {
  if (document.getElementById(COMMAND_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = COMMAND_STYLE_ID;
  style.textContent = COMMAND_STYLE_TEXT;
  document.head.appendChild(style);
};

export const ui = ({ context }) => {
  const { React, hooks, actions } = context;
  const { useEffect, useRef, useState } = React;
  const { useT } = hooks;
  const { t } = useT();

  const [keyword, setKeyword] = useState("");
  const [selectedSources, setSelectedSources] = useState(loadSelectedSources);
  const inputRef = useRef(null);

  useEffect(() => {
    // 外部命令在运行时动态加载，样式需要在命令内自注入，避免打包时 Tailwind 漏扫。
    ensureCommandStyle();
  }, []);

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
      className="multi-search-form"
      onSubmit={handleSubmit}
    >
      <label className="multi-search-label">
        {t("command.multiSearch.input.label")}
      </label>
      <input
        ref={inputRef}
        type="text"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t("command.multiSearch.input.placeholder")}
        className="multi-search-input"
      />

      <div className="multi-search-sources">
        <div className="multi-search-label">
          {t("command.multiSearch.source.label")}
        </div>
        {SEARCH_SOURCES.map((source) => (
          <label
            key={source.key}
            className="multi-search-item"
          >
            <input
              type="checkbox"
              checked={selectedSources[source.key]}
              onChange={() => handleSourceToggle(source.key)}
              className="multi-search-checkbox"
            />
            <span>{t(source.labelKey)}</span>
          </label>
        ))}
      </div>

      <div className="multi-search-tip">
        {t("command.multiSearch.tip")}
      </div>
      <button
        type="submit"
        className="multi-search-submit"
        disabled={submitDisabled}
      >
        {t("command.multiSearch.submit")}
      </button>
    </form>
  );
};
