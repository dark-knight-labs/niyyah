// Niyyah Capture popover. All network and secrets stay in the Rust core; this file only
// calls Tauri commands. Text is always set with textContent, never as HTML.
(function () {
  "use strict";
  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

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
        capture: { text, lane: $("lane").value, stream: $("block").value, product: $("product").value || null, client_id: crypto.randomUUID() },
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
    $("lane").value = "next";
    await loadOptions(false);
    renderQueue();
    $("text").focus();
  });

  loadOptions(false);
  renderQueue();
})();
