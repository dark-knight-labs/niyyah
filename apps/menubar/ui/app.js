// Niyyah Capture popover. All network and secrets stay in the Rust core; this file only
// calls Tauri commands. Text is always set with textContent, never as HTML.
(function () {
  "use strict";
  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);


  function say(el, message, isError) {
    el.textContent = message || "";
    el.classList.toggle("error", Boolean(isError));
  }

  const picker = window.NiyyahPicker.mount($("picker"));

  async function loadOptions(refresh) {
    try {
      picker.setOptions(await invoke("load_options", { refresh }));
      say($("status"), "");
    } catch (e) {
      picker.clear();
      say($("status"), String(e), true);
    }
    $("save").disabled = picker.value.stream === null;
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
        
        retry.textContent = "Retry";
        retry.addEventListener("click", async () => { await invoke("requeue", { id: e.id }); renderQueue(); });
        const drop = document.createElement("button");
        
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
        capture: { text, stream: picker.value.stream, product: picker.value.product, client_id: crypto.randomUUID() },
      });
      $("text").value = "";
      say($("status"), "Saved");
      await invoke("hide_popover");
    } catch (e) {
      say($("status"), String(e), true);
    }
    renderQueue();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); invoke("hide_popover"); }
  });
  $("capture-form").addEventListener("submit", submit);
  $("open-settings").addEventListener("click", () => invoke("open_panel_settings"));
  // The shell emits this each time the popover is shown: reset the field, re-pick the current block.
  window.__TAURI__.event.listen("popover-shown", async () => {
    $("text").value = "";
    picker.reset();
    await loadOptions(false);
    renderQueue();
    $("text").focus();
  });

  loadOptions(false);
  renderQueue();
})();
