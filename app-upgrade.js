(() => {
  "use strict";

  const deck = window.__TAM_BAO_DECK__;
  if (!Array.isArray(deck) || !deck.length) return;

  const $ = (id) => document.getElementById(id);
  const languages = {
    zh: { label: "繁體中文", short: "Traditional Chinese" },
    en: { label: "US English", short: "Natural U.S. English" },
    vi: { label: "Tiếng Việt", short: "Vietnamese" },
    yue: { label: "香港廣東話", short: "Hong Kong Cantonese" },
  };
  const editStorageKey = "tam-bao-2026-passage-edits-v1";
  const obsStorageKey = "tam-bao-2026-obs-settings-v1";
  const editorContextRepairKey = "tam-bao-2026-editor-context-repair-v1";
  let saveTimer = 0;
  let obsToolsCollapseTimer = 0;
  let obsAudioQueue = [];
  let obsAudioQueueIndex = -1;
  let obsAudioQueueActive = false;
  let obsAudioPlayAll = false;
  let obsAudioAdvancePending = false;
  let obsAudioPreferredLanguage = "zh";
  let editingStore = readJson(editStorageKey, {});
  let editorContext = { index: 0, language: "zh" };
  let obsSecondMonitorWindow = null;

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function activeLanguage() {
    return document.querySelector(".languages [data-lang].active")?.dataset.lang || "zh";
  }

  function activeIndex() {
    return Math.max(0, Math.min(deck.length - 1, Number($("passage")?.value || 0)));
  }

  function applyStoredEdits() {
    deck.forEach((slide) => {
      const saved = editingStore[slide.id];
      if (!saved) return;
      Object.keys(languages).forEach((language) => {
        if (typeof saved[language] === "string") slide.body[language] = saved[language];
      });
    });
  }

  function repairCorruptedChineseEdits() {
    try {
      if (localStorage.getItem(editorContextRepairKey) === "done") return;
      const originalChineseById = new Map(deck.map((slide) => [String(slide.id), slide.body.zh || ""]));
      const originalChineseValues = new Map();
      deck.forEach((slide) => {
        const value = slide.body.zh || "";
        const ids = originalChineseValues.get(value) || new Set();
        ids.add(String(slide.id));
        originalChineseValues.set(value, ids);
      });
      const savedChineseCounts = new Map();
      Object.values(editingStore).forEach((saved) => {
        if (typeof saved?.zh !== "string") return;
        savedChineseCounts.set(saved.zh, (savedChineseCounts.get(saved.zh) || 0) + 1);
      });
      let repaired = false;
      Object.entries(editingStore).forEach(([id, saved]) => {
        if (typeof saved?.zh !== "string") return;
        const ownOriginal = originalChineseById.get(id);
        const sourceIds = originalChineseValues.get(saved.zh);
        const copiedFromAnotherPage = sourceIds && !sourceIds.has(id);
        const duplicatedAcrossSavedPages = (savedChineseCounts.get(saved.zh) || 0) > 1;
        if (saved.zh !== ownOriginal && (copiedFromAnotherPage || duplicatedAcrossSavedPages)) {
          delete saved.zh;
          if (!Object.keys(saved).length) delete editingStore[id];
          repaired = true;
        }
      });
      if (repaired) writeJson(editStorageKey, editingStore);
      localStorage.setItem(editorContextRepairKey, "done");
    } catch { /* Keep the app usable if local storage is unavailable. */ }
  }

  function updateSaveBadge(state, message) {
    const badge = $("autosaveBadge");
    if (!badge) return;
    badge.classList.toggle("saving", state === "saving");
    badge.classList.toggle("error", state === "error");
    badge.textContent = message;
  }

  function saveCurrentEditor({ immediate = false } = {}) {
    const editor = $("text");
    if (!editor) return;
    const index = Math.max(0, Math.min(deck.length - 1, editorContext.index));
    const language = languages[editorContext.language] ? editorContext.language : "zh";
    const slide = deck[index];
    const value = editor.value;
    slide.body[language] = value;
    editingStore[slide.id] ||= {};
    editingStore[slide.id][language] = value;
    updateSaveBadge("saving", "Saving…");
    clearTimeout(saveTimer);
    const commit = () => {
      const saved = writeJson(editStorageKey, editingStore);
      updateSaveBadge(saved ? "saved" : "error", saved ? "Saved locally" : "Unable to save");
    };
    if (immediate) commit();
    else saveTimer = window.setTimeout(commit, 260);
  }

  function refreshCurrentPassage() {
    const selector = $("passage");
    if (!selector) return;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function syncEditorContext() {
    editorContext = { index: activeIndex(), language: activeLanguage() };
  }

  repairCorruptedChineseEdits();
  applyStoredEdits();
  syncEditorContext();
  addPlayAllFromHereControls();

  const header = document.querySelector("header");
  if (header) {
    const badge = document.createElement("span");
    badge.id = "autosaveBadge";
    badge.className = "autosaveBadge";
    badge.textContent = "Saved locally";
    header.insertBefore(badge, $("themeToggle") || null);
  }

  const editor = $("text");
  editor?.addEventListener("input", () => {
    saveCurrentEditor();
    renderObsStage();
  });
  editor?.addEventListener("blur", () => saveCurrentEditor({ immediate: true }));

  const navigationTargets = [
    $("passage"), $("previous"), $("next"), $("readingPrevious"), $("readingNext"), $("readingPageSelect"),
    $("readingBottomPrevious"), $("readingBottomNext"), $("readingPreviousPlayer"), $("readingPlayNext"),
    $("livePlayerPrevious"), $("liveReadNext"), $("editLock"),
    ...document.querySelectorAll("[data-lang],[data-section]"),
  ].filter(Boolean);
  navigationTargets.forEach((element) => {
    ["click", "change"].forEach((eventName) => {
      element.addEventListener(eventName, () => saveCurrentEditor({ immediate: true }), true);
      element.addEventListener(eventName, () => window.setTimeout(syncEditorContext, 0));
    });
  });
  window.addEventListener("pagehide", () => saveCurrentEditor({ immediate: true }));

  buildObsStudio();
  requestAnimationFrame(() => {
    refreshCurrentPassage();
    renderObsStage();
  });

  function addPlayAllFromHereControls() {
    const addButton = (barId, buttonId, onPlay) => {
      const bar = $(barId);
      if (!bar || $(buttonId)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.id = buttonId;
      button.className = "playAllFromHereButton";
      button.setAttribute("aria-label", "Play all from current passage");
      button.title = "Play all · Start here";
      button.textContent = "▶ All from here";
      const stopButton = bar.querySelector('[aria-label="Stop"]');
      bar.insertBefore(button, stopButton || null);
      button.addEventListener("click", onPlay);
    };

    addButton("livePlayerBar", "livePlayAllFromHere", () => {
      const scope = $("livePlayScope");
      if (scope) {
        scope.value = "document";
        scope.dispatchEvent(new Event("change", { bubbles: true }));
      }
      $("listen")?.click();
    });

    addButton("readingPlayerBar", "readingPlayAllFromHere", () => {
      const scope = $("readingPlayScope");
      if (scope) {
        scope.value = "document";
        scope.dispatchEvent(new Event("change", { bubbles: true }));
      }
      $("readingPlay")?.click();
    });
  }

  function buildObsStudio() {
    const tabs = document.querySelector(".workspaceTabs");
    const card = document.querySelector(".card");
    const readingView = $("readingView");
    if (!tabs || !card || !readingView) return;

    const obsTab = document.createElement("button");
    obsTab.type = "button";
    obsTab.id = "obsTab";
    obsTab.setAttribute("role", "tab");
    obsTab.setAttribute("aria-selected", "false");
    obsTab.setAttribute("aria-controls", "obsView");
    obsTab.textContent = "OBS Studio";
    tabs.append(obsTab);

    const obsView = document.createElement("section");
    obsView.id = "obsView";
    obsView.className = "obsView";
    obsView.setAttribute("role", "tabpanel");
    obsView.setAttribute("aria-labelledby", "obsTab");
    obsView.hidden = true;
    obsView.innerHTML = `
      <details class="obsToolDrawer" id="obsToolDrawer">
        <summary>OBS tools · Pull down when needed</summary>
        <div class="obsToolDrawerBody">
          <div class="obsUtilitySlot" id="obsUtilitySlot"></div>
      <div class="obsStudioHeader">
        <div><h2>OBS Presentation Studio</h2><p>Professional 16:9 multilingual captions with synchronized passage and audio controls.</p></div>
        <span class="obsLiveBadge">OBS READY</span>
      </div>
      <div class="obsControlGrid">
        <label class="obsSpan4"><span>Passage</span><select id="obsPassage" aria-label="OBS passage"></select></label>
        <label class="obsSpan2"><span>Caption layout</span><select id="obsLayout"><option value="stacked">Stacked</option><option value="columns">Two columns</option><option value="speaker-image">Speaker text left · Image right</option></select></label>
        <label class="obsSpan2"><span>Background</span><select id="obsBackground"><option value="image">Cinematic image</option><option value="black">Black</option><option value="green">Chroma green</option><option value="transparent">Transparent</option></select></label>
        <label class="obsSpan2"><span>Caption font size · <strong id="obsFontSizeValue">34px</strong></span><input id="obsFontSize" type="range" min="10" max="54" step="1" value="34"></label>
        <label class="obsSpan2"><span>Audio queue starts with</span><select id="obsAudioLanguage"><option value="zh">繁體中文</option><option value="en">US English</option><option value="vi">Tiếng Việt</option><option value="yue">香港廣東話</option></select></label>
        <label class="obsSpan2"><span>Text box width · <strong id="obsBoxWidthValue">100%</strong></span><input id="obsBoxWidth" type="range" min="60" max="100" step="1" value="100"></label>
        <label class="obsSpan2"><span>Text box height · <strong id="obsBoxHeightValue">100%</strong></span><input id="obsBoxHeight" type="range" min="50" max="100" step="1" value="100"></label>
        <label class="obsToggle obsSpan2"><span>Complete text</span><span><input id="obsAutoFit" type="checkbox" checked> Auto-fit complete text</span></label>
        <label class="obsToggle obsSpan2"><span>Maximum text area</span><span><input id="obsTextFocus" type="checkbox" checked> Expand text area</span></label>
        <div class="obsControlGroup obsSpan6"><span>Caption languages · select one or more</span><div class="obsLanguageChecks">
          <label><input type="checkbox" data-obs-lang="zh" checked>繁體中文</label>
          <label><input type="checkbox" data-obs-lang="en" checked>US English</label>
          <label><input type="checkbox" data-obs-lang="vi">Tiếng Việt</label>
          <label><input type="checkbox" data-obs-lang="yue">香港廣東話</label>
        </div></div>
        <label class="obsSpan3"><span>Voice source</span><select id="obsAudioSource"><option value="auto">Auto · MP3 first</option><option value="mp3">Project MP3</option><option value="online">Online voice</option></select></label>
        <label class="obsSpan3"><span>Playback speed</span><input id="obsRate" type="range" min="0.60" max="1.30" step="0.05" value="1.00"></label>
        <div class="obsActions obsSpan12">
          <button type="button" id="obsPrevious">← Previous</button>
          <button type="button" class="primary" id="obsPlay">▶ Play selected languages</button>
          <button type="button" class="primary" id="obsPlayAllFromHere">▶ Play all · Start here</button>
          <button type="button" id="obsPause">Pause / Resume</button>
          <button type="button" class="danger" id="obsStop">■ Stop</button>
          <button type="button" id="obsNext">Next →</button>
          <button type="button" id="obsFullscreen">Full-screen stage</button>
          <button type="button" id="obsCleanOutput">Clean output</button>
          <button type="button" id="obsSecondMonitor">2nd monitor · Selected content</button>
          <button type="button" id="obsResetBoxSize">Reset text boxes</button>
        </div>
      </div>
      <p class="obsHint">In OBS, add a <strong>Window Capture</strong> source for this browser. <strong>2nd monitor · Selected content</strong> opens only the selected passage, languages, image, and captions—without controls—and keeps it synchronized with this controller.</p>
        </div>
      </details>
      <div class="obsAudioStatus" id="obsAudioStatus">Ready for presentation.</div>
      <div class="obsStageShell" id="obsStageShell">
        <div class="obsStage" id="obsStage" data-background="image">
          <div class="obsStageTop"><div class="obsBrand"><span class="obsBrandMark">三</span><span>Tam Bảo · 三寶</span></div><div class="obsSource" id="obsSource"></div></div>
          <div class="obsStageContent">
            <div class="obsCaptionGrid" id="obsCaptionGrid"></div>
            <figure class="obsMediaPanel" id="obsMediaPanel">
              <span class="obsMediaBackdrop" aria-hidden="true"></span>
              <img id="obsMediaImage" alt="">
              <figcaption id="obsMediaEmpty" hidden>No illustration is assigned to this passage.</figcaption>
            </figure>
          </div>
          <div class="obsStageBottom"><span id="obsSection"></span><div class="obsProgress"><span></span></div><span id="obsPage"></span></div>
        </div>
      </div>
    `;
    card.insertBefore(obsView, readingView);

    $("obsPassage").replaceChildren(...Array.from($("passage").children, (node) => node.cloneNode(true)));
    restoreObsSettings();
    bindObsControls();

    obsTab.addEventListener("click", () => showObsView());
    $("liveTab")?.addEventListener("click", () => hideObsView());
    $("readingTab")?.addEventListener("click", () => hideObsView());
  }

  function showObsView() {
    saveCurrentEditor({ immediate: true });
    $("liveView").hidden = true;
    $("readingView").hidden = true;
    $("obsView").hidden = false;
    $("liveTab").classList.remove("active");
    $("readingTab").classList.remove("active");
    $("obsTab").classList.add("active");
    $("liveTab").setAttribute("aria-selected", "false");
    $("readingTab").setAttribute("aria-selected", "false");
    $("obsTab").setAttribute("aria-selected", "true");
    document.body.classList.add("obsWorkspaceActive");
    moveObsUtilities(true);
    $("obsToolDrawer").open = false;
    renderObsStage();
  }

  function hideObsView() {
    const view = $("obsView");
    if (!view) return;
    view.hidden = true;
    view.classList.remove("cleanOutput");
    $("obsToolDrawer").open = false;
    clearTimeout(obsToolsCollapseTimer);
    document.body.classList.remove("obsWorkspaceActive");
    moveObsUtilities(false);
    $("obsTab")?.classList.remove("active");
    $("obsTab")?.setAttribute("aria-selected", "false");
  }

  function moveObsUtilities(intoDrawer) {
    const badge = $("autosaveBadge");
    const theme = $("themeToggle");
    const destination = intoDrawer ? $("obsUtilitySlot") : header;
    if (!destination) return;
    [badge, theme].filter(Boolean).forEach((element) => destination.append(element));
  }

  function scheduleObsToolsCollapse() {
    clearTimeout(obsToolsCollapseTimer);
    const drawer = $("obsToolDrawer");
    if (!drawer?.open) return;
    obsToolsCollapseTimer = window.setTimeout(() => { drawer.open = false; }, 12000);
  }

  function bindObsControls() {
    const drawer = $("obsToolDrawer");
    drawer.addEventListener("toggle", scheduleObsToolsCollapse);
    ["pointerdown", "input", "change", "keydown"].forEach((eventName) => drawer.addEventListener(eventName, scheduleObsToolsCollapse));
    $("obsPassage").addEventListener("change", (event) => setPassage(Number(event.target.value)));
    $("obsPrevious").addEventListener("click", () => setPassage(activeIndex() - 1));
    $("obsNext").addEventListener("click", () => setPassage(activeIndex() + 1));
    document.querySelectorAll("[data-obs-lang]").forEach((input) => input.addEventListener("change", () => {
      if (!document.querySelector("[data-obs-lang]:checked")) input.checked = true;
      if (obsAudioQueueActive || obsAudioPlayAll) stopObsAudioQueue();
      saveObsSettings();
      renderObsStage();
    }));
    ["obsLayout", "obsBackground", "obsFontSize", "obsBoxWidth", "obsBoxHeight", "obsAutoFit", "obsTextFocus", "obsAudioLanguage", "obsAudioSource", "obsRate"].forEach((id) => {
      $(id).addEventListener("input", () => { saveObsSettings(); renderObsStage(); });
      $(id).addEventListener("change", () => { saveObsSettings(); renderObsStage(); });
    });
    $("obsAudioLanguage").addEventListener("change", () => {
      if (!obsAudioQueueActive) obsAudioPreferredLanguage = $("obsAudioLanguage").value;
    });
    $("obsResetBoxSize").addEventListener("click", () => {
      $("obsBoxWidth").value = "100";
      $("obsBoxHeight").value = "100";
      saveObsSettings();
      renderObsStage();
    });
    $("obsPlay").addEventListener("click", playObsAudio);
    $("obsPlayAllFromHere").addEventListener("click", playObsAllFromHere);
    $("obsStop").addEventListener("click", stopObsAudioQueue);
    $("obsPause").addEventListener("click", pauseResumeObsAudio);
    $("obsFullscreen").addEventListener("click", async () => {
      try { await $("obsStageShell").requestFullscreen(); }
      catch { $("obsView").classList.add("cleanOutput"); }
    });
    $("obsCleanOutput").addEventListener("click", () => $("obsView").classList.toggle("cleanOutput"));
    $("obsSecondMonitor").addEventListener("click", openObsSecondMonitor);
    document.addEventListener("keydown", (event) => {
      if ($("obsView")?.hidden) return;
      if (event.key === "Escape") $("obsView").classList.remove("cleanOutput");
      if (event.key === "ArrowLeft" && !isFormField(event.target)) setPassage(activeIndex() - 1);
      if (event.key === "ArrowRight" && !isFormField(event.target)) setPassage(activeIndex() + 1);
      if (event.key === " " && !isFormField(event.target)) { event.preventDefault(); playObsAudio(); }
    });
    [$("passage"), $("previous"), $("next"), $("readingPrevious"), $("readingNext"), ...document.querySelectorAll("[data-lang],[data-section]")].filter(Boolean).forEach((element) => {
      ["click", "change"].forEach((name) => element.addEventListener(name, () => setTimeout(renderObsStage, 0)));
    });
    const status = $("status");
    if (status) new MutationObserver(() => handleObsPlaybackStatus(status.textContent)).observe(status, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", () => requestAnimationFrame(() => {
      fitObsCaptions($("obsStage"));
      syncObsSecondMonitor();
    }));
  }

  function isFormField(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement;
  }

  function initializeObsSecondMonitor(output) {
    const stylesheet = new URL("./app-upgrade.css?v=20260828-v16", location.href).href;
    const base = new URL("./", location.href).href;
    output.document.open();
    output.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${base}"><title>Tam Bảo · Selected OBS Output</title><link rel="stylesheet" href="${stylesheet}"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}body{display:grid;place-items:center;padding:0}#obsOutputMount{display:grid;width:100%;height:100%;place-items:center}.obsStageShell{width:min(100vw,calc(100vh * 16 / 9));height:min(100vh,calc(100vw * 9 / 16));min-height:0;aspect-ratio:16/9;border:0;border-radius:0;box-shadow:none}.obsStage{position:absolute}.outputFullscreenHint{position:fixed;right:12px;top:12px;z-index:5;padding:7px 10px;border-radius:999px;color:#fff;background:#0009;font:700 12px system-ui,sans-serif;opacity:.7;pointer-events:none;transition:opacity .3s}body:hover .outputFullscreenHint{opacity:.95}:fullscreen .outputFullscreenHint{display:none}@media(display-mode:fullscreen){.outputFullscreenHint{display:none}}</style></head><body><main id="obsOutputMount"></main><div class="outputFullscreenHint">16:9 selected content · Double-click for full screen · Esc to exit</div></body></html>`);
    output.document.close();
    output.document.addEventListener("dblclick", () => output.document.documentElement.requestFullscreen?.().catch(() => {}));
    output.addEventListener("load", () => syncObsSecondMonitor(), { once: true });
    output.addEventListener("resize", () => output.requestAnimationFrame(() => fitObsCaptions(output.document.getElementById("obsStage"))));
    output.addEventListener("beforeunload", () => { if (obsSecondMonitorWindow === output) obsSecondMonitorWindow = null; });
    syncObsSecondMonitor();
  }

  async function openObsSecondMonitor() {
    const output = window.open("", "tamBaoV1SelectedObsOutput", "popup=yes,width=1280,height=720,resizable=yes");
    if (!output) {
      $("obsAudioStatus").textContent = "The second-monitor window was blocked. Allow pop-ups for this site and try again.";
      return;
    }
    obsSecondMonitorWindow = output;
    initializeObsSecondMonitor(output);
    let targetScreen = null;
    try {
      if ("getScreenDetails" in window) {
        const details = await window.getScreenDetails();
        targetScreen = details.screens.find((screen) => !screen.isPrimary) || details.currentScreen || details.screens[0];
      }
    } catch { /* The browser may not support automatic monitor selection or permission may be declined. */ }
    if (targetScreen) {
      const left = targetScreen.availLeft ?? targetScreen.left ?? 0;
      const top = targetScreen.availTop ?? targetScreen.top ?? 0;
      const width = targetScreen.availWidth ?? targetScreen.width ?? 1280;
      const height = targetScreen.availHeight ?? targetScreen.height ?? 720;
      try {
        output.moveTo(left, top);
        output.resizeTo(width, height);
      } catch { /* Manual placement remains available. */ }
      $("obsAudioStatus").textContent = "Selected content is synchronized on the second monitor. Double-click the output for full screen.";
    } else {
      $("obsAudioStatus").textContent = "Selected-content output opened. Move it to monitor 2 and double-click it for full screen.";
    }
    output.focus();
    syncObsSecondMonitor();
  }

  function syncObsSecondMonitor() {
    const output = obsSecondMonitorWindow;
    if (!output || output.closed || !$('obsStage')) return;
    try {
      const clone = $("obsStage").cloneNode(true);
      clone.querySelectorAll(".obsCaptionText").forEach((text) => { text.style.fontSize = ""; });
      const current = output.document.getElementById("obsStage");
      if (current) current.replaceWith(clone);
      else {
        const shell = output.document.createElement("div");
        shell.className = "obsStageShell";
        shell.append(clone);
        output.document.getElementById("obsOutputMount")?.replaceChildren(shell);
      }
      output.requestAnimationFrame(() => fitObsCaptions(output.document.getElementById("obsStage")));
    } catch { obsSecondMonitorWindow = null; }
  }

  function fitObsCaptions(stage) {
    if (!stage || !stage.isConnected || stage.clientHeight === 0) return;
    const requestedSize = Number.parseFloat(stage.style.getPropertyValue("--obs-caption-size")) || 34;
    const autoFit = $("obsAutoFit")?.checked !== false;
    stage.querySelectorAll(".obsCaptionText").forEach((text) => {
      let size = requestedSize;
      text.style.fontSize = `${size}px`;
      while (autoFit && size > 7 && (text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1)) {
        size -= 1;
        text.style.fontSize = `${size}px`;
      }
    });
  }

  function setPassage(index, { preserveObsQueue = false } = {}) {
    if (!preserveObsQueue && (obsAudioQueueActive || obsAudioPlayAll)) stopObsAudioQueue();
    saveCurrentEditor({ immediate: true });
    const value = Math.max(0, Math.min(deck.length - 1, index));
    $("passage").value = String(value);
    $("passage").dispatchEvent(new Event("change", { bubbles: true }));
    renderObsStage();
  }

  function playObsAudio() {
    startObsAudioQueue(false);
  }

  function playObsAllFromHere() {
    startObsAudioQueue(true);
  }

  function startObsAudioQueue(playAllFromHere) {
    const selected = [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang);
    if (!selected.length) {
      $("obsAudioStatus").textContent = "Select at least one Caption language before playing.";
      return;
    }
    if (obsAudioQueueActive || obsAudioPlayAll) stopObsAudioQueue();
    obsAudioPreferredLanguage = $("obsAudioLanguage").value;
    const preferredIndex = selected.indexOf(obsAudioPreferredLanguage);
    obsAudioQueue = preferredIndex > 0 ? [...selected.slice(preferredIndex), ...selected.slice(0, preferredIndex)] : selected;
    obsAudioQueueIndex = 0;
    obsAudioQueueActive = true;
    obsAudioPlayAll = playAllFromHere;
    obsAudioAdvancePending = false;
    playCurrentObsQueueLanguage();
  }

  function playCurrentObsQueueLanguage() {
    if (!obsAudioQueueActive || obsAudioQueueIndex < 0 || obsAudioQueueIndex >= obsAudioQueue.length) return;
    const language = obsAudioQueue[obsAudioQueueIndex];
    const languageButton = document.querySelector(`.languages [data-lang="${language}"]`);
    if (languageButton && !languageButton.classList.contains("active")) languageButton.click();
    $("obsAudioLanguage").value = language;
    $("livePlayScope").value = "selection";
    $("audioSource").value = $("obsAudioSource").value;
    $("audioSource").dispatchEvent(new Event("change", { bubbles: true }));
    $("rate").value = $("obsRate").value;
    $("rate").dispatchEvent(new Event("input", { bubbles: true }));
    renderObsStage();
    $("obsAudioStatus").textContent = `Passage ${activeIndex() + 1}/${deck.length} · Queue ${obsAudioQueueIndex + 1}/${obsAudioQueue.length} · ${languages[language].label}`;
    requestAnimationFrame(() => {
      if (obsAudioQueueActive && obsAudioQueue[obsAudioQueueIndex] === language) $("listen").click();
    });
  }

  function advanceObsAudioQueue() {
    if (!obsAudioQueueActive) return;
    obsAudioQueueIndex += 1;
    if (obsAudioQueueIndex < obsAudioQueue.length) {
      playCurrentObsQueueLanguage();
      return;
    }
    if (obsAudioPlayAll && activeIndex() < deck.length - 1) {
      obsAudioQueueActive = false;
      obsAudioQueue = [];
      obsAudioQueueIndex = -1;
      setPassage(activeIndex() + 1, { preserveObsQueue: true });
      window.setTimeout(() => {
        if (!obsAudioPlayAll) return;
        const selected = [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang);
        const preferredIndex = selected.indexOf(obsAudioPreferredLanguage);
        obsAudioQueue = preferredIndex > 0 ? [...selected.slice(preferredIndex), ...selected.slice(0, preferredIndex)] : selected;
        obsAudioQueueIndex = 0;
        obsAudioQueueActive = true;
        playCurrentObsQueueLanguage();
      }, 220);
      return;
    }
    const completedAll = obsAudioPlayAll;
    obsAudioQueueActive = false;
    obsAudioPlayAll = false;
    obsAudioQueue = [];
    obsAudioQueueIndex = -1;
    $("obsAudioLanguage").value = obsAudioPreferredLanguage;
    $("obsAudioStatus").textContent = completedAll ? "Play all from here is complete." : "Selected-language audio queue is complete.";
    renderObsStage();
  }

  function handleObsPlaybackStatus(message) {
    if (!obsAudioQueueActive) {
      $("obsAudioStatus").textContent = message;
      return;
    }
    const complete = message.includes("Selected passage reading is complete.");
    const failed = message.includes("The MP3 could not play") || message.includes("Voice could not play");
    if ((complete || failed) && !obsAudioAdvancePending) {
      obsAudioAdvancePending = true;
      window.setTimeout(() => {
        obsAudioAdvancePending = false;
        advanceObsAudioQueue();
      }, 180);
      return;
    }
    const language = obsAudioQueue[obsAudioQueueIndex];
    $("obsAudioStatus").textContent = `Passage ${activeIndex() + 1}/${deck.length} · Queue ${obsAudioQueueIndex + 1}/${obsAudioQueue.length} · ${languages[language]?.label || language} · ${message}`;
  }

  function stopObsAudioQueue() {
    obsAudioQueueActive = false;
    obsAudioPlayAll = false;
    obsAudioAdvancePending = false;
    obsAudioQueue = [];
    obsAudioQueueIndex = -1;
    $("obsAudioLanguage").value = obsAudioPreferredLanguage;
    $("stop")?.click();
    $("obsAudioStatus").textContent = "Selected-language audio queue stopped.";
    renderObsStage();
  }

  function pauseResumeObsAudio() {
    const player = $("viAudioPlayer");
    if (player && !player.paused) { player.pause(); $("obsAudioStatus").textContent = "Audio paused."; return; }
    if (player && player.currentTime > 0 && !player.ended) { player.play(); $("obsAudioStatus").textContent = "Audio resumed."; return; }
    if (speechSynthesis.speaking) {
      if (speechSynthesis.paused) { speechSynthesis.resume(); $("obsAudioStatus").textContent = "Voice resumed."; }
      else { speechSynthesis.pause(); $("obsAudioStatus").textContent = "Voice paused."; }
    }
  }

  function renderObsStage() {
    if (!$("obsStage")) return;
    const index = activeIndex();
    const slide = deck[index];
    $("obsPassage").value = String(index);
    const layout = $("obsLayout").value;
    const selected = [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang);
    const grid = $("obsCaptionGrid");
    grid.classList.toggle("twoColumn", layout === "columns" && selected.length > 1);
    grid.replaceChildren(...selected.map((language) => {
      const card = document.createElement("article");
      card.className = "obsCaptionCard";
      card.dataset.lang = language;
      card.classList.toggle("isSpeaking", obsAudioQueueActive && obsAudioQueue[obsAudioQueueIndex] === language);
      const label = document.createElement("div");
      label.className = "obsCaptionLabel";
      label.textContent = languages[language].short;
      const text = document.createElement("div");
      text.className = "obsCaptionText";
      text.textContent = (slide.body[language] || "").trim().replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n");
      card.append(label, text);
      return card;
    }));
    const stage = $("obsStage");
    stage.dataset.background = $("obsBackground").value;
    stage.classList.toggle("textFocus", $("obsTextFocus").checked);
    stage.classList.toggle("speakerImageLayout", layout === "speaker-image");
    stage.style.setProperty("--obs-caption-size", `${$("obsFontSize").value}px`);
    stage.style.setProperty("--obs-caption-width", `${$("obsBoxWidth").value}%`);
    stage.style.setProperty("--obs-caption-height", `${$("obsBoxHeight").value}%`);
    stage.style.setProperty("--obs-image", slide.image ? `url("${slide.image.replaceAll('"', '%22')}")` : "none");
    stage.style.setProperty("--obs-progress", `${((index + 1) / deck.length) * 100}%`);
    $("obsSource").textContent = slide.source;
    const mediaImage = $("obsMediaImage");
    const mediaEmpty = $("obsMediaEmpty");
    if (slide.image) {
      mediaImage.src = slide.image;
      mediaImage.alt = `Illustration for ${slide.source}`;
      mediaImage.hidden = false;
      mediaEmpty.hidden = true;
    } else {
      mediaImage.removeAttribute("src");
      mediaImage.alt = "";
      mediaImage.hidden = true;
      mediaEmpty.hidden = false;
    }
    $("obsSection").textContent = `${slide.sectionLabel || "三寶"} · ${languages[$("obsAudioLanguage").value].label}`;
    $("obsPage").textContent = `${String(index + 1).padStart(2, "0")} / ${deck.length}`;
    $("obsPrevious").disabled = index === 0;
    $("obsNext").disabled = index === deck.length - 1;
    $("obsFontSizeValue").textContent = `${$("obsFontSize").value}px`;
    $("obsBoxWidthValue").textContent = `${$("obsBoxWidth").value}%`;
    $("obsBoxHeightValue").textContent = `${$("obsBoxHeight").value}%`;
    requestAnimationFrame(() => {
      fitObsCaptions(stage);
      syncObsSecondMonitor();
    });
  }

  function restoreObsSettings() {
    const settings = readJson(obsStorageKey, {});
    if (settings.layout) $("obsLayout").value = settings.layout;
    if (settings.background) $("obsBackground").value = settings.background;
    if (settings.fontSize) $("obsFontSize").value = settings.fontSize;
    if (settings.boxWidth) $("obsBoxWidth").value = settings.boxWidth;
    if (settings.boxHeight) $("obsBoxHeight").value = settings.boxHeight;
    if (typeof settings.autoFit === "boolean") $("obsAutoFit").checked = settings.autoFit;
    if (typeof settings.textFocus === "boolean") $("obsTextFocus").checked = settings.textFocus;
    if (settings.audioLanguage) $("obsAudioLanguage").value = settings.audioLanguage;
    obsAudioPreferredLanguage = $("obsAudioLanguage").value;
    if (settings.audioSource) $("obsAudioSource").value = settings.audioSource;
    if (settings.rate) $("obsRate").value = settings.rate;
    if (Array.isArray(settings.languages) && settings.languages.length) {
      document.querySelectorAll("[data-obs-lang]").forEach((input) => { input.checked = settings.languages.includes(input.dataset.obsLang); });
    }
  }

  function saveObsSettings() {
    writeJson(obsStorageKey, {
      layout: $("obsLayout").value,
      background: $("obsBackground").value,
      fontSize: $("obsFontSize").value,
      boxWidth: $("obsBoxWidth").value,
      boxHeight: $("obsBoxHeight").value,
      autoFit: $("obsAutoFit").checked,
      textFocus: $("obsTextFocus").checked,
      audioLanguage: $("obsAudioLanguage").value,
      audioSource: $("obsAudioSource").value,
      rate: $("obsRate").value,
      languages: [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang),
    });
  }
  window.addEventListener("beforeunload", () => { try { obsSecondMonitorWindow?.close(); } catch {} });
})();
