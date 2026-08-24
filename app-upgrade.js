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
  let saveTimer = 0;
  let editingStore = readJson(editStorageKey, {});

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
    const index = activeIndex();
    const language = activeLanguage();
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

  applyStoredEdits();

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
    $("passage"), $("previous"), $("next"), $("readingPrevious"), $("readingNext"), $("editLock"),
    ...document.querySelectorAll("[data-lang],[data-section]"),
  ].filter(Boolean);
  navigationTargets.forEach((element) => {
    ["click", "change"].forEach((eventName) => element.addEventListener(eventName, () => saveCurrentEditor({ immediate: true }), true));
  });
  window.addEventListener("pagehide", () => saveCurrentEditor({ immediate: true }));

  buildObsStudio();
  requestAnimationFrame(() => {
    refreshCurrentPassage();
    renderObsStage();
  });

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
      <div class="obsStudioHeader">
        <div><h2>OBS Presentation Studio</h2><p>Professional 16:9 multilingual captions with synchronized passage and audio controls.</p></div>
        <span class="obsLiveBadge">OBS READY</span>
      </div>
      <div class="obsControlGrid">
        <label class="obsSpan4"><span>Passage</span><select id="obsPassage" aria-label="OBS passage"></select></label>
        <label class="obsSpan2"><span>Caption layout</span><select id="obsLayout"><option value="stacked">Stacked</option><option value="columns">Two columns</option></select></label>
        <label class="obsSpan2"><span>Background</span><select id="obsBackground"><option value="image">Cinematic image</option><option value="black">Black</option><option value="green">Chroma green</option><option value="transparent">Transparent</option></select></label>
        <label class="obsSpan2"><span>Caption size</span><input id="obsFontSize" type="range" min="22" max="54" step="1" value="34"></label>
        <label class="obsSpan2"><span>Audio language</span><select id="obsAudioLanguage"><option value="zh">繁體中文</option><option value="en">US English</option><option value="vi">Tiếng Việt</option><option value="yue">香港廣東話</option></select></label>
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
          <button type="button" class="primary" id="obsPlay">▶ Play audio</button>
          <button type="button" id="obsPause">Pause / Resume</button>
          <button type="button" class="danger" id="obsStop">■ Stop</button>
          <button type="button" id="obsNext">Next →</button>
          <button type="button" id="obsFullscreen">Full-screen stage</button>
          <button type="button" id="obsCleanOutput">Clean output</button>
        </div>
      </div>
      <div class="obsAudioStatus" id="obsAudioStatus">Ready for presentation.</div>
      <div class="obsStageShell" id="obsStageShell">
        <div class="obsStage" id="obsStage" data-background="image">
          <div class="obsStageTop"><div class="obsBrand"><span class="obsBrandMark">三</span><span>Tam Bảo · 三寶</span></div><div class="obsSource" id="obsSource"></div></div>
          <div class="obsCaptionGrid" id="obsCaptionGrid"></div>
          <div class="obsStageBottom"><span id="obsSection"></span><div class="obsProgress"><span></span></div><span id="obsPage"></span></div>
        </div>
      </div>
      <p class="obsHint">In OBS, add a <strong>Window Capture</strong> source for this browser. Select <strong>Clean output</strong> or <strong>Full-screen stage</strong> for a control-free 16:9 presentation. Press Esc to return to the controller.</p>
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
    renderObsStage();
  }

  function hideObsView() {
    const view = $("obsView");
    if (!view) return;
    view.hidden = true;
    view.classList.remove("cleanOutput");
    $("obsTab")?.classList.remove("active");
    $("obsTab")?.setAttribute("aria-selected", "false");
  }

  function bindObsControls() {
    $("obsPassage").addEventListener("change", (event) => setPassage(Number(event.target.value)));
    $("obsPrevious").addEventListener("click", () => setPassage(activeIndex() - 1));
    $("obsNext").addEventListener("click", () => setPassage(activeIndex() + 1));
    document.querySelectorAll("[data-obs-lang]").forEach((input) => input.addEventListener("change", () => {
      if (!document.querySelector("[data-obs-lang]:checked")) input.checked = true;
      saveObsSettings();
      renderObsStage();
    }));
    ["obsLayout", "obsBackground", "obsFontSize", "obsAudioLanguage", "obsAudioSource", "obsRate"].forEach((id) => {
      $(id).addEventListener("input", () => { saveObsSettings(); renderObsStage(); });
      $(id).addEventListener("change", () => { saveObsSettings(); renderObsStage(); });
    });
    $("obsPlay").addEventListener("click", playObsAudio);
    $("obsStop").addEventListener("click", () => $("stop")?.click());
    $("obsPause").addEventListener("click", pauseResumeObsAudio);
    $("obsFullscreen").addEventListener("click", async () => {
      try { await $("obsStageShell").requestFullscreen(); }
      catch { $("obsView").classList.add("cleanOutput"); }
    });
    $("obsCleanOutput").addEventListener("click", () => $("obsView").classList.toggle("cleanOutput"));
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
    if (status) new MutationObserver(() => { $("obsAudioStatus").textContent = status.textContent; }).observe(status, { childList: true, subtree: true, characterData: true });
  }

  function isFormField(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement;
  }

  function setPassage(index) {
    saveCurrentEditor({ immediate: true });
    const value = Math.max(0, Math.min(deck.length - 1, index));
    $("passage").value = String(value);
    $("passage").dispatchEvent(new Event("change", { bubbles: true }));
    renderObsStage();
  }

  function playObsAudio() {
    const language = $("obsAudioLanguage").value;
    const languageButton = document.querySelector(`.languages [data-lang="${language}"]`);
    if (languageButton && !languageButton.classList.contains("active")) languageButton.click();
    $("audioSource").value = $("obsAudioSource").value;
    $("audioSource").dispatchEvent(new Event("change", { bubbles: true }));
    $("rate").value = $("obsRate").value;
    $("rate").dispatchEvent(new Event("input", { bubbles: true }));
    $("listen").click();
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
    const selected = [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang);
    const grid = $("obsCaptionGrid");
    grid.classList.toggle("twoColumn", $("obsLayout").value === "columns" && selected.length > 1);
    grid.replaceChildren(...selected.map((language) => {
      const card = document.createElement("article");
      card.className = "obsCaptionCard";
      card.dataset.lang = language;
      const label = document.createElement("div");
      label.className = "obsCaptionLabel";
      label.textContent = languages[language].short;
      const text = document.createElement("div");
      text.className = "obsCaptionText";
      text.textContent = slide.body[language] || "";
      card.append(label, text);
      return card;
    }));
    const stage = $("obsStage");
    stage.dataset.background = $("obsBackground").value;
    stage.style.setProperty("--obs-caption-size", `${$("obsFontSize").value}px`);
    stage.style.setProperty("--obs-image", slide.image ? `url("${slide.image.replaceAll('"', '%22')}")` : "none");
    stage.style.setProperty("--obs-progress", `${((index + 1) / deck.length) * 100}%`);
    $("obsSource").textContent = slide.source;
    $("obsSection").textContent = `${slide.sectionLabel || "三寶"} · ${languages[$("obsAudioLanguage").value].label}`;
    $("obsPage").textContent = `${String(index + 1).padStart(2, "0")} / ${deck.length}`;
    $("obsPrevious").disabled = index === 0;
    $("obsNext").disabled = index === deck.length - 1;
  }

  function restoreObsSettings() {
    const settings = readJson(obsStorageKey, {});
    if (settings.layout) $("obsLayout").value = settings.layout;
    if (settings.background) $("obsBackground").value = settings.background;
    if (settings.fontSize) $("obsFontSize").value = settings.fontSize;
    if (settings.audioLanguage) $("obsAudioLanguage").value = settings.audioLanguage;
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
      audioLanguage: $("obsAudioLanguage").value,
      audioSource: $("obsAudioSource").value,
      rate: $("obsRate").value,
      languages: [...document.querySelectorAll("[data-obs-lang]:checked")].map((input) => input.dataset.obsLang),
    });
  }
})();
