// Niyyah Capture popover. All network and secrets stay in the Rust core; this file only
// calls Tauri commands. Text is always set with textContent, never as HTML.
(function () {
  "use strict";
  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

  let lane = "next";
  let options = { blocks: [], products: [] };

  function say(el, message, isError) {
    el.textContent = message || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function fill(select, items, emptyLabel) {
    select.replaceChildren();
    if (emptyLabel !== null) {
      const none = document.createElement("option");
      none.value = "";
      none.textContent = emptyLabel;
      select.appendChild(none);
    }
    for (const item of items) {
      const o = document.createElement("option");
      o.value = item.value;
      o.textContent = item.label;
      select.appendChild(o);
    }
  }

  function setLane(next) {
    lane = next;
    for (const chip of document.querySelectorAll(".chip")) {
      chip.setAttribute("aria-pressed", String(chip.dataset.lane === next));
    }
  }

  async function loadOptions(refresh) {
    try {
      const res = await invoke("load_options", { refresh });
      options = res.options;
      fill($("block"), options.blocks.map((b) => ({ value: b.stream || b.block, label: b.what ? b.block + " · " + b.what : b.block })), null);
      fill($("product"), options.products.map((p) => ({ value: p.slug, label: p.name })), "No product");
      if (res.current_stream) $("block").value = res.current_stream;
      say($("status"), "");
    } catch (e) {
      say($("status"), String(e), true);
    }
    $("save").disabled = $("block").options.length === 0;
  }

  async function renderQueue() {
    const list = $("queue");
    list.replaceChildren();
    let entries = [];
    try { entries = await invoke("pending"); } catch (_) { return; }
    for (const e of entries) {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.className = "q-text";
      text.textContent = e.capture.text;
      const state = document.createElement("span");
      state.textContent = e.state === "rejected" ? "refused" : e.last_error ? "waiting" : "queued";
      li.title = e.last_error || "";
      li.append(text, state);
      if (e.state === "rejected") {
        const retry = document.createElement("button");
        retry.className = "link";
        retry.textContent = "Retry";
        retry.addEventListener("click", async () => { await invoke("requeue", { id: e.id }); renderQueue(); });
        const drop = document.createElement("button");
        drop.className = "link";
        drop.textContent = "Dismiss";
        drop.addEventListener("click", async () => { await invoke("discard", { id: e.id }); renderQueue(); });
        li.append(retry, drop);
      }
      list.appendChild(li);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const text = $("text").value.trim();
    if (!text) return;
    try {
      await invoke("submit_capture", {
        capture: { text, lane, stream: $("block").value, product: $("product").value || null },
      });
      $("text").value = "";
      say($("status"), "Saved");
      await invoke("hide_popover");
    } catch (e) {
      say($("status"), String(e), true);
    }
    renderQueue();
  }

  async function showSettings(show) {
    $("capture-view").hidden = show;
    $("settings-view").hidden = !show;
    if (show) {
      const s = await invoke("get_settings");
      $("server-url").value = s.server_url || "";
      $("token").value = "";
      say($("token-state"), s.has_token ? "A token is stored in the Keychain." : "No token stored yet.");
      say($("settings-status"), "");
    } else {
      $("text").focus();
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      await invoke("save_settings", { serverUrl: $("server-url").value, token: $("token").value });
      $("token").value = ""; // cleared as soon as it is stored
      say($("settings-status"), "Stored.");
      const s = await invoke("get_settings");
      say($("token-state"), s.has_token ? "A token is stored in the Keychain." : "No token stored yet.");
      await loadOptions(true);
    } catch (e) {
      $("token").value = "";
      say($("settings-status"), String(e), true);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); invoke("hide_popover"); }
  });
  $("capture-form").addEventListener("submit", submit);
  $("settings-form").addEventListener("submit", saveSettings);
  $("open-settings").addEventListener("click", () => showSettings(true));
  $("close-settings").addEventListener("click", () => showSettings(false));
  for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => setLane(chip.dataset.lane));
  }
  // The shell emits this each time the popover is shown: reset the field, re-pick the current block.
  window.__TAURI__.event.listen("popover-shown", async () => {
    $("text").value = "";
    setLane("next");
    await showSettings(false);
    await loadOptions(false);
    renderQueue();
    $("text").focus();
  });

  loadOptions(false);
  renderQueue();
})();
