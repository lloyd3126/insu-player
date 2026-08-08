(() => {
  "use strict";

  const ACTIVE = new Set(["checking", "downloading", "transcribing", "translating", "preparing_player"]);
  const ATTENTION = new Set(["needs_transcription", "needs_translation", "interrupted", "failed"]);
  const STATE_LABELS = {
    queued: "等待處理", checking: "檢查來源", downloading: "下載中", downloaded: "下載完成",
    needs_transcription: "待轉錄", transcribing: "轉錄中", needs_translation: "待翻譯",
    translating: "翻譯中", preparing_player: "整理媒體", ready: "已完成",
    interrupted: "已中斷", failed: "處理失敗",
  };
  const TRACK_LABELS = { "zh-TW": "繁中", "zh-Hant": "繁中", en: "EN", ja: "JA", ko: "KO", source: "原文" };
  const YOUTUBE_PROMPT = "請把這支 YouTube 影片加入 INSU Player：\nhttps://www.youtube.com/watch?v=VIDEO_ID";
  const RESEARCH_PROMPT = "請使用 INSU PLAYER 研究這個平台是否能支援：\nPLATFORM_URL";
  const DEFAULT_ACCENT = "#8B7CF6";
  const ACCENT_STORAGE_KEY = "xeruca-player:accent-color:v1";
  const FONT_STORAGE_KEY = "xeruca-player:font:v1";
  const FONT_OPTIONS = {
    system: { label: "系統介面", family: '"Avenir Next", "PingFang TC", sans-serif' },
    pingfang: { label: "蘋方－繁", family: '"PingFang TC", sans-serif' },
    songti: { label: "宋體－繁", family: '"Songti TC", serif' },
    kaiti: { label: "標楷體", family: '"BiauKai", "DFKai-SB", cursive' },
    "noto-sans-tc": { label: "Noto Sans TC", family: '"Noto Sans TC", sans-serif', google: "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;800&display=swap" },
    "noto-serif-tc": { label: "Noto Serif TC", family: '"Noto Serif TC", serif', google: "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700;800&display=swap" },
    "lxgw-wenkai-tc": { label: "LXGW WenKai TC", family: '"LXGW WenKai TC", cursive', google: "https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;500;600;700&display=swap" },
  };
  const POLICY_STORAGE_KEY = "xeruca-player:usage-policy:v2";
  const BYTE_FORMAT = new Intl.NumberFormat("zh-TW");
  const DATE_FORMAT = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const TIME_FORMAT = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const state = {
    jobs: [], query: "", filter: "all", selectedId: null, pollTimer: 0, unloadTimer: 0,
    playbackSaveTimer: 0, playbackTime: 0, playbackDuration: null, loading: false, lastFocused: null,
    supportedSitesTrigger: null, copyStatusTimer: 0,
    extractors: [], extractorsLoaded: false, extractorsLoading: false, sourceQuery: "", researchCopyTimer: 0,
    policyTrigger: null, policyRequired: false, exampleTrigger: null, advancedTrigger: null, modelsTrigger: null, settingsTrigger: null, environmentTrigger: null, libraryTrigger: null,
    environmentConfigured: false, environmentSaving: false, environmentLoading: false,
    advancedCopyTimer: 0, advancedCopyButton: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    rows: $("#job-rows"), template: $("#job-row-template"), empty: $("#empty-state"), tableStatus: $("#table-status"),
    search: $("#search-input"), filter: $("#state-filter"), refresh: $("#refresh-button"), serverLamp: $("#server-lamp"),
    serverLabel: $("#server-label"), lastUpdated: $("#last-updated"),
    playerDialog: $("#player-dialog"), playerFrame: $("#player-frame"), playerLoading: $("#player-loading"),
    modalTitle: $("#modal-title"), resumeNote: $("#resume-note"), detailDialog: $("#detail-dialog"), detailTitle: $("#detail-title"), detailContent: $("#detail-content"),
    modalCaption: $("#modal-caption-language"), supportedSitesDialog: $("#supported-sites-dialog"),
    copyPrompt: $("#copy-youtube-prompt"), copyStatus: $("#copy-status"), openSupportedSites: $("#open-supported-sites"),
    sourceSearch: $("#source-search-input"), sourceList: $("#supported-sites-list"), sourceListStatus: $("#source-list-status"),
    sourceListLoading: $("#source-list-loading"), sourceListUnavailable: $("#source-list-unavailable"), ytDlpVersion: $("#yt-dlp-version"),
    copyResearchPrompt: $("#copy-research-prompt"), researchCopyStatus: $("#research-copy-status"),
    policyDialog: $("#usage-policy-dialog"), openPolicy: $("#open-usage-policy"), closePolicy: $("#close-usage-policy"), acceptPolicy: $("#accept-usage-policy"),
    exampleDialog: $("#usage-example-dialog"), openExample: $("#open-usage-example"), openExampleNav: $("#open-usage-example-nav"), closeExample: $("#close-usage-example"),
    advancedDialog: $("#advanced-usage-dialog"), openAdvanced: $("#open-advanced-usage"), closeAdvanced: $("#close-advanced-usage"), advancedContent: $("#advanced-usage-content"),
    myPromptsList: $("#my-prompts-list"), myPromptsCount: $("#my-prompts-count"), advancedCopyStatus: $("#advanced-copy-status"),
    modelsDialog: $("#models-dialog"), openModels: $("#open-models"), closeModels: $("#close-models"),
    settingsDialog: $("#settings-dialog"), openSettings: $("#open-settings"), closeSettings: $("#close-settings"), accentInput: $("#accent-color-input"), accentValue: $("#accent-color-value"), resetAccent: $("#reset-accent-color"),
    environmentDialog: $("#environment-dialog"), openEnvironment: $("#open-environment"), closeEnvironment: $("#close-environment"), environmentForm: $("#environment-form"), environmentValue: $("#environment-value"),
    environmentVariableStatus: $("#environment-variable-status"), environmentProviderStatus: $("#environment-provider-status"), environmentActionStatus: $("#environment-action-status"), saveEnvironment: $("#save-environment"), clearEnvironment: $("#clear-environment"),
    fontPreset: $("#font-preset"), fontValue: $("#font-setting-value"), fontStatus: $("#font-setting-status"), localFontInput: $("#local-font-input"), applyLocalFont: $("#apply-local-font"),
    libraryDialog: $("#library-dialog"), openLibrary: $("#open-library"), closeLibrary: $("#close-library"), navLibraryCount: $("#nav-library-count"),
    localModelRows: $("#local-model-rows"), apiModelRows: $("#api-model-rows"), localModelsSummary: $("#local-models-summary"), apiModelsSummary: $("#api-models-summary"),
    footerYear: $("#footer-year"),
  };

  function syncDialogOpenState() {
    document.body.classList.toggle("dialog-open", Boolean(document.querySelector("dialog[open]")));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
  }

  function setModelMessage(rows, message) {
    const row = document.createElement("tr");
    row.className = "model-message-row";
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = message;
    row.append(cell);
    rows.replaceChildren(row);
  }

  function createModelStatus(label, tone) {
    const status = document.createElement("span");
    status.className = "model-status";
    status.dataset.tone = tone;
    status.textContent = label;
    return status;
  }

  function renderModels(payload) {
    const local = payload?.local;
    const api = payload?.api;
    if (!local || !Array.isArray(local.models) || !api || !Array.isArray(api.models)) throw new Error("invalid model inventory");

    elements.localModelRows.replaceChildren();
    if (!local.models.length) {
      setModelMessage(elements.localModelRows, "尚未下載任何本機模型");
    } else {
      local.models.forEach((model) => {
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.className = "model-name";
        name.textContent = model.name;
        const status = document.createElement("td");
        status.append(createModelStatus(model.ready ? "已安裝" : "模型檔存在", model.ready ? "ready" : "attention"));
        const size = document.createElement("td");
        size.className = "model-size";
        const readable = document.createElement("strong");
        readable.textContent = formatBytes(model.sizeBytes);
        const exact = document.createElement("small");
        exact.textContent = `${BYTE_FORMAT.format(model.sizeBytes)} 位元組`;
        size.append(readable, exact);
        row.append(name, status, size);
        elements.localModelRows.append(row);
      });
    }
    const localVersion = local.packageVersion ? ` · Whisper ${local.packageVersion}` : "";
    elements.localModelsSummary.textContent = local.modelCount
      ? `${local.modelCount} 個模型 · ${formatBytes(local.totalSizeBytes)}${localVersion}`
      : "0 個模型";

    elements.apiModelRows.replaceChildren();
    api.models.forEach((model) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "model-name";
      name.textContent = model.name;
      const status = document.createElement("td");
      status.append(createModelStatus(model.installed ? "SDK 已安裝" : "尚未安裝", model.installed ? "ready" : "muted"));
      const apiKey = document.createElement("td");
      apiKey.append(createModelStatus(api.keyConfigured ? "已設定" : "尚未設定", api.keyConfigured ? "ready" : "muted"));
      row.append(name, status, apiKey);
      elements.apiModelRows.append(row);
    });
    const apiVersion = api.packageVersion ? ` · ${api.packageVersion}` : "";
    elements.apiModelsSummary.textContent = `${api.providerInstalled ? "SDK 已安裝" : "SDK 尚未安裝"}${apiVersion} · API Key ${api.keyConfigured ? "已設定" : "尚未設定"}`;
  }

  async function loadModels() {
    setModelMessage(elements.localModelRows, "正在讀取 workspace");
    setModelMessage(elements.apiModelRows, "正在讀取 workspace");
    elements.localModelsSummary.textContent = "正在確認安裝狀態";
    elements.apiModelsSummary.textContent = "正在確認安裝狀態";
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderModels(await response.json());
    } catch (error) {
      setModelMessage(elements.localModelRows, "目前無法讀取本機模型");
      setModelMessage(elements.apiModelRows, "目前無法讀取 API 模型");
      elements.localModelsSummary.textContent = "讀取失敗";
      elements.apiModelsSummary.textContent = "讀取失敗";
    }
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf()) ? DATE_FORMAT.format(date) : "—";
  }

  function toneFor(job) {
    const current = job.effectiveState || job.state;
    if (ACTIVE.has(current)) return "active";
    if (current === "ready") return "ready";
    if (current === "failed") return "failed";
    if (ATTENTION.has(current)) return "attention";
    return "neutral";
  }

  function matchesFilter(job) {
    const current = job.effectiveState || job.state;
    if (state.filter === "active") return ACTIVE.has(current);
    if (state.filter === "attention") return ATTENTION.has(current);
    if (state.filter === "watchable") return job.watchable;
    if (state.filter === "ready") return current === "ready";
    return true;
  }

  function renderMetrics() {
    const totalSize = state.jobs.reduce((sum, job) => sum + (Number(job.sizeBytes) || 0), 0);
    $("#metric-total").textContent = state.jobs.length;
    elements.navLibraryCount.textContent = state.jobs.length;
    $("#metric-active").textContent = state.jobs.filter((job) => ACTIVE.has(job.effectiveState || job.state)).length;
    $("#metric-attention").textContent = state.jobs.filter((job) => ATTENTION.has(job.effectiveState || job.state)).length;
    $("#metric-watchable").textContent = state.jobs.filter((job) => job.watchable).length;
    $("#metric-storage").textContent = formatBytes(totalSize);
  }

  function openUsageExample(trigger) {
    state.exampleTrigger = trigger;
    if (!elements.exampleDialog.open) elements.exampleDialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function closeUsageExample() {
    if (!elements.exampleDialog.open) return;
    elements.exampleDialog.close();
    syncDialogOpenState();
    state.exampleTrigger?.focus();
    state.exampleTrigger = null;
  }

  function renderMyPrompts(prompts) {
    elements.myPromptsList.replaceChildren();
    elements.myPromptsCount.textContent = `${prompts.length} PROMPTS · READ ONLY`;
    if (!prompts.length) {
      elements.myPromptsList.innerHTML = '<div class="my-prompts-empty"><div><strong>還沒有自訂提示</strong><span>複製下方的新增指令，和 Agent 一起建立第一則。</span></div></div>';
      return;
    }
    prompts.forEach((prompt, index) => {
      const card = document.createElement("article");
      card.className = "my-prompt-card";
      card.innerHTML = `
        <div>
          <span>${String(index + 1).padStart(2, "0")} / ${escapeHtml(prompt.id)}</span>
          <h4>${escapeHtml(prompt.title)}</h4>
          <p>${escapeHtml(prompt.scenario)}</p>
        </div>
        <div class="advanced-prompt-block">
          <code>${escapeHtml(prompt.prompt)}</code>
          <button class="copy-advanced-prompt" type="button" data-copy-prompt><span>複製提示</span></button>
        </div>`;
      elements.myPromptsList.append(card);
    });
  }

  async function loadMyPrompts() {
    elements.myPromptsCount.textContent = "LOADING";
    try {
      const response = await fetch("/api/prompts", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.available || !Array.isArray(payload.prompts)) throw new Error(payload.message || "prompt library unavailable");
      renderMyPrompts(payload.prompts);
    } catch (error) {
      elements.myPromptsCount.textContent = "UNAVAILABLE";
      elements.myPromptsList.innerHTML = '<div class="my-prompts-empty"><div><strong>目前無法讀取我的提示</strong><span>請 Agent 檢查 workspace 的 prompts.json。</span></div></div>';
    }
  }

  function openAdvancedUsage(trigger) {
    state.advancedTrigger = trigger;
    if (!elements.advancedDialog.open) elements.advancedDialog.showModal();
    document.body.classList.add("dialog-open");
    loadMyPrompts();
  }

  function closeAdvancedUsage() {
    if (!elements.advancedDialog.open) return;
    elements.advancedDialog.close();
    syncDialogOpenState();
    state.advancedTrigger?.focus();
    state.advancedTrigger = null;
  }

  function openModels(trigger) {
    state.modelsTrigger = trigger;
    if (!elements.modelsDialog.open) elements.modelsDialog.showModal();
    document.body.classList.add("dialog-open");
    loadModels();
  }

  function closeModels() {
    if (!elements.modelsDialog.open) return;
    elements.modelsDialog.close();
    syncDialogOpenState();
    state.modelsTrigger?.focus();
    state.modelsTrigger = null;
  }

  function syncEnvironmentButtons() {
    elements.saveEnvironment.disabled = state.environmentSaving || !elements.environmentValue.value.trim();
    elements.clearEnvironment.disabled = state.environmentSaving || !state.environmentConfigured;
  }

  function renderEnvironmentStatus(payload) {
    const variable = Array.isArray(payload?.variables)
      ? payload.variables.find((item) => item.name === "OPENAI_API_KEY")
      : null;
    if (!variable) throw new Error("environment status unavailable");
    state.environmentConfigured = Boolean(variable.configured);
    elements.environmentVariableStatus.textContent = variable.configured
      ? (variable.source === "startup" ? "啟動時已設定" : "本次服務已設定")
      : "尚未設定";
    elements.environmentVariableStatus.dataset.tone = variable.configured ? "ready" : "muted";
    elements.environmentProviderStatus.textContent = variable.providerInstalled
      ? "OpenAI SDK 已安裝"
      : "OpenAI SDK 尚未安裝";
    syncEnvironmentButtons();
  }

  async function loadEnvironmentStatus({ silent = false } = {}) {
    if (state.environmentLoading) return;
    state.environmentLoading = true;
    if (!silent) {
      elements.environmentVariableStatus.textContent = "正在確認";
      elements.environmentVariableStatus.dataset.tone = "muted";
      elements.environmentProviderStatus.textContent = "";
    }
    try {
      const response = await fetch("/api/environment", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderEnvironmentStatus(await response.json());
    } catch (error) {
      if (!silent) {
        state.environmentConfigured = false;
        elements.environmentVariableStatus.textContent = "無法讀取";
        elements.environmentActionStatus.textContent = "目前無法取得本機服務的環境狀態。";
        syncEnvironmentButtons();
      }
    } finally {
      state.environmentLoading = false;
    }
  }

  function openEnvironment(trigger) {
    state.environmentTrigger = trigger;
    elements.environmentValue.value = "";
    elements.environmentActionStatus.textContent = "";
    if (!elements.environmentDialog.open) elements.environmentDialog.showModal();
    document.body.classList.add("dialog-open");
    syncEnvironmentButtons();
    loadEnvironmentStatus();
  }

  function closeEnvironment() {
    if (!elements.environmentDialog.open) return;
    elements.environmentValue.value = "";
    elements.environmentDialog.close();
    syncDialogOpenState();
    state.environmentTrigger?.focus();
    state.environmentTrigger = null;
  }

  async function saveEnvironment(event) {
    event.preventDefault();
    const value = elements.environmentValue.value.trim();
    if (!value || state.environmentSaving) return;
    state.environmentSaving = true;
    elements.environmentActionStatus.textContent = "正在套用到本次服務";
    syncEnvironmentButtons();
    try {
      const response = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OPENAI_API_KEY", value }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      elements.environmentValue.value = "";
      renderEnvironmentStatus(await response.json());
      elements.environmentActionStatus.textContent = "已套用到本次本機服務。";
    } catch (error) {
      elements.environmentActionStatus.textContent = "無法套用。請確認本機服務仍在運作。";
    } finally {
      state.environmentSaving = false;
      syncEnvironmentButtons();
    }
  }

  async function clearEnvironment() {
    if (!state.environmentConfigured || state.environmentSaving) return;
    state.environmentSaving = true;
    elements.environmentActionStatus.textContent = "正在清除";
    syncEnvironmentButtons();
    try {
      const response = await fetch("/api/environment/OPENAI_API_KEY", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderEnvironmentStatus(await response.json());
      elements.environmentActionStatus.textContent = "已從本次本機服務清除。";
    } catch (error) {
      elements.environmentActionStatus.textContent = "無法清除。請確認本機服務仍在運作。";
    } finally {
      state.environmentSaving = false;
      syncEnvironmentButtons();
    }
  }

  async function copyAdvancedPrompt(button) {
    const prompt = button.closest("article")?.querySelector("code")?.textContent?.trim();
    if (!prompt) return;
    window.clearTimeout(state.advancedCopyTimer);
    if (state.advancedCopyButton && state.advancedCopyButton !== button) {
      state.advancedCopyButton.classList.remove("copied");
      state.advancedCopyButton.querySelector("span").textContent = state.advancedCopyButton.dataset.copyLabel || "複製提示";
    }
    const label = button.querySelector("span");
    button.dataset.copyLabel ||= label.textContent;
    try {
      await navigator.clipboard.writeText(prompt);
      button.classList.add("copied");
      label.textContent = "已複製，交給 Agent";
      elements.advancedCopyStatus.textContent = "提示已複製到剪貼簿。";
      state.advancedCopyButton = button;
      state.advancedCopyTimer = window.setTimeout(() => {
        button.classList.remove("copied");
        label.textContent = button.dataset.copyLabel;
        elements.advancedCopyStatus.textContent = "";
        state.advancedCopyButton = null;
      }, 3200);
    } catch (error) {
      elements.advancedCopyStatus.textContent = "瀏覽器無法自動複製，請手動選取提示文字。";
    }
  }

  function normalizeAccentColor(value) {
    const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
    return match ? `#${match[1].toUpperCase()}` : DEFAULT_ACCENT;
  }

  function applyAccentColor(value, persist = false) {
    const color = normalizeAccentColor(value);
    const rgb = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
    document.documentElement.style.setProperty("--claw", color);
    document.documentElement.style.setProperty("--accent-rgb", rgb.join(" "));
    elements.accentInput.value = color.toLowerCase();
    elements.accentValue.value = color;
    document.querySelectorAll("[data-accent-color]").forEach((button) => {
      button.setAttribute("aria-pressed", String(normalizeAccentColor(button.dataset.accentColor) === color));
    });
    if (persist) {
      try { window.localStorage.setItem(ACCENT_STORAGE_KEY, color); } catch (error) { /* Theme remains active for this page. */ }
    }
  }

  function loadAccentColor() {
    let saved = DEFAULT_ACCENT;
    try { saved = window.localStorage.getItem(ACCENT_STORAGE_KEY) || DEFAULT_ACCENT; } catch (error) { /* Use default. */ }
    applyAccentColor(saved);
  }

  function persistFontSetting(value) {
    try { window.localStorage.setItem(FONT_STORAGE_KEY, value); } catch (error) { /* Font remains active for this page. */ }
  }

  function applyFontSetting(value, persist = false) {
    const googleLinkId = "xeruca-google-font";
    const customMatch = String(value || "").match(/^local:(.+)$/);
    let option = FONT_OPTIONS[value];
    let familyName = "";
    if (customMatch) {
      familyName = customMatch[1];
      option = { label: familyName, family: `"${familyName}", sans-serif` };
    }
    if (!option) {
      value = "system";
      option = FONT_OPTIONS.system;
    }

    let googleLink = document.getElementById(googleLinkId);
    if (option.google) {
      if (!googleLink) {
        googleLink = document.createElement("link");
        googleLink.id = googleLinkId;
        googleLink.rel = "stylesheet";
        document.head.append(googleLink);
      }
      googleLink.href = option.google;
      googleLink.addEventListener("load", () => { elements.fontStatus.textContent = `${option.label} 已載入並套用。`; }, { once: true });
      elements.fontStatus.textContent = `正在載入 ${option.label}……`;
    } else {
      googleLink?.remove();
      elements.fontStatus.textContent = customMatch ? `已套用本機字體 ${option.label}。` : `已套用本機字體 ${option.label}。`;
    }

    document.documentElement.style.setProperty("--ui-font", option.family);
    elements.fontValue.value = option.label;
    elements.fontPreset.value = customMatch ? "custom" : value;
    if (customMatch) elements.localFontInput.value = familyName;
    if (persist) persistFontSetting(customMatch ? `local:${familyName}` : value);
  }

  function applyNamedLocalFont() {
    const name = elements.localFontInput.value.trim();
    if (!name || name.length > 80 || !/^[\p{L}\p{N} ._+-]+$/u.test(name)) {
      elements.fontStatus.textContent = "請輸入有效的本機字體名稱。";
      return;
    }
    if (document.fonts?.check && !document.fonts.check(`16px "${name}"`)) {
      elements.fontStatus.textContent = `找不到本機字體 ${name}，請確認名稱與安裝狀態。`;
      return;
    }
    applyFontSetting(`local:${name}`, true);
  }

  function loadFontSetting() {
    let saved = "system";
    try { saved = window.localStorage.getItem(FONT_STORAGE_KEY) || "system"; } catch (error) { /* Use system font. */ }
    applyFontSetting(saved);
  }

  function openSettings(trigger) {
    state.settingsTrigger = trigger;
    if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function closeSettings() {
    if (!elements.settingsDialog.open) return;
    elements.settingsDialog.close();
    syncDialogOpenState();
    state.settingsTrigger?.focus();
    state.settingsTrigger = null;
  }

  function openLibrary(trigger) {
    state.libraryTrigger = trigger;
    if (!elements.libraryDialog.open) elements.libraryDialog.showModal();
    document.body.classList.add("dialog-open");
    refreshJobs();
  }

  function closeLibrary() {
    if (!elements.libraryDialog.open) return;
    elements.libraryDialog.close();
    syncDialogOpenState();
    state.libraryTrigger?.focus();
    state.libraryTrigger = null;
  }

  function renderRows() {
    const query = state.query.trim().toLocaleLowerCase("zh-Hant");
    const jobs = state.jobs.filter((job) => {
      const haystack = `${job.title} ${job.videoId}`.toLocaleLowerCase("zh-Hant");
      return (!query || haystack.includes(query)) && matchesFilter(job);
    });

    elements.rows.replaceChildren();
    jobs.forEach((job) => {
      const row = elements.template.content.firstElementChild.cloneNode(true);
      const thumbnail = row.querySelector(".thumbnail img");
      if (job.thumbnailUrl) thumbnail.src = job.thumbnailUrl;
      else thumbnail.hidden = true;
      row.querySelector(".job-title").textContent = job.title || job.videoId;
      row.querySelector(".job-id").textContent = job.videoId;
      const badge = row.querySelector(".state-badge");
      const current = job.effectiveState || job.state;
      badge.textContent = STATE_LABELS[current] || current;
      badge.dataset.tone = toneFor(job);
      row.querySelector(".job-message").textContent = job.message || "沒有附加訊息";
      const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
      const progressTrack = row.querySelector(".progress-track");
      progressTrack.style.color = toneFor(job) === "active" ? "var(--blue)" : "var(--signal)";
      progressTrack.querySelector("i").style.width = `${progress}%`;
      if (!ACTIVE.has(current) && progress === 0) progressTrack.hidden = true;
      const chips = row.querySelector(".caption-chips");
      if (job.captionCodes?.length) {
        job.captionCodes.forEach((code) => {
          const chip = document.createElement("span"); chip.textContent = TRACK_LABELS[code] || code; chips.append(chip);
        });
      } else {
        const chip = document.createElement("span"); chip.className = "none"; chip.textContent = "NO VTT"; chips.append(chip);
      }
      row.querySelector(".job-updated").textContent = formatDate(job.updatedAt);
      row.querySelector(".job-size").textContent = formatBytes(job.sizeBytes);
      const watch = row.querySelector(".watch-button");
      watch.disabled = !job.watchable;
      watch.textContent = job.watchable ? "觀看" : "等待";
      watch.addEventListener("click", () => openPlayer(job, watch));
      row.querySelector(".detail-button").addEventListener("click", (event) => openDetail(job.videoId, event.currentTarget));
      elements.rows.append(row);
    });

    elements.empty.hidden = jobs.length > 0;
    elements.tableStatus.textContent = `顯示 ${jobs.length} / ${state.jobs.length} 個項目 · 每 2.5 秒自動同步`;
  }

  function markServer(online) {
    elements.serverLamp.className = `server-lamp ${online ? "online" : "offline"}`;
    elements.serverLabel.textContent = online ? "本機服務運作中" : "本機服務無法連線";
  }

  async function refreshJobs({ manual = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (manual) elements.refresh.classList.add("loading");
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      renderMetrics(); renderRows(); markServer(true);
      elements.lastUpdated.textContent = `LAST SYNC · ${TIME_FORMAT.format(new Date())}`;
      if (elements.environmentDialog.open && !state.environmentSaving) loadEnvironmentStatus({ silent: true });
    } catch (error) {
      markServer(false);
      elements.tableStatus.textContent = `無法讀取影片列表：${error.message}`;
    } finally {
      state.loading = false;
      elements.refresh.classList.remove("loading");
    }
  }

  async function persistPlayback(videoId, time, duration) {
    if (!videoId || !Number.isFinite(time)) return;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(videoId)}/playback`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: Math.max(0, time), duration: Number.isFinite(duration) && duration > 0 ? duration : null }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const saved = await response.json();
      const job = state.jobs.find((item) => item.videoId === videoId);
      if (job) job.playback = saved;
    } catch (error) {
      elements.resumeNote.textContent = `播放進度暫時無法寫入資料夾：${error.message}`;
    }
  }

  function queuePlaybackSave(videoId, time, duration, immediate = false) {
    state.playbackTime = time;
    state.playbackDuration = duration;
    if (immediate) {
      window.clearTimeout(state.playbackSaveTimer);
      state.playbackSaveTimer = 0;
      persistPlayback(videoId, time, duration);
      return;
    }
    if (!state.playbackSaveTimer) {
      state.playbackSaveTimer = window.setTimeout(() => {
        state.playbackSaveTimer = 0;
        persistPlayback(videoId, state.playbackTime, state.playbackDuration);
      }, 5000);
    }
  }

  function openPlayer(job, trigger) {
    if (!job.watchUrl) return;
    window.clearTimeout(state.unloadTimer);
    state.selectedId = job.videoId;
    state.lastFocused = trigger;
    elements.modalTitle.textContent = job.title || job.videoId;
    elements.playerLoading.hidden = false;
    elements.playerFrame.classList.remove("ready");
    elements.playerFrame.src = job.watchUrl;
    elements.modalCaption.replaceChildren(new Option("關閉", "off"));
    job.captionCodes?.forEach((code) => elements.modalCaption.add(new Option(TRACK_LABELS[code] || code, code)));
    elements.modalCaption.value = job.captionCodes?.includes("zh-TW") ? "zh-TW" : (job.captionCodes?.includes("en") ? "en" : (job.captionCodes?.[0] || "off"));
    const saved = Number(job.playback?.time) || 0;
    state.playbackTime = saved;
    state.playbackDuration = Number(job.playback?.duration) || null;
    elements.resumeNote.textContent = saved > 10 ? `上次看到 ${formatDuration(saved)}，載入後將接續播放` : "播放進度保存在這個影片的資料夾內";
    elements.playerDialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function closePlayer() {
    if (!elements.playerDialog.open) return;
    if (state.selectedId && Number.isFinite(state.playbackTime)) {
      queuePlaybackSave(state.selectedId, state.playbackTime, state.playbackDuration, true);
    }
    elements.playerFrame.contentWindow?.postMessage({ type: "player:dispose" }, location.origin);
    elements.playerDialog.close();
    state.unloadTimer = window.setTimeout(() => {
      if (!elements.playerDialog.open) elements.playerFrame.removeAttribute("src");
    }, 120);
    elements.playerFrame.classList.remove("ready");
    state.selectedId = null;
    state.playbackTime = 0;
    state.playbackDuration = null;
    syncDialogOpenState();
    state.lastFocused?.focus();
  }

  function formatDuration(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
  }

  async function openDetail(videoId, trigger) {
    state.lastFocused = trigger;
    elements.detailTitle.textContent = videoId;
    elements.detailContent.innerHTML = '<div class="player-loading"><i></i><span>正在讀取任務紀錄</span></div>';
    if (!elements.detailDialog.open) elements.detailDialog.showModal();
    document.body.classList.add("dialog-open");
    try {
      const [jobResponse, logResponse] = await Promise.all([fetch(`/api/jobs/${encodeURIComponent(videoId)}`, { cache: "no-store" }), fetch(`/api/jobs/${encodeURIComponent(videoId)}/log?lines=180`, { cache: "no-store" })]);
      if (!jobResponse.ok) throw new Error(`任務資料 HTTP ${jobResponse.status}`);
      const job = await jobResponse.json();
      const logPayload = logResponse.ok ? await logResponse.json() : { log: "" };
      elements.detailTitle.textContent = job.title || videoId;
      const history = Array.isArray(job.history) ? [...job.history].reverse() : [];
      elements.detailContent.innerHTML = `
        <div class="detail-summary">
          <div><span>VIDEO ID</span><strong>${escapeHtml(job.videoId)}</strong></div>
          <div><span>STATUS</span><strong>${escapeHtml(STATE_LABELS[job.effectiveState] || job.effectiveState)}</strong></div>
          <div><span>STORAGE</span><strong>${escapeHtml(formatBytes(job.sizeBytes))}</strong></div>
          <div><span>STAGE</span><strong>${escapeHtml(job.stage || "—")}</strong></div>
          <div><span>TRANSCRIBER</span><strong>${escapeHtml(job.transcription ? `${job.transcription.provider} / ${job.transcription.model}` : "—")}</strong></div>
          <div><span>CAPTIONS</span><strong>${escapeHtml(job.captionCodes?.join(", ") || "尚無")}</strong></div>
          <div><span>UPDATED</span><strong>${escapeHtml(formatDate(job.updatedAt))}</strong></div>
        </div>
        ${job.lastError ? `<section class="detail-section"><h3>Last error</h3><p class="error-copy">${escapeHtml(job.lastError)}</p></section>` : ""}
        <section class="detail-section"><h3>State history</h3><ol class="history-list">${history.map((item) => `<li><time>${escapeHtml(formatDate(item.at))}</time><b>${escapeHtml(STATE_LABELS[item.state] || item.state || "—")}</b><span>${escapeHtml(item.message || "")}</span></li>`).join("") || "<li>尚無紀錄</li>"}</ol></section>
        <section class="detail-section"><h3>Workflow log · last 180 lines</h3><pre class="log-view">${escapeHtml(logPayload.log || "尚無執行紀錄")}</pre></section>`;
    } catch (error) {
      elements.detailContent.innerHTML = `<p class="error-copy">讀取失敗：${escapeHtml(error.message)}</p>`;
    }
  }

  function closeDetail() {
    if (!elements.detailDialog.open) return;
    elements.detailDialog.close();
    elements.detailContent.replaceChildren();
    syncDialogOpenState();
    state.lastFocused?.focus();
  }

  function renderSupportedSites() {
    if (!state.extractorsLoaded) return;
    const query = state.sourceQuery.trim().toLocaleLowerCase("en");
    const matches = state.extractors.filter((name) => !query || name.toLocaleLowerCase("en").includes(query));
    elements.sourceList.replaceChildren();
    if (matches.length) {
      const fragment = document.createDocumentFragment();
      matches.forEach((name) => {
        const item = document.createElement("li");
        item.textContent = name;
        fragment.append(item);
      });
      elements.sourceList.append(fragment);
    } else {
      const item = document.createElement("li");
      item.className = "source-list-empty";
      item.textContent = "找不到這個平台。把網址交給 Agent，請 INSU PLAYER 研究看看。";
      elements.sourceList.append(item);
    }
    elements.sourceList.hidden = false;
    elements.sourceListStatus.textContent = `顯示 ${matches.length} / ${state.extractors.length} 個網站解析器`;
  }

  async function loadSupportedSites() {
    if (state.extractorsLoaded || state.extractorsLoading) return;
    state.extractorsLoading = true;
    elements.sourceListLoading.hidden = false;
    elements.sourceListUnavailable.hidden = true;
    elements.sourceList.hidden = true;
    try {
      const response = await fetch("/api/supported-sites", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.available || !Array.isArray(payload.extractors)) {
        elements.ytDlpVersion.textContent = "YT-DLP NOT INSTALLED";
        elements.sourceListStatus.textContent = "完成環境設定後顯示完整清單";
        elements.sourceListUnavailable.hidden = false;
        return;
      }
      state.extractors = payload.extractors.map(String);
      state.extractorsLoaded = true;
      elements.ytDlpVersion.textContent = payload.version ? `YT-DLP ${payload.version}` : "YT-DLP INSTALLED";
      renderSupportedSites();
    } catch (error) {
      elements.ytDlpVersion.textContent = "DISCOVERY UNAVAILABLE";
      elements.sourceListStatus.textContent = "暫時無法取得網站解析器清單";
      elements.sourceListUnavailable.hidden = false;
    } finally {
      state.extractorsLoading = false;
      elements.sourceListLoading.hidden = true;
    }
  }

  function openSupportedSites(trigger) {
    state.supportedSitesTrigger = trigger;
    elements.supportedSitesDialog.showModal();
    document.body.classList.add("dialog-open");
    loadSupportedSites();
  }

  function closeSupportedSites() {
    if (!elements.supportedSitesDialog.open) return;
    elements.supportedSitesDialog.close();
    syncDialogOpenState();
    state.supportedSitesTrigger?.focus();
    state.supportedSitesTrigger = null;
  }

  function hasAcceptedUsagePolicy() {
    try {
      return window.localStorage.getItem(POLICY_STORAGE_KEY) === "accepted";
    } catch (error) {
      return false;
    }
  }

  function openUsagePolicy(trigger = null, required = false) {
    state.policyTrigger = trigger;
    state.policyRequired = required;
    elements.policyDialog.dataset.required = String(required);
    elements.closePolicy.hidden = required;
    elements.acceptPolicy.textContent = required ? "我了解並同意" : "關閉規範";
    if (!elements.policyDialog.open) elements.policyDialog.showModal();
    document.body.classList.add("dialog-open");
  }

  function closeUsagePolicy(force = false) {
    if (!elements.policyDialog.open || (state.policyRequired && !force)) return;
    elements.policyDialog.close();
    syncDialogOpenState();
    state.policyTrigger?.focus();
    state.policyTrigger = null;
    state.policyRequired = false;
    delete elements.policyDialog.dataset.required;
  }

  function acceptOrCloseUsagePolicy() {
    if (state.policyRequired) {
      try {
        window.localStorage.setItem(POLICY_STORAGE_KEY, "accepted");
      } catch (error) {
        // Browsers that block local storage will ask again on the next visit.
      }
    }
    closeUsagePolicy(true);
  }

  async function copyYouTubePrompt() {
    window.clearTimeout(state.copyStatusTimer);
    try {
      await navigator.clipboard.writeText(YOUTUBE_PROMPT);
      elements.copyPrompt.classList.add("copied");
      elements.copyPrompt.querySelector("span").textContent = "已複製，貼回 Agent";
      elements.copyStatus.textContent = "YouTube 範例已複製到剪貼簿。";
      state.copyStatusTimer = window.setTimeout(() => {
        elements.copyPrompt.classList.remove("copied");
        elements.copyPrompt.querySelector("span").textContent = "複製 YouTube 範例";
        elements.copyStatus.textContent = "";
      }, 3200);
    } catch (error) {
      elements.copyStatus.textContent = "瀏覽器無法自動複製。請手動選取右側的 YouTube 範例。";
    }
  }

  async function copyResearchPrompt() {
    window.clearTimeout(state.researchCopyTimer);
    try {
      await navigator.clipboard.writeText(RESEARCH_PROMPT);
      elements.copyResearchPrompt.textContent = "已複製，交給 Agent";
      elements.researchCopyStatus.textContent = "研究指令已複製。";
      state.researchCopyTimer = window.setTimeout(() => {
        elements.copyResearchPrompt.textContent = "複製研究指令";
        elements.researchCopyStatus.textContent = "";
      }, 3200);
    } catch (error) {
      elements.researchCopyStatus.textContent = "無法自動複製，請手動選取上方研究指令。";
    }
  }

  function closeOnBackdrop(dialog, close) {
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== elements.playerFrame.contentWindow || !state.selectedId) return;
    const message = event.data || {};
    if (message.videoId && message.videoId !== state.selectedId) return;
    if (message.type === "player:ready") {
      elements.playerLoading.hidden = true;
      elements.playerFrame.classList.add("ready");
      const saved = state.playbackTime;
      if (saved > 10 && (!Number.isFinite(message.duration) || saved < message.duration - 15)) {
        elements.playerFrame.contentWindow?.postMessage({ type: "player:seek", time: saved }, location.origin);
      }
      elements.playerFrame.contentWindow?.postMessage({ type: "player:set-caption", language: elements.modalCaption.value }, location.origin);
    }
    if (message.type === "player:time" && Number.isFinite(message.time)) {
      queuePlaybackSave(state.selectedId, message.time, message.duration);
    }
    if (message.type === "player:paused" && Number.isFinite(message.time)) {
      queuePlaybackSave(state.selectedId, message.time, message.duration, true);
    }
    if (message.type === "player:ended") {
      queuePlaybackSave(state.selectedId, 0, message.duration, true);
    }
    if (message.type === "player:error") {
      elements.playerLoading.hidden = true;
      elements.playerFrame.classList.add("ready");
      elements.resumeNote.textContent = "影片載入失敗。請查看處理紀錄與 codec 資訊";
    }
  });

  elements.search.addEventListener("input", () => { state.query = elements.search.value; renderRows(); });
  elements.filter.addEventListener("change", () => { state.filter = elements.filter.value; renderRows(); });
  elements.refresh.addEventListener("click", () => refreshJobs({ manual: true }));
  elements.openExample.addEventListener("click", (event) => openUsageExample(event.currentTarget));
  elements.openExampleNav.addEventListener("click", (event) => openUsageExample(event.currentTarget));
  elements.closeExample.addEventListener("click", closeUsageExample);
  elements.openAdvanced.addEventListener("click", (event) => openAdvancedUsage(event.currentTarget));
  elements.closeAdvanced.addEventListener("click", closeAdvancedUsage);
  elements.advancedContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-prompt]");
    if (button) copyAdvancedPrompt(button);
  });
  elements.openModels.addEventListener("click", (event) => openModels(event.currentTarget));
  elements.closeModels.addEventListener("click", closeModels);
  elements.openSettings.addEventListener("click", (event) => openSettings(event.currentTarget));
  elements.closeSettings.addEventListener("click", closeSettings);
  elements.openEnvironment.addEventListener("click", (event) => openEnvironment(event.currentTarget));
  elements.closeEnvironment.addEventListener("click", closeEnvironment);
  elements.environmentForm.addEventListener("submit", saveEnvironment);
  elements.environmentValue.addEventListener("input", syncEnvironmentButtons);
  elements.clearEnvironment.addEventListener("click", clearEnvironment);
  document.querySelectorAll("[data-accent-color]").forEach((button) => button.addEventListener("click", () => applyAccentColor(button.dataset.accentColor, true)));
  elements.accentInput.addEventListener("input", () => applyAccentColor(elements.accentInput.value, true));
  elements.resetAccent.addEventListener("click", () => applyAccentColor(DEFAULT_ACCENT, true));
  elements.fontPreset.addEventListener("change", () => {
    if (elements.fontPreset.value !== "custom") applyFontSetting(elements.fontPreset.value, true);
  });
  elements.applyLocalFont.addEventListener("click", applyNamedLocalFont);
  elements.localFontInput.addEventListener("keydown", (event) => { if (event.key === "Enter") applyNamedLocalFont(); });
  elements.openLibrary.addEventListener("click", (event) => openLibrary(event.currentTarget));
  elements.closeLibrary.addEventListener("click", closeLibrary);
  elements.copyPrompt.addEventListener("click", copyYouTubePrompt);
  elements.copyResearchPrompt.addEventListener("click", copyResearchPrompt);
  elements.openSupportedSites.addEventListener("click", (event) => openSupportedSites(event.currentTarget));
  elements.openPolicy.addEventListener("click", (event) => openUsagePolicy(event.currentTarget, false));
  elements.closePolicy.addEventListener("click", () => closeUsagePolicy());
  elements.acceptPolicy.addEventListener("click", acceptOrCloseUsagePolicy);
  elements.sourceSearch.addEventListener("input", () => { state.sourceQuery = elements.sourceSearch.value; renderSupportedSites(); });
  elements.modalCaption.addEventListener("change", () => {
    elements.playerFrame.contentWindow?.postMessage({ type: "player:set-caption", language: elements.modalCaption.value }, location.origin);
  });
  $("#close-player").addEventListener("click", closePlayer);
  $("#close-detail").addEventListener("click", closeDetail);
  $("#close-supported-sites").addEventListener("click", closeSupportedSites);
  $("#show-detail-from-player").addEventListener("click", () => {
    const videoId = state.selectedId; const returnFocus = state.lastFocused; closePlayer(); if (videoId) openDetail(videoId, returnFocus);
  });
  elements.playerDialog.addEventListener("cancel", (event) => { event.preventDefault(); closePlayer(); });
  elements.exampleDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeUsageExample(); });
  elements.advancedDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeAdvancedUsage(); });
  elements.modelsDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeModels(); });
  elements.settingsDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeSettings(); });
  elements.environmentDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeEnvironment(); });
  elements.libraryDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeLibrary(); });
  elements.detailDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDetail(); });
  elements.supportedSitesDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeSupportedSites(); });
  elements.policyDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeUsagePolicy(); });
  closeOnBackdrop(elements.playerDialog, closePlayer);
  closeOnBackdrop(elements.exampleDialog, closeUsageExample);
  closeOnBackdrop(elements.advancedDialog, closeAdvancedUsage);
  closeOnBackdrop(elements.modelsDialog, closeModels);
  closeOnBackdrop(elements.settingsDialog, closeSettings);
  closeOnBackdrop(elements.environmentDialog, closeEnvironment);
  closeOnBackdrop(elements.libraryDialog, closeLibrary);
  closeOnBackdrop(elements.detailDialog, closeDetail);
  closeOnBackdrop(elements.supportedSitesDialog, closeSupportedSites);
  closeOnBackdrop(elements.policyDialog, closeUsagePolicy);

  loadAccentColor();
  loadFontSetting();
  elements.footerYear.textContent = String(new Date().getFullYear());
  refreshJobs();
  state.pollTimer = window.setInterval(refreshJobs, 2500);
  if (!hasAcceptedUsagePolicy()) window.setTimeout(() => openUsagePolicy(null, true), 0);
})();
