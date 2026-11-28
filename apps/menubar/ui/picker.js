// Stream and product dropdowns for a capture (shared by the panel composer and the quick popover).
// Stream: a single-select dropdown (the last one you used is preselected; a search box above 8 streams).
// Products: an optional multi-select dropdown, shown only after a stream is chosen, nothing preselected.
// There is no lane. Text is only ever set with textContent. Nothing here talks to the network.
(function () {
  'use strict';
  const { pickStream } = window.NiyyahTasks;
  const { create } = window.NiyyahDropdown;
  const LAST_KEY = 'niyyah-focus-last-stream';

  function row(label, dropdown) {
    const wrap = document.createElement('div');
    wrap.className = 'pk-row';
    const name = document.createElement('span');
    name.className = 'pk-label';
    name.textContent = label;
    wrap.append(name, dropdown.el);
    return wrap;
  }

  function mount(host) {
    const state = { streams: [], stream: null, products: [], available: [] };
    const streamDd = create({
      label: 'Stream', placeholder: 'Choose a stream',
      onChange: value => { apply(value, state.products); try { localStorage.setItem(LAST_KEY, state.stream); } catch (_) { /* private mode */ } },
    });
    const productsDd = create({
      label: 'Products (optional)', placeholder: 'None', multi: true,
      onChange: values => { state.products = values; },
    });
    const streamRow = row('Stream', streamDd);
    const productsRow = row('Products (optional)', productsDd);
    productsRow.hidden = true;
    host.classList.add('picker');
    host.replaceChildren(streamRow, productsRow);

    function apply(value, products) {
      Object.assign(state, pickStream(state.streams, value, products));
      streamDd.setValue(state.stream);
      productsDd.setOptions(state.available.map(p => ({ value: p.slug, label: p.name })), state.products);
      productsRow.hidden = !state.stream || !state.available.length;
    }

    return {
      // `reply` is what the shell's load_options returns: { picker: [{ value, label, products }] }.
      setOptions(reply) {
        state.streams = reply?.picker ?? [];
        streamDd.setOptions(state.streams.map(s => ({ value: s.value, label: s.label })), []);
        let last = null;
        try { last = localStorage.getItem(LAST_KEY); } catch (_) { /* private mode */ }
        apply(last, []);
      },
      clear() { state.streams = []; streamDd.setOptions([], []); apply(null, []); },
      reset() { apply(state.stream, []); },
      get value() { return { stream: state.stream, products: state.products.slice() }; },
    };
  }

  window.NiyyahPicker = { mount };
})();
