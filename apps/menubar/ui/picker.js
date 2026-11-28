// Stream picker for a capture (shared by the panel composer and the quick popover).
// The left column lists the user's Niyyah streams (Kahf, Alisha Noor, ...). Products are an optional second
// pick: shown for the chosen stream, nothing preselected. There is no lane. Text is only ever set with
// textContent. Nothing here talks to the network.
(function () {
  'use strict';
  const { pickStream } = window.NiyyahTasks;
  const LAST_KEY = 'niyyah-focus-last-stream';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function chip(label, pressed, onClick, extraClass) {
    const button = el('button', 'chip ' + (extraClass || ''), label);
    button.type = 'button';
    button.title = label; // names are never clipped silently: an ellipsis always has the full name on hover
    button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', onClick);
    return button;
  }

  function mount(host) {
    const state = { streams: [], stream: null, product: null, products: [] };

    function render() {
      host.replaceChildren();
      host.classList.add('picker');
      const column = el('div', 'stream-col');
      column.setAttribute('role', 'group');
      column.setAttribute('aria-label', 'Stream');
      for (const stream of state.streams) {
        column.append(chip(stream.label, stream.value === state.stream, () => {
          Object.assign(state, pickStream(state.streams, stream.value, state.product));
          try { localStorage.setItem(LAST_KEY, state.stream); } catch (_) { /* private mode */ }
          render();
        }, 'tile'));
      }
      if (!state.streams.length) column.append(el('span', 'picker-empty', 'No streams'));

      const side = el('div', 'picker-side');
      const products = el('div', 'chip-row');
      products.setAttribute('role', 'group');
      products.setAttribute('aria-label', 'Product (optional)');
      for (const product of state.products) {
        products.append(chip(product.name, product.slug === state.product, () => {
          state.product = state.product === product.slug ? null : product.slug;
          render();
        }, 'product'));
      }
      if (state.stream && !state.products.length) products.append(el('span', 'picker-empty', 'No products for this stream'));
      side.append(el('div', 'picker-label', 'Product (optional)'), products);
      host.append(column, side);
    }

    render();
    return {
      // `reply` is what the shell's load_options returns: { picker: [{ value, label, products }] }.
      setOptions(reply) {
        state.streams = reply?.picker ?? [];
        let last = null;
        try { last = localStorage.getItem(LAST_KEY); } catch (_) { /* private mode */ }
        Object.assign(state, pickStream(state.streams, last, null));
        render();
      },
      clear() { state.streams = []; Object.assign(state, pickStream([], null, null)); render(); },
      reset() { state.product = null; render(); },
      get value() { return { stream: state.stream, product: state.product }; },
    };
  }

  window.NiyyahPicker = { mount };
})();
