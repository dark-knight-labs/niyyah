// Block / product / lane chips for a capture (shared by the panel composer and the quick popover).
// Blocks are the plan page's tiles (SOUL, BODY, ...): white tiles in a pale-blue column, monospace caps.
// Choosing a block fills the product chips from that block's products. Lane defaults to NOW.
// Text is only ever set with textContent. Nothing here talks to the network.
(function () {
  'use strict';
  const { pickBlock, LANES } = window.NiyyahTasks;
  const LANE_LABEL = { now: 'NOW', next: 'NEXT', backlog: 'BACKLOG' };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function chip(label, pressed, onClick, extraClass) {
    const button = el('button', 'chip ' + (extraClass || ''), label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', onClick);
    return button;
  }

  function mount(host) {
    const state = { blocks: [], block: null, product: null, products: [], lane: 'now' };

    function render() {
      host.replaceChildren();
      host.classList.add('picker');
      const column = el('div', 'block-col');
      column.setAttribute('role', 'group');
      column.setAttribute('aria-label', 'Block');
      for (const block of state.blocks) {
        const tile = chip(block.tile || block.value.toUpperCase(), block.value === state.block, () => {
          Object.assign(state, pickBlock(state.blocks, block.value, state.product));
          render();
        }, 'tile');
        tile.title = block.label || block.tile;
        if (block.color) tile.style.setProperty('--tile', block.color);
        column.append(tile);
      }
      if (!state.blocks.length) column.append(el('span', 'picker-empty', 'No blocks'));

      const side = el('div', 'picker-side');
      const products = el('div', 'chip-row');
      products.setAttribute('role', 'group');
      products.setAttribute('aria-label', 'Product');
      for (const product of state.products) {
        products.append(chip(product.name, product.slug === state.product, () => {
          state.product = state.product === product.slug ? null : product.slug;
          render();
        }, 'product'));
      }
      if (!state.products.length) products.append(el('span', 'picker-empty', state.block ? 'No products in this block' : ''));

      const lanes = el('div', 'chip-row lanes');
      lanes.setAttribute('role', 'group');
      lanes.setAttribute('aria-label', 'Lane');
      for (const lane of LANES) {
        lanes.append(chip(LANE_LABEL[lane], lane === state.lane, () => { state.lane = lane; render(); }, 'lane'));
      }
      side.append(el('div', 'picker-label', 'Product'), products, el('div', 'picker-label', 'Lane'), lanes);
      host.append(column, side);
    }

    render();
    return {
      // `reply` is what the shell's load_options returns: { picker, current_stream }.
      setOptions(reply) {
        state.blocks = reply?.picker ?? [];
        Object.assign(state, pickBlock(state.blocks, reply?.current_stream, null));
        render();
      },
      clear() { state.blocks = []; Object.assign(state, pickBlock([], null, null)); render(); },
      reset() { state.lane = 'now'; state.product = null; render(); },
      get value() { return { stream: state.block, product: state.product, lane: state.lane }; },
    };
  }

  window.NiyyahPicker = { mount };
})();
