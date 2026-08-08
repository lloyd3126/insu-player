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
  const DATE_FORMAT = new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const TIME_FORMAT = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const state = {
    jobs: [], query: "", filter: "all", selectedId: null, pollTimer: 0, unloadTimer: 0,
    playbackSaveTimer: 0, playbackTime: 0, playbackDuration: null, loading: false, lastFocused: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    rows: $("#job-rows"), template: $("#job-row-template"), empty: $("#empty-state"), tableStatus: $("#table-status"),
    search: $("#search-input"), filter: $("#state-filter"), refresh: $("#refresh-button"), serverLamp: $("#server-lamp"),
    serverLabel: $("#server-label"), serverTime: $("#server-time"), lastUpdated: $("#last-updated"),
    playerDialog: $("#player-dialog"), playerFrame: $("#player-frame"), playerLoading: $("#player-loading"),
    modalTitle: $("#modal-title"), resumeNote: $("#resume-note"), detailDialog: $("#detail-dialog"), detailTitle: $("#detail-title"), detailContent: $("#detail-content"),
    modalCaption: $("#modal-caption-language"),
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
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
    $("#metric-active").textContent = state.jobs.filter((job) => ACTIVE.has(job.effectiveState || job.state)).length;
    $("#metric-attention").textContent = state.jobs.filter((job) => ATTENTION.has(job.effectiveState || job.state)).length;
    $("#metric-watchable").textContent = state.jobs.filter((job) => job.watchable).length;
    $("#metric-storage").textContent = formatBytes(totalSize);
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

  function markServer(online, serverTime) {
    elements.serverLamp.className = `server-lamp ${online ? "online" : "offline"}`;
    elements.serverLabel.textContent = online ? "本機服務運作中" : "本機服務無法連線";
    elements.serverTime.textContent = serverTime ? TIME_FORMAT.format(new Date(serverTime)) : "";
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
      renderMetrics(); renderRows(); markServer(true, payload.serverTime);
      elements.lastUpdated.textContent = `LAST SYNC · ${TIME_FORMAT.format(new Date())}`;
    } catch (error) {
      markServer(false);
      elements.tableStatus.textContent = `無法讀取影片庫：${error.message}`;
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
    document.body.classList.toggle("dialog-open", elements.detailDialog.open);
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
    document.body.classList.toggle("dialog-open", elements.playerDialog.open);
    state.lastFocused?.focus();
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
      elements.resumeNote.textContent = "影片載入失敗；請查看處理紀錄與 codec 資訊";
    }
  });

  elements.search.addEventListener("input", () => { state.query = elements.search.value; renderRows(); });
  elements.filter.addEventListener("change", () => { state.filter = elements.filter.value; renderRows(); });
  elements.refresh.addEventListener("click", () => refreshJobs({ manual: true }));
  elements.modalCaption.addEventListener("change", () => {
    elements.playerFrame.contentWindow?.postMessage({ type: "player:set-caption", language: elements.modalCaption.value }, location.origin);
  });
  $("#close-player").addEventListener("click", closePlayer);
  $("#close-detail").addEventListener("click", closeDetail);
  $("#show-detail-from-player").addEventListener("click", () => {
    const videoId = state.selectedId; const returnFocus = state.lastFocused; closePlayer(); if (videoId) openDetail(videoId, returnFocus);
  });
  elements.playerDialog.addEventListener("cancel", (event) => { event.preventDefault(); closePlayer(); });
  elements.detailDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDetail(); });
  closeOnBackdrop(elements.playerDialog, closePlayer);
  closeOnBackdrop(elements.detailDialog, closeDetail);

  refreshJobs();
  state.pollTimer = window.setInterval(refreshJobs, 2500);
})();
