// A compact dropdown in the Next Up style, for streams, products and windows.
//  - single or multi select (multi shows checkmarks and stays open while you pick);
//  - a search box when there are more than SEARCH_OVER options;
//  - the menu has its own max height and scrolls, and opens upwards when there is no room below;
//  - keyboard: Enter, Space or the arrows open it; arrows, Home and End move; Enter or Space picks; type to
//    jump; Esc closes the menu first (the popup stays open); Tab leaves.
// The logic that needs no DOM is exported for `node --test` (ui-tests/dropdown.test.js). Text is only ever set
// with textContent.
(function (root, factory) {
  const api = factory(typeof document !== 'undefined' ? document : null);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NiyyahDropdown = api;
})(typeof self !== 'undefined' ? self : this, function (document) {
  'use strict';

  const SEARCH_OVER = 8;
  const MENU_MAX_PX = 220;

  // ---- pure logic -----------------------------------------------------------------------------------
  // Indices of the options whose label contains `query` (case-insensitive), in order.
  function filterOptions(options, query) {
    const q = String(query || '').trim().toLowerCase();
    return options.map((option, index) => ({ option, index }))
      .filter(({ option }) => !q || option.label.toLowerCase().includes(q))
      .map(({ index }) => index);
  }

  // Move the active position inside `visible` (a list of option indices) by delta, clamped (no wrap).
  function stepActive(visible, active, delta) {
    if (!visible.length) return -1;
    const at = visible.indexOf(active);
    if (at < 0) return visible[delta < 0 ? visible.length - 1 : 0];
    return visible[Math.min(visible.length - 1, Math.max(0, at + delta))];
  }

  // Type to jump: the next visible option whose label starts with `typed`. Repeating one letter cycles.
  function typeahead(options, visible, typed, from) {
    const t = String(typed || '').toLowerCase();
    if (!t) return -1;
    const order = [...visible.filter(i => i > from), ...visible.filter(i => i <= from)];
    const same = [...t].every(ch => ch === t[0]);
    const needle = same ? t[0] : t;
    const hit = order.find(i => options[i].label.toLowerCase().startsWith(needle));
    return hit === undefined ? -1 : hit;
  }

  // The text on the trigger.
  function summarize(options, selected, placeholder, multi) {
    const labels = options.filter(o => selected.has(o.value)).map(o => o.label);
    if (!labels.length) return placeholder;
    if (!multi || labels.length === 1) return labels[0];
    return labels.length === 2 ? labels.join(', ') : labels.slice(0, 2).join(', ') + ' +' + (labels.length - 2);
  }

  const needsSearch = count => count > SEARCH_OVER;

  // ---- component ------------------------------------------------------------------------------------
  let openCount = 0;
  const openListeners = new Set();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function nearestScroller(node) {
    for (let p = node.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if (o === 'auto' || o === 'scroll') return p;
    }
    return document.documentElement;
  }

  let uid = 0;

  // create({ label, options: [{value, label}], multi, placeholder, onChange }) -> { el, setOptions, setValue,
  // value, setDisabled, close, focus }
  function create(config) {
    const id = 'dd' + (++uid);
    const state = {
      options: [], selected: new Set(), disabled: new Set(), active: -1, query: '', typed: '', typedAt: 0, open: false,
      multi: Boolean(config.multi), placeholder: config.placeholder || 'None',
    };
    const wrap = el('div', 'dd');
    const trigger = el('button', 'dd-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', config.label || '');
    const value = el('span', 'dd-value');
    trigger.append(value, el('span', 'ic ic-chevron-down'));
    const menu = el('div', 'dd-menu');
    menu.hidden = true;
    const search = el('input', 'dd-search');
    search.type = 'text';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search ' + (config.label || ''));
    search.autocomplete = 'off';
    search.hidden = true;
    const list = el('ul', 'dd-list');
    list.id = id + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', config.label || '');
    if (state.multi) list.setAttribute('aria-multiselectable', 'true');
    trigger.setAttribute('aria-controls', list.id);
    menu.append(search, list);
    wrap.append(trigger, menu);

    const visible = () => filterOptions(state.options, state.query);

    function drawTrigger() {
      const text = summarize(state.options, state.selected, state.placeholder, state.multi);
      value.textContent = text;
      trigger.title = text; // long names are never clipped silently
      wrap.classList.toggle('dd-empty', !state.selected.size);
    }

    function drawList() {
      const shown = visible();
      list.replaceChildren(...shown.map(index => {
        const option = state.options[index];
        const item = el('li', 'dd-option');
        item.id = id + '-o' + index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(state.selected.has(option.value)));
        item.title = option.label;
        if (state.disabled.has(option.value)) { item.classList.add('dd-disabled'); item.setAttribute('aria-disabled', 'true'); }
        if (index === state.active) item.classList.add('dd-active');
        item.append(el('span', 'dd-check ic ic-check'), el('span', 'dd-label', option.label));
        item.onpointerdown = event => event.preventDefault(); // keep focus where it is
        item.onclick = () => pick(index);
        return item;
      }));
      if (!shown.length) list.append(el('li', 'dd-none', 'No match'));
      if (state.active >= 0) trigger.setAttribute('aria-activedescendant', id + '-o' + state.active);
      else trigger.removeAttribute('aria-activedescendant');
    }

    function reveal() {
      const node = list.querySelector('.dd-active');
      if (node) node.scrollIntoView({ block: 'nearest' });
    }

    function changed() {
      drawTrigger();
      if (config.onChange) config.onChange(api.value);
    }

    function pick(index) {
      const option = state.options[index];
      if (!option || state.disabled.has(option.value)) return;
      state.active = index;
      if (state.multi) {
        if (state.selected.has(option.value)) state.selected.delete(option.value); else state.selected.add(option.value);
        drawList();
        reveal();
        changed();
        return;
      }
      state.selected = new Set([option.value]);
      changed();
      close(true);
    }

    function place() {
      // Open upwards when there is not enough room below inside the scrolling area; the menu scrolls itself.
      wrap.classList.remove('dd-up');
      const scroller = nearestScroller(wrap).getBoundingClientRect();
      const at = trigger.getBoundingClientRect();
      const menuHeight = Math.min(menu.getBoundingClientRect().height, MENU_MAX_PX * 2);
      const below = scroller.bottom - at.bottom;
      const above = at.top - scroller.top;
      if (below < menuHeight && above > below) wrap.classList.add('dd-up');
      menu.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      if (state.open || trigger.disabled) return;
      state.open = true;
      openCount++;
      state.query = '';
      search.value = '';
      search.hidden = !needsSearch(state.options.length);
      const first = [...state.selected].map(v => state.options.findIndex(o => o.value === v)).find(i => i >= 0);
      state.active = first ?? visible()[0] ?? -1;
      menu.hidden = false;
      wrap.classList.add('dd-open');
      trigger.setAttribute('aria-expanded', 'true');
      drawList();
      place();
      reveal();
      document.addEventListener('pointerdown', outside, true);
      for (const listener of openListeners) listener(true);
      if (!search.hidden) search.focus();
    }

    function close(refocus) {
      if (!state.open) return;
      state.open = false;
      openCount--;
      menu.hidden = true;
      wrap.classList.remove('dd-open', 'dd-up');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      document.removeEventListener('pointerdown', outside, true);
      for (const listener of openListeners) listener(false);
      if (refocus) trigger.focus();
    }

    function outside(event) {
      if (!wrap.contains(event.target)) close(false);
    }

    function move(delta) {
      state.active = stepActive(visible(), state.active, delta);
      drawList();
      reveal();
    }

    function jump(char) {
      const now = Date.now();
      state.typed = now - state.typedAt > 700 ? char : state.typed + char;
      state.typedAt = now;
      const hit = typeahead(state.options, visible(), state.typed, state.active);
      if (hit >= 0) {
        state.active = hit;
        if (state.open) { drawList(); reveal(); }
        else if (!state.multi) { state.selected = new Set([state.options[hit].value]); changed(); }
      }
    }

    wrap.addEventListener('keydown', event => {
      const key = event.key;
      const inSearch = event.target === search;
      if (key === 'Escape' && state.open) {
        event.preventDefault();
        event.stopPropagation(); // closes the menu, not the popup
        close(true);
        return;
      }
      if (key === 'Tab') { close(false); return; }
      if (!state.open) {
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') { event.preventDefault(); open(); }
        else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); jump(key); }
        return;
      }
      if (key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (key === 'Home' && !inSearch) { event.preventDefault(); state.active = visible()[0] ?? -1; drawList(); reveal(); }
      else if (key === 'End' && !inSearch) { event.preventDefault(); state.active = visible().at(-1) ?? -1; drawList(); reveal(); }
      else if (key === 'Enter' || (key === ' ' && !inSearch)) { event.preventDefault(); if (state.active >= 0) pick(state.active); }
      else if (!inSearch && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); jump(key); }
    });
    search.addEventListener('input', () => {
      state.query = search.value;
      state.active = visible()[0] ?? -1;
      drawList();
    });
    trigger.addEventListener('click', () => { if (state.open) close(true); else open(); });

    const api = {
      el: wrap,
      setOptions(options, selected) {
        state.options = options.map(o => ({ value: o.value, label: String(o.label) }));
        state.selected = new Set((selected ?? []).filter(v => state.options.some(o => o.value === v)));
        state.disabled = new Set();
        state.active = -1;
        drawTrigger();
        if (state.open) drawList();
      },
      setValue(next) {
        const values = Array.isArray(next) ? next : (next == null ? [] : [next]);
        state.selected = new Set(values.filter(v => state.options.some(o => o.value === v)));
        if (!state.multi && state.selected.size > 1) state.selected = new Set([[...state.selected][0]]);
        drawTrigger();
        if (state.open) drawList();
      },
      get value() { return state.multi ? [...state.selected] : ([...state.selected][0] ?? null); },
      setDisabled(values) { state.disabled = new Set(values); for (const v of values) state.selected.delete(v); drawTrigger(); if (state.open) drawList(); },
      setEnabled(enabled) { trigger.disabled = !enabled; if (!enabled) close(false); },
      close,
      focus() { trigger.focus(); },
      get isOpen() { return state.open; },
    };
    drawTrigger();
    return api;
  }

  return {
    SEARCH_OVER, MENU_MAX_PX, filterOptions, stepActive, typeahead, summarize, needsSearch, create,
    anyOpen: () => openCount > 0,
    onOpenChange(listener) { openListeners.add(listener); },
  };
});
