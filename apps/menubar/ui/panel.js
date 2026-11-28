const desktop = window.__TAURI__?.core;
const {webLink, formatStamp, creditDelta, isDueSoon, moveTask, cycleTarget, namesFrom, captureFor,
  newSession, focusTick, focusState, focusPause, taskEarns, setPrimary, toggleAllowed, windowRows, presentFor,
  focusShown, focusFinished, focusRecord, trayTitle} = window.NiyyahTasks;
function native(command, args) {
  return desktop?.invoke(command, args).catch(error => console.warn(command, error));
}
if (desktop) document.documentElement.classList.add('desktop');

'use strict';
const get = id => document.getElementById(id);
const preferencesKey = 'niyyah-focus-reminders';
const appSizes = {compact: 0.8, small: 0.9, standard: 1};
const preferences = {minutes: 5, shake: true, focusSwitch: true, appSize: 'compact'};
try {
  const stored = JSON.parse(localStorage.getItem(preferencesKey));
  if (Object.hasOwn(appSizes, stored?.appSize)) preferences.appSize = stored.appSize;
  if ([0, 1, 3, 5, 10, 15, 30, 60].includes(stored?.minutes)) preferences.minutes = stored.minutes;
  if (typeof stored?.shake === 'boolean') preferences.shake = stored.shake;
  if (typeof stored?.focusSwitch === 'boolean') preferences.focusSwitch = stored.focusSwitch;
} catch {}
const interval = () => preferences.minutes * 60000;
const storageKey = 'niyyah-focus-task-list';
const browserKey = 'niyyah-focus-work-browser';
const macDesktop = desktop && /Mac/.test(navigator.platform);
let workBrowser;
const alwaysOnTopKey = 'niyyah-focus-always-on-top';
let tasks = [];
let taskStoreReady = !desktop;
let savingTasks = false;
let pendingTasks;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const storedTasks = JSON.parse(saved);
    if (Array.isArray(storedTasks)) tasks = storedTasks;
  }
} catch {}
try { workBrowser = localStorage.getItem(browserKey); } catch {}
let next = Date.now() + interval();
let pinned = false; // menu-bar popup: closes when you click elsewhere unless pinned
try { pinned = localStorage.getItem(alwaysOnTopKey) === 'true'; } catch {}
let recognition;
let captureCurrent = false;
let editingTask;
let menuTask;
let menuTrigger;
let shortcutOrder;
let clockSample;
let clockRequestPending = false;
const shortcutDefinitions = {
  previous: {label: 'Previous task', detail: -1, binding: 'Ctrl+Alt+BracketLeft'},
  next: {label: 'Next task', detail: 1, binding: 'Ctrl+Alt+BracketRight'},
  compose: {label: 'New task', detail: 0, binding: 'Ctrl+Alt+KeyN'},
  pause: {label: 'Pause / resume', detail: 'pause', binding: 'Ctrl+Alt+Space'},
};
const shortcutKey = 'niyyah-focus-shortcuts';
const bindings = Object.fromEntries(Object.entries(shortcutDefinitions).map(([action, item]) => [action, item.binding]));
const registeredShortcuts = {};
try {
  const saved = JSON.parse(localStorage.getItem(shortcutKey));
  for (const action of Object.keys(bindings)) {
    if (typeof saved?.[action] === 'string') bindings[action] = saved[action];
  }
} catch {}
const voice = get('voice');
const settings = get('settings');
const focusDialog = get('focus');
const modalOpen = () => voice.open || settings.open || focusDialog.open || get('welcome').open;
let transcript = get('transcript');
const deadline = get('deadline');
const taskLink = get('task-link');
const taskLinkOpen = get('task-link-open');

if (desktop) taskLinkOpen.onclick = async event => {
  event.preventDefault();
  if (taskLinkOpen.getAttribute('aria-busy') === 'true') return;
  const url = taskLinkOpen.href;
  taskLinkOpen.setAttribute('aria-busy', 'true');
  taskLinkOpen.setAttribute('aria-disabled', 'true');
  taskLinkOpen.setAttribute('aria-label', 'Opening link');
  get('announcement').textContent = 'Opening link.';
  const feedback = new Promise(resolve => setTimeout(resolve, 300));
  try {
    await desktop.invoke('open_task_link', {url});
    get('announcement').textContent = 'Link sent to your browser.';
  } catch (error) {
    get('announcement').textContent = 'Could not open task link: ' + error;
  } finally {
    await feedback;
    taskLinkOpen.removeAttribute('aria-busy');
    taskLinkOpen.removeAttribute('aria-disabled');
    taskLinkOpen.removeAttribute('aria-label');
  }
};
const taskMenu = get('task-menu');
const speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const deadlineFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});

function appendDeadline(description, task) {
  if (!Number.isFinite(task?.deadlineAt)) return;
  const time = document.createElement('time');
  time.className = 'task-deadline';
  time.dateTime = new Date(task.deadlineAt).toISOString();
  time.textContent = 'Due ' + deadlineFormat.format(task.deadlineAt);
  description.append(time);
}

function render() {
  closeTaskMenu();
  const list = get('tasks');
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glanceFocus = get('glance-focus');
  const glanceNext = get('glance-next');
  const previousGlance = new Map(animate && glanceFocus.getClientRects().length
    ? [glanceFocus, ...glanceNext.children].map(row => [row.dataset.id, row.getBoundingClientRect().top])
    : []);
  glanceFocus.getAnimations().forEach(animation => animation.cancel());
  const previous = new Map(animate ? [...list.children].filter(row => row.getClientRects().length).map(row => [
    row.dataset.id, row.getBoundingClientRect().top
  ]) : []);
  const active = tasks.filter(task => !task.done);
  const completed = tasks.filter(task => task.done);
  get('remaining').textContent = active.length + ' remaining';
  const focus = currentTask() ?? active[0];
  get('glance-focus').dataset.id = focus?.id ?? '';
  get('glance-name').textContent = focus?.name ?? 'No upcoming tasks';
  const glanceDescription = get('glance-description');
  glanceDescription.querySelector('.task-deadline')?.remove();
  appendDeadline(glanceDescription, focus);
  const link = webLink(focus?.link);
  taskLinkOpen.hidden = !link;
  if (link) {
    taskLinkOpen.href = link;
    taskLinkOpen.title = new URL(link).host;
  } else {
    taskLinkOpen.removeAttribute('href');
    taskLinkOpen.removeAttribute('title');
  }
  get('glance-focus').classList.toggle('tracking', focus?.startedAt != null);
  get('glance-time').title = focus?.startedAt != null ? 'Time tracking is running' : 'Timer paused';
  get('glance-next').replaceChildren(...active.filter(task => task !== focus).slice(0, 2).map(task => {
    const row = document.createElement('li');
    const description = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'glance-preview-name';
    const time = document.createElement('span');
    name.textContent = task.name;
    time.className = 'glance-time';
    description.append(name);
    appendDeadline(description, task);
    row.append(description, time);
    row.dataset.id = task.id;
    return row;
  }));
  const visible = [...active, ...completed].slice(0, 5);
  const rows = visible.map(task => {
    const row = document.createElement('li');
    const running = task.startedAt != null;
    row.className = task.done ? 'task done' : running ? 'task running' : 'task';
    row.dataset.id = task.id;
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.append(Object.assign(document.createElement('span'), {className: 'ic ic-grip'}));
    handle.setAttribute('aria-hidden', 'true');
    const reorderable = !task.done && !running;
    handle.classList.toggle('reorderable', reorderable);
    handle.title = reorderable ? 'Drag to reorder' : running ? 'In-progress task stays first' : 'Completed task';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = task.done;
    box.setAttribute('aria-label', (task.done ? 'Reopen ' : 'Complete ') + task.name);
    const description = document.createElement('div');
    description.className = 'task-description';
    const name = document.createElement('button');
    name.className = 'task-text';
    name.textContent = task.name;
    name.title = 'Edit task description';
    name.setAttribute('aria-label', 'Edit ' + task.name);
    name.onclick = () => editTask(task, name);
    if (running) {
      const status = document.createElement('span');
      status.className = 'sr';
      status.textContent = 'In progress';
      description.append(status);
    }
    description.append(name);
    appendDeadline(description, task);
    const time = document.createElement(task.done ? 'span' : 'button');
    time.className = 'task-time';
    time.title = task.done ? 'Total tracked time' : 'Start or resume tracking';
    if (!task.done) {
      time.setAttribute('aria-label', 'Track time on ' + task.name);
      time.setAttribute('aria-pressed', String(running));
      row.onclick = event => {
        if (event.target.closest('.drag-handle, input, .task-playback, .task-text, .task-editor')) return;
        startTask(task);
        findRow(task.id)?.querySelector('.task-time').focus();
      };
    }
    row.append(handle, box, description, time);
    row.oncontextmenu = event => openTaskMenu(event, task, name);
    row.onkeydown = event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        openTaskMenu(event, task, event.target);
      }
    };
    box.onchange = () => {
      task.done = box.checked;
      if (task.done && running) stopTask(task);
      if (task.done) tasks = tasks.filter(item => item !== task).concat(task);
      update();
      findRow(task.id)?.querySelector('input').focus();
    };
    if (task.done) return row;

    const playback = document.createElement('button');
    playback.type = 'button';
    playback.className = 'task-playback';
    const action = running ? 'Pause timer' : 'Start timer';
    playback.title = action;
    playback.setAttribute('aria-label', action + ' for ' + task.name);
    playback.onclick = () => {
      if (running) {
        stopTask(task);
        update();
        get('announcement').textContent = 'Timer paused.';
      } else {
        startTask(task);
      }
      findRow(task.id)?.querySelector('.task-playback').focus();
    };
    row.append(playback);
    if (reorderable) enableTaskDrag(handle, row, list);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Add a priority to get started.';
    rows.push(empty);
  }
  list.replaceChildren(...rows);
  updateTimes(Date.now());
  renderTaskFocusLine();
  if (previousGlance.size && glanceFocus.getClientRects().length) {
    const glanceRows = [glanceFocus, ...glanceNext.children];
    const positions = glanceRows.map(row => row.getBoundingClientRect().top);
    glanceRows.forEach((row, index) => {
      const before = previousGlance.get(row.dataset.id);
      const offset = before == null ? 12 : before - positions[index];
      if (!offset) return;
      row.animate([
        {transform: 'translateY(' + offset + 'px)', opacity: before == null ? 0 : .72},
        {transform: 'translateY(0)', opacity: 1}
      ], {duration: 420, easing: 'cubic-bezier(.22,.8,.25,1)'});
    });
  }
  if (animate && previous.size) {
    const positions = rows.map(row => row.getBoundingClientRect().top);
    rows.forEach((row, index) => {
      const before = previous.get(row.dataset.id);
      const offset = before == null ? -10 : before - positions[index];
      if (!offset || !row.getClientRects().length) return;
      row.animate([
        {transform: 'translateY(' + offset + 'px)', opacity: before == null ? 0 : 1},
        {transform: 'translateY(0)', opacity: 1}
      ], {duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)'});
    });
  }
}

function editTask(task, button) {
  const editor = document.createElement('input');
  editor.className = 'task-editor';
  editor.value = task.name;
  editor.setAttribute('aria-label', 'Edit task description');
  button.replaceWith(editor);
  function finish(save, refocus) {
    if (!editor.isConnected) return;
    editor.onblur = null;
    const name = editor.value.trim();
    if (save && name && name !== task.name) {
      const row = editor.closest('.task');
      for (const control of row.querySelectorAll('[aria-label]:not(.task-editor)')) {
        const label = control.getAttribute('aria-label');
        if (label.includes(task.name)) control.setAttribute('aria-label', label.replace(task.name, () => name));
      }
      task.name = name;
      button.textContent = name;
      button.setAttribute('aria-label', 'Edit ' + name);
      if (get('glance-focus').dataset.id === task.id) {
        get('glance-name').textContent = name;
      }
      const preview = [...get('glance-next').children].find(row => row.dataset.id === task.id);
      if (preview) preview.querySelector('.glance-preview-name').textContent = name;
      persist();
    }
    editor.replaceWith(button);
    if (refocus) button.focus();
  }
  editor.onblur = () => finish(true, false);
  editor.onkeydown = event => {
    if (event.isComposing || (event.key !== 'Escape' && event.key !== 'Enter')) return;
    event.preventDefault();
    finish(event.key === 'Enter', true);
  };
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

function currentTask() {
  return tasks.find(task => task.startedAt != null);
}

function sampleTrackingClock() {
  const task = currentTask();
  if (!task) {
    clockSample = undefined;
    return;
  }
  function checkpoint(millis) {
    if (currentTask() !== task || !Number.isFinite(millis)) return;
    const previous = clockSample;
    clockSample = {task, millis};
    if (previous?.task !== task) return;
    if (!taskEarns(focus)) return; // away from the focus windows, or paused: the task earns nothing
    const delta = creditDelta(previous.millis, millis, desktop);
    if (!delta) return;
    task.trackedMs = (task.trackedMs ?? 0) + delta;
    persist();
    updateTimes(Date.now());
  }
  if (!desktop) {
    checkpoint(Date.now());
  } else if (!clockRequestPending) {
    clockRequestPending = true;
    native('awake_millis').then(checkpoint).finally(() => {
      clockRequestPending = false;
      if (currentTask() !== task) sampleTrackingClock();
    });
  }
}

function stopTask(task) {
  if (!task) return;
  if (!desktop) sampleTrackingClock();
  delete task.startedAt;
  clockSample = undefined;
}

function startTask(task, fromShortcut = false) {
  if (!fromShortcut) shortcutOrder = undefined;
  const previous = currentTask();
  if (previous === task) return;
  stopTask(previous);
  task.startedAt = Date.now();
  tasks = [task, ...tasks.filter(item => item !== task)];
  update();
  sampleTrackingClock();
  get('announcement').textContent = 'Tracking time on ' + task.name + '.';
}

function updateTimes(now) {
  const focus = currentTask() ?? tasks.find(task => !task.done);
  function writeTime(time, task) {
    if (!time || !task) return;
    const stamp = formatStamp(task.trackedMs);
    if (time.textContent !== stamp) time.textContent = stamp;
  }
  get('glance-time').hidden = !focus;
  for (const row of [get('glance-focus'), ...get('tasks').children, ...get('glance-next').children]) {
    const task = tasks.find(task => task.id === row.dataset.id);
    writeTime(row.querySelector('#glance-time, .task-time, .glance-time'), task);
    row.querySelector('.task-deadline')?.classList.toggle('due-soon', isDueSoon(task, now));
  }
}

function findRow(id) {
  return [...get('tasks').children].find(row => row.dataset.id === id);
}

function update() {
  persist();
  render();
}

function taskStorageStatus(message = '') {
  const status = get('task-storage-status');
  status.textContent = message;
  status.hidden = !message;
}

function mirrorTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
    if (!desktop) taskStorageStatus();
  } catch {
    if (!desktop) taskStorageStatus('Could not save tasks to browser storage.');
  }
}

function persist() {
  if (!taskStoreReady) return;
  mirrorTasks();
  if (!desktop) return;
  pendingTasks = structuredClone(tasks);
  void flushTasks();
}

async function flushTasks() {
  if (savingTasks || !pendingTasks) return;
  savingTasks = true;
  try {
    while (pendingTasks) {
      const snapshot = pendingTasks;
      pendingTasks = undefined;
      try {
        await desktop.invoke('save_tasks', {tasks: snapshot});
        taskStorageStatus();
      } catch (error) {
        pendingTasks ??= snapshot;
        taskStorageStatus('Could not save tasks. Niyyah Capture will retry.');
        console.warn('save_tasks', error);
        break;
      }
    }
  } finally {
    savingTasks = false;
  }
}

async function loadTasks() {
  if (!desktop) return;
  try {
    const saved = await desktop.invoke('load_tasks');
    taskStoreReady = true;
    if (Array.isArray(saved)) {
      tasks = saved;
      mirrorTasks();
    } else if (tasks.length) {
      persist();
    }
  } catch (error) {
    taskStorageStatus('Could not load the task file. Task changes will not be saved.');
    console.warn('load_tasks', error);
  }
}

function enableTaskDrag(handle, row, list) {
  let origin;
  let target;
  handle.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    origin = {x: event.clientX, y: event.clientY};
  };
  handle.onpointermove = event => {
    if (!origin || !handle.hasPointerCapture(event.pointerId)) return;
    if (!row.classList.contains('dragging') &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return;
    row.classList.add('dragging');
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.task');
    const next = hit && hit !== row && list.contains(hit) && !hit.matches('.running, .done') ? hit : null;
    if (next === target) return;
    target?.classList.remove('over');
    target = next;
    target?.classList.add('over');
  };
  handle.onpointerup = event => {
    if (handle.hasPointerCapture(event.pointerId) && target) reorder(row.dataset.id, target.dataset.id);
  };
  handle.onlostpointercapture = () => {
    origin = undefined;
    row.classList.remove('dragging');
    target?.classList.remove('over');
    target = undefined;
  };
}

function reorder(fromId, toId) {
  const moved = moveTask(tasks, fromId, toId);
  if (moved === tasks) return;
  const item = tasks.find(task => task.id === fromId);
  tasks = moved;
  shortcutOrder = undefined;
  update();
  get('announcement').textContent = item.name + ' moved.';
}

let panelOpen = false;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let attentionTimer;

// Tray look: 'off' (calm), 'tint' (on an allowed window), 'blink' or 'steady' (the nudge). `forMs` is for
// the timed check-in blink; afterwards the tray goes back to what the focus session calls for.
function trayAttention(mode, forMs) {
  if (!desktop) return;
  clearTimeout(attentionTimer);
  native('set_tray_attention', {mode});
  if (forMs) attentionTimer = setTimeout(() => trayAttention(sessionTray()), forMs);
}
const sessionTray = () => (focus && !focus.paused ? presentFor(focus.state, reduceMotion()).tray : 'off');

function show(focus = false) {
  panelOpen = true;
  get('widget').classList.remove('closed');
  get('widget').inert = false;
  clearTimeout(nativeHideTimer);
  native('show_widget');
  if (focus) expandFromGlance();
}

function expandFromGlance() {
  get('expand').setAttribute('aria-pressed', 'true');
  get('expand').focus();
}

function setPinned(value) {
  pinned = value;
  get('settings-pin').checked = value;
  get('pin').setAttribute('aria-pressed', String(value));
  return native('pin_widget', { pinned: value });
}

function collapse() {
  clearTimeout(hoverExpandTimer);
  get('widget').classList.remove('hover-expanded');
  get('expand').setAttribute('aria-pressed', 'false');
  closeTaskMenu();
  if (get('widget').contains(document.activeElement)) document.activeElement.blur();
}

let nativeHideTimer;
function dismiss() {
  panelOpen = false;
  collapse();
  get('widget').classList.add('closed');
  get('widget').inert = true;
  if (desktop) nativeHideTimer = setTimeout(() => native('hide_widget'), 380);
  else get('show').focus();
  scheduleCheckIn();
}

let focusPulseTimeout;
let pulsingRows = [];

function pulseTask(task) {
  clearTimeout(focusPulseTimeout);
  for (const row of pulsingRows) row.classList.remove('focus-pulse');
  pulsingRows = [...document.querySelectorAll('#tasks .task, #glance-focus')]
    .filter(row => row.dataset.id === task.id);
  void get('widget').offsetWidth;
  for (const row of pulsingRows) row.classList.add('focus-pulse');
  focusPulseTimeout = setTimeout(() => {
    for (const row of pulsingRows) row.classList.remove('focus-pulse');
    pulsingRows = [];
  }, 1500);
}

function checkIn(now = Date.now()) {
  if (!preferences.minutes) return;
  next = now + interval();
  if (modalOpen()) return;
  if (desktop && !panelOpen) {
    trayAttention(reduceMotion() ? 'steady' : 'blink', 8000);
    get('announcement').textContent = 'Time for a focus check-in.';
    return;
  }
  show();
  const widget = get('widget');
  if (preferences.shake && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    widget.animate(
      [0, -7, 7, -6, 5, -3, 2, 0].map(x => ({translate: `${x}px 0`})),
      {duration: 620, easing: 'ease-out'}
    );
  }
  widget.classList.remove('checkin-flash');
  void widget.offsetWidth;
  widget.classList.add('checkin-flash');
  get('announcement').textContent = 'Time for a focus check-in.';
}

function tick() {
  const now = Date.now();
  sampleTrackingClock();
  tickFocus();
  if (desktop) void flushTasks();
  updateTimes(now);
  if (!desktop && preferences.minutes && now >= next) checkIn(now);
  const seconds = Math.max(0, Math.ceil((next - now) / 1000));
  get('countdown').textContent = preferences.minutes ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : 'Off';
}

function openTaskMenu(event, task, trigger) {
  event.preventDefault();
  menuTask = task;
  menuTrigger = trigger;
  taskMenu.hidden = false;
  const widget = get('widget').getBoundingClientRect();
  const anchor = trigger.getBoundingClientRect();
  const scale = appSizes[preferences.appSize];
  const x = ((event.clientX || anchor.left) - widget.left) / scale;
  const y = ((event.clientY || anchor.bottom) - widget.top) / scale;
  taskMenu.style.left = `${Math.max(6, Math.min(x, widget.width / scale - taskMenu.offsetWidth - 6))}px`;
  taskMenu.style.top = `${Math.max(6, Math.min(y, widget.height / scale - taskMenu.offsetHeight - 6))}px`;
  get('edit-task').focus();
}

function closeTaskMenu(restoreFocus = false) {
  if (taskMenu.hidden) return;
  taskMenu.hidden = true;
  if (restoreFocus) menuTrigger?.focus();
  menuTask = menuTrigger = undefined;
}

function deadlineInputValue(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const local = new Date(timestamp);
  return new Date(timestamp - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// ---- Niyyah side: every new task is also filed in Niyyah (stream, optional product). The link, timer and
// deadline stay in this app. A capture that cannot be queued is reported, never dropped silently.
let niyyahOptions;
const picker = window.NiyyahPicker.mount(get('composer-niyyah'));

async function loadNiyyahOptions(refresh = false) {
  const status = get('niyyah-status');
  try {
    const reply = await desktop.invoke('load_options', {refresh});
    niyyahOptions = reply;
    picker.setOptions(reply);
    return true;
  } catch (error) {
    niyyahOptions = undefined;
    picker.clear();
    status.textContent = 'Niyyah is not reachable yet: ' + error + ' Tasks stay local until it is.';
    status.classList.add('error');
    status.hidden = false;
    return false;
  }
}

async function fileInNiyyah(items) {
  const status = get('niyyah-status');
  const {stream: block, product} = picker.value;
  if (!desktop || !block) return;
  let queued = 0;
  const problems = [];
  for (const {name, id} of items) {
    try {
      await desktop.invoke('submit_capture', {capture: captureFor(name, block, product, id)});
      queued++;
    } catch (error) {
      problems.push(String(error));
    }
  }
  status.classList.toggle('error', problems.length > 0);
  status.textContent = problems.length
    ? `Not filed in Niyyah (${problems.length}): ${problems[0]}`
    : `Filed in Niyyah: ${queued} ${queued === 1 ? 'task' : 'tasks'}.`;
  status.hidden = false;
  sizeDesktop();
}

function openVoice(other, task) {
  if (modalOpen()) return;
  closeTaskMenu();
  editingTask = task;
  captureCurrent = other;
  voice.setAttribute('aria-label', task ? 'Edit task' : other ? 'New task' : 'New priorities');
  get('transcript').hidden = !other;
  get('bulk-transcript').hidden = other;
  transcript = get(other ? 'transcript' : 'bulk-transcript');
  transcript.value = task?.name ?? '';
  deadline.value = deadlineInputValue(task?.deadlineAt);
  taskLink.value = task?.link ?? '';
  taskLink.setCustomValidity('');
  transcript.oninput();
  get('composer-niyyah').hidden = Boolean(task) || !desktop;
  if (!task && desktop) void loadNiyyahOptions();
  get('mic').disabled = !speech;
  get('voice-status').textContent = speech ? '' : 'Dictation is unavailable in this browser.';
  show();
  voice.showModal();
  transcript.focus();
  sizeDesktop();
}

function resetMic() {
  recognition = undefined;
  get('mic').setAttribute('aria-label', 'Start dictation');
  get('mic').setAttribute('aria-pressed', 'false');
}

function toggleMic() {
  if (recognition) {
    recognition.stop();
    return;
  }
  const session = new speech();
  recognition = session;
  const prefix = transcript.value.trim();
  session.lang = document.documentElement.lang || 'en';
  session.continuous = true;
  session.onresult = event => {
    if (recognition !== session) return;
    const results = Array.from(event.results, result => result[0].transcript.trim());
    transcript.value = [prefix, ...results].filter(Boolean).join(captureCurrent ? ' ' : '\n');
    transcript.oninput();
  };
  session.onerror = () => {
    if (recognition !== session) return;
    get('voice-status').textContent = 'Couldn’t transcribe audio. Try again or type instead.';
    resetMic();
  };
  session.onend = () => {
    if (recognition !== session) return;
    resetMic();
    get('voice-status').textContent = '';
  };
  try {
    session.start();
    get('mic').setAttribute('aria-label', 'Stop dictation');
    get('mic').setAttribute('aria-pressed', 'true');
    get('voice-status').textContent = captureCurrent ? 'Listening…' : 'Listening… Pause between priorities.';
  } catch {
    resetMic();
    get('voice-status').textContent = 'Couldn’t start the microphone. Try again or type instead.';
  }
}

get('show').onclick = () => show(true);
get('glance-focus').onclick = expandFromGlance;
get('widget').onclick = event => {
  if (get('expand').getAttribute('aria-pressed') === 'true') return;
  if (event.target.closest('button, a, input, select, textarea, .task')) return;
  expandFromGlance();
};
let hoverExpandTimer;
get('widget').onpointerenter = event => {
  if (event.pointerType !== 'mouse') return;
  hoverExpandTimer = setTimeout(() => get('widget').classList.add('hover-expanded'), 300);
};
get('widget').onpointerleave = () => {
  clearTimeout(hoverExpandTimer);
  get('widget').classList.remove('hover-expanded');
};
get('expand').onclick = event => {
  const button = event.currentTarget;
  button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
};
get('close').onclick = dismiss;
function changePin(value) {
  setPinned(value);
  try { localStorage.setItem(alwaysOnTopKey, String(pinned)); } catch {}
}
get('pin').onclick = () => changePin(!pinned);
get('settings-pin').onchange = event => changePin(event.target.checked);
get('checkin-minutes').value = preferences.minutes;
get('settings-shake').checked = preferences.shake;
get('settings-switch').checked = preferences.focusSwitch;
get('settings-browser').value = workBrowser ?? '';
function saveReminders() {
  try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch {}
}
function applyAppSize() {
  get('app-size').value = preferences.appSize;
  document.documentElement.style.setProperty('--app-scale', appSizes[preferences.appSize]);
}
applyAppSize();
get('app-size').onchange = event => {
  preferences.appSize = event.target.value;
  applyAppSize();
  saveReminders();
  sizeDesktop();
};
function scheduleCheckIn() {
  next = Date.now() + interval();
  get('settings-shake').disabled = !preferences.minutes;
  native('schedule_checkin', {seconds: interval() / 1000});
  tick();
}
get('checkin-minutes').onchange = event => {
  preferences.minutes = Number(event.target.value);
  saveReminders();
  scheduleCheckIn();
};
get('settings-shake').onchange = event => {
  preferences.shake = event.target.checked;
  saveReminders();
};
function syncBrowserPreference() {
  if (macDesktop && workBrowser != null) {
    native('set_work_browser', {browser: preferences.focusSwitch ? workBrowser : 'skipped'});
  }
}
get('settings-browser').onchange = event => {
  workBrowser = event.target.value;
  try { localStorage.setItem(browserKey, workBrowser); } catch {}
  syncBrowserPreference();
};
get('settings-switch').onchange = event => {
  preferences.focusSwitch = event.target.checked;
  saveReminders();
  syncBrowserPreference();
};
async function refreshConnection() {
  if (!desktop) return;
  try {
    const current = await desktop.invoke('get_settings');
    get('server-url').value = current.server_url || '';
    get('token-state').textContent = current.has_token ? 'A token is stored in the Keychain.' : 'No token stored yet. Create one in Niyyah, Settings > Devices.';
  } catch (error) {
    get('token-state').textContent = String(error);
  }
  get('token').value = '';
}

get('save-connection').onclick = async () => {
  const status = get('connection-status');
  try {
    await desktop.invoke('save_settings', {serverUrl: get('server-url').value, token: get('token').value});
    get('token').value = ''; // cleared as soon as it is stored
    status.textContent = 'Stored.';
    await refreshConnection();
    await loadNiyyahOptions(true);
  } catch (error) {
    get('token').value = '';
    status.textContent = String(error);
  }
};

function openSettings() {
  if (modalOpen()) return;
  void refreshConnection();
  get('connection-status').textContent = '';
  settings.showModal();
  sizeDesktop();
}
get('open-settings').onclick = get('toolbar-settings').onclick = openSettings;
window.addEventListener('desktop-settings', openSettings);
settings.addEventListener('close', sizeDesktop);
focusDialog.addEventListener('close', sizeDesktop);
window.addEventListener(desktop ? 'desktop-blur' : 'blur', () => {
  if (!voice.open && !settings.open) collapse();
});
get('capture').onclick = get('desktop-capture').onclick = () => openVoice(false);
get('different').onclick = () => openVoice(true);
get('edit-task').onclick = () => openVoice(true, menuTask);
document.addEventListener('pointerdown', event => {
  if (!taskMenu.contains(event.target)) closeTaskMenu();
});
function eventBinding(event) {
  if (event.isComposing || !/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|BracketLeft|BracketRight|Space)$/.test(event.code)) return;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return;
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
    event.code,
  ].filter(Boolean).join('+');
}

function shortcutLabel(binding, compact = false) {
  const labels = {
    Alt: macDesktop ? (compact ? '⌥' : 'Option') : 'Alt',
    Ctrl: macDesktop && compact ? '⌃' : 'Ctrl',
    Super: macDesktop ? (compact ? '⌘' : 'Command') : (compact ? 'Win' : 'Super'),
    Shift: compact ? (macDesktop ? '⇧' : 'Shft') : 'Shift',
    BracketLeft: '[',
    BracketRight: ']',
  };
  return binding.split('+').map(part => labels[part] ?? part.replace(/^(Key|Digit)/, '')).join(compact && macDesktop ? '' : '+');
}

function renderShortcutGuide() {
  const guide = get('shortcut-guide');
  const labels = {previous: 'Prev', next: 'Next', compose: 'New', pause: 'Pause/Resume'};
  guide.replaceChildren(...Object.entries(shortcutDefinitions).map(([action, {label}]) => {
    const item = document.createElement('li');
    const key = document.createElement('kbd');
    key.textContent = shortcutLabel(bindings[action], true);
    item.setAttribute('aria-label', label + ' ' + shortcutLabel(bindings[action]));
    item.title = item.getAttribute('aria-label');
    item.append(key, ' ' + labels[action]);
    return item;
  }));
}

async function registerShortcut(action, binding) {
  if (!desktop) return;
  const registered = await desktop.invoke('set_task_shortcut', {action, binding, previous: registeredShortcuts[action] ?? null});
  if (registered) registeredShortcuts[action] = binding;
  return registered;
}

for (const [action, {label}] of Object.entries(shortcutDefinitions)) {
  const row = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = shortcutLabel(bindings[action]);
  input.title = 'Focus this field and press a new shortcut';
  input.addEventListener('focus', () => {
    get('shortcut-status').textContent = 'Press a shortcut using Control, Alt, or Command.';
  });
  input.addEventListener('keydown', async event => {
    const binding = eventBinding(event);
    if (!binding || event.repeat) return;
    event.preventDefault();
    if (binding === bindings[action]) return;
    const status = get('shortcut-status');
    if (Object.entries(bindings).some(([other, value]) => other !== action && value === binding)) {
      status.textContent = 'That shortcut is already in use.';
      return;
    }
    const controls = get('shortcut-settings');
    if (controls.disabled) return;
    controls.disabled = true;
    try {
      const registered = await registerShortcut(action, binding);
      bindings[action] = binding;
      input.value = shortcutLabel(binding);
      try { localStorage.setItem(shortcutKey, JSON.stringify(bindings)); } catch {}
      renderShortcutGuide();
      status.textContent = desktop && !registered ? 'Saved for use while Niyyah Capture is focused.' : 'Shortcut saved.';
    } catch {
      status.textContent = 'That shortcut could not be registered. Try another combination.';
    } finally {
      controls.disabled = false;
    }
  });
  row.append(label, input);
  get('shortcut-controls').append(row);
}
renderShortcutGuide();

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && taskMenu.hidden && !modalOpen() && !editingTask && !document.querySelector('.task-editor')) {
    event.preventDefault();
    dismiss();
    return;
  }
  if (event.key === 'Escape' && !taskMenu.hidden) {
    event.preventDefault();
    closeTaskMenu(true);
    return;
  }
  if (event.key === 'Tab' && !taskMenu.hidden) closeTaskMenu(true);
  const binding = eventBinding(event);
  const action = Object.keys(bindings).find(action => bindings[action] === binding);
  if (!action || registeredShortcuts[action] === binding || modalOpen()) return;
  event.preventDefault();
  if (!event.repeat) useShortcut(shortcutDefinitions[action].detail);
});
window.addEventListener('desktop-shortcut', event => useShortcut(event.detail));

function useShortcut(direction) {
  if (modalOpen()) return;
  if (direction === 'pause') {
    const running = currentTask();
    if (running) {
      stopTask(running);
      update();
      get('announcement').textContent = 'Timer paused.';
    } else {
      const task = tasks.find(task => !task.done);
      if (task) startTask(task, true);
    }
    return;
  }
  if (!direction) {
    openVoice(true);
    return;
  }
  const active = tasks.filter(task => !task.done);
  if (!active.length) return;
  if (!shortcutOrder || active.some(task => !shortcutOrder.includes(task))) shortcutOrder = active;
  const order = shortcutOrder.filter(task => active.includes(task));
  const index = order.indexOf(currentTask());
  const target = cycleTarget(order, index, direction);
  startTask(order[target], true);
  show();
}
voice.onclick = event => {
  if (event.target !== voice) return;
  const bounds = voice.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) voice.close();
};
get('mic').onclick = toggleMic;
get('transcript').oninput = get('bulk-transcript').oninput = () => {
  get('save').disabled = !transcript.value.trim();
};
voice.onclose = () => {
  const task = editingTask;
  editingTask = undefined;
  if (task) findRow(task.id)?.querySelector('.task-text').focus();
  sizeDesktop();
  const session = recognition;
  resetMic();
  session?.abort();
};
taskLink.oninput = () => taskLink.setCustomValidity('');
get('voice-form').onsubmit = event => {
  event.preventDefault();
  const names = namesFrom(transcript.value, captureCurrent);
  if (!names.length) return;
  const link = webLink(taskLink.value.trim());
  if (taskLink.value.trim() && !link) {
    taskLink.setCustomValidity('Enter an http or https link without a username or password.');
    taskLink.reportValidity();
    return;
  }
  const deadlineAt = deadline.value ? new Date(deadline.value).getTime() : null;
  if (editingTask) {
    editingTask.name = names[0];
    editingTask.link = link || null;
    if (deadline.value !== deadlineInputValue(editingTask.deadlineAt)) editingTask.deadlineAt = deadlineAt;
    update();
    voice.close();
    get('announcement').textContent = 'Task updated.';
    return;
  }
  const added = names.map(name => ({id: crypto.randomUUID(), name, done: false, deadlineAt, link: link || null}));
  const current = currentTask();
  tasks.splice(current ? 1 : 0, 0, ...added);
  if (captureCurrent) startTask(added[0]);
  else update();
  void fileInNiyyah(added.map(task => ({name: task.name, id: task.id})));
  voice.close();
  show();
  get('announcement').textContent = names.length + ' priorities added.';
};

function sizeDesktop() {
  if (!desktop) return;
  const scale = appSizes[preferences.appSize];
  const widget = get('widget');
  const dialog = settings.open ? settings : focusDialog.open ? focusDialog : get('welcome').open ? get('welcome') : voice;
  const height = dialog.open ? Math.max(widget.offsetHeight, Math.max(dialog.offsetHeight, dialog.scrollHeight) + 12) : widget.offsetHeight;
  return native('resize_widget', {
    width: Math.round(420 * scale),
    height: Math.ceil((height + 24) * scale),
  });
}

if (desktop) {
  document.querySelector('.widget-top').addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    native('start_widget_drag');
  });
}

window.addEventListener('desktop-window-switch', () => {
  const task = currentTask();
  if (preferences.focusSwitch && task) {
    native('show_task_reminder', {title: task.name});
  }
});

window.addEventListener('desktop-focus-switch', () => {
  const task = currentTask();
  if (preferences.focusSwitch && task && !settings.open && !voice.open && !get('widget').classList.contains('closed')) {
    pulseTask(task);
  }
});

// ---- Focus: ONE task + ONE primary window (+ optional allowed windows), as one flow. -----------------
// The Rust side watches (window_focus.rs) and sends `focus-state` events: primary, allowed, away, lost. The
// session (timer, away time) lives here, is saved to focus.json, and each finished session is appended to
// sessions.jsonl. Window names stay in this app: they are never in a capture or a syncable record.
let focus = null;
let focusTarget = null;     // the last primary window, to preselect next time
let focusSample;
let focusClockPending = false;
let focusSavedAt = 0;
let lastTrayTitle;
let focusWindows = [];
let focusTrusted = false;
let windowsPolledAt = 0;

const winLabel = w => (w.title ? w.app + ' — ' + w.title : w.app);
const toShell = w => ({app: w.app, bundle_id: w.bundleId ?? w.bundle_id, title: w.title || ''});
const fromShell = w => ({app: w.app, bundleId: w.bundle_id ?? w.bundleId, title: w.title || ''});

function focusTask() {
  return currentTask() ?? tasks.find(task => !task.done);
}

function pushTargets() {
  native('set_focus_targets', focus ? {primary: toShell(focus.primary), allowed: focus.allowed.map(toShell)} : {primary: null, allowed: []});
}

const KIND_TAG = {primary: 'Primary', allowed: 'Allowed', other: ''};

function renderWindowList() {
  const list = get('focus-windows');
  if (!focus) { list.replaceChildren(); return; }
  list.replaceChildren(...windowRows(focus, focusWindows).map(row => {
    const item = document.createElement('li');
    item.className = 'fw';
    item.dataset.kind = row.kind;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'fw-main';
    main.title = row.kind === 'primary' ? 'Primary window' : 'Make this the primary window';
    main.disabled = row.kind === 'primary';
    const name = document.createElement('span');
    name.className = 'fw-name';
    name.textContent = winLabel(row);
    const tag = document.createElement('span');
    tag.className = 'fw-tag';
    tag.textContent = row.closed ? 'Closed' : KIND_TAG[row.kind];
    main.append(name, tag);
    main.onclick = () => { focus = setPrimary(focus, row); focusChanged(); };
    item.append(main);
    if (row.kind !== 'primary') {
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'fw-allow';
      allow.textContent = row.kind === 'allowed' ? 'Remove' : 'Allow';
      allow.title = row.kind === 'allowed' ? 'Stop treating this window as fine to use' : 'Mark this window as fine to use';
      allow.setAttribute('aria-pressed', String(row.kind === 'allowed'));
      allow.onclick = () => { focus = toggleAllowed(focus, row); focusChanged(); };
      item.append(allow);
    }
    return item;
  }));
}

// The task's own row shows the focus: state, time, primary window.
function renderTaskFocusLine() {
  for (const old of document.querySelectorAll('#tasks .task-focus')) old.remove();
  if (!focus) return;
  const row = findRow(focus.taskId);
  const description = row?.querySelector('.task-description');
  if (!description) return;
  const line = document.createElement('span');
  line.className = 'task-focus';
  line.dataset.state = focus.paused ? 'paused' : focus.state;
  line.textContent = (focus.paused ? 'Focus paused' : focus.state === 'allowed' ? 'Focus · allowed window'
    : focus.state === 'away' ? 'Focus · away' : focus.state === 'lost' ? 'Focus · window closed' : 'Focus')
    + ' · ' + winLabel(focus.primary) + ' · ' + formatStamp(focusShown(focus)) + (focus.mode === 'down' ? ' left' : '');
  description.append(line);
}

function renderFocus() {
  const chip = get('focus-chip');
  chip.hidden = !focus;
  const panel = get('focus-windows');
  panel.hidden = !focus;
  get('focus-open').hidden = Boolean(focus);
  chip.dataset.state = focus ? (focus.paused ? 'paused' : focus.state) : '';
  if (focus) {
    get('focus-label').textContent = focus.paused ? 'Focus paused' : focus.state === 'primary' ? focus.taskName
      : focus.state === 'allowed' ? focus.taskName + ' · allowed window'
      : focus.state === 'away' ? 'Back to ' + focus.primary.app : focus.primary.app + ' window closed';
    get('focus-time').textContent = formatStamp(focusShown(focus)) + (focus.mode === 'down' ? ' left' : '');
    chip.title = winLabel(focus.primary);
    const pause = get('focus-pause');
    pause.setAttribute('aria-label', focus.paused ? 'Resume focus' : 'Pause focus');
    pause.title = pause.getAttribute('aria-label');
    pause.firstElementChild.className = 'ic ' + (focus.paused ? 'ic-play' : 'ic-pause');
  }
  renderWindowList();
  renderTaskFocusLine();
  // Menu bar: an icon, and at most the timer. Never a window title or task text.
  const title = trayTitle(focus);
  if (desktop && title !== lastTrayTitle) {
    lastTrayTitle = title;
    native('set_tray_title', {title});
  }
}

function persistFocus(force = false) {
  const now = Date.now();
  if (!desktop || (!force && now - focusSavedAt < 5000)) return;
  focusSavedAt = now;
  native('save_focus_state', {state: {primary: focusTarget, session: focus}});
}

// The windows or the primary changed: tell the watcher, save, redraw.
function focusChanged() {
  focusTarget = focus ? focus.primary : focusTarget;
  pushTargets();
  trayAttention(sessionTray());
  persistFocus(true);
  renderFocus();
}

async function loadFocus() {
  if (!desktop) return;
  try {
    const saved = await desktop.invoke('load_focus_state');
    if (saved?.primary) focusTarget = saved.primary;
    if (saved?.session?.primary) {
      focus = {...saved.session, state: 'primary'};
      pushTargets();
    }
  } catch (error) {
    console.warn('load_focus_state', error);
  }
  renderFocus();
}

function startFocus(task, primary, allowed, mode, minutes) {
  if (currentTask() !== task) startTask(task);
  focus = newSession(task, primary, allowed, mode, minutes, Date.now());
  focusSample = undefined;
  focusChanged();
  get('announcement').textContent = 'Focus started on ' + task.name + ', primary window ' + primary.app + '.';
}

function stopFocus() {
  if (!focus) return;
  const task = tasks.find(item => item.id === focus.taskId);
  native('log_focus_session', {session: focusRecord(focus, Date.now())});
  focus = null;
  focusSample = undefined;
  if (task && currentTask() === task) { stopTask(task); update(); } // writes the tracked time to the task
  pushTargets();
  trayAttention('off');
  persistFocus(true);
  renderFocus();
  get('announcement').textContent = 'Focus ended.';
}

function pauseFocus(paused) {
  if (!focus) return;
  focus = focusPause(focus, paused);
  const task = tasks.find(item => item.id === focus.taskId);
  if (task) {
    if (paused && currentTask() === task) { stopTask(task); update(); }
    else if (!paused && !currentTask()) startTask(task);
  }
  if (!paused) pushTargets(); // re-read where you are
  trayAttention(sessionTray());
  persistFocus(true);
  renderFocus();
}

// The switch-away alert: the popup shakes (when it is open) while the tray icon blinks and the full-screen
// reminder names the window to go back to. Reduce Motion: static highlight, no shake.
function shakePanel() {
  if (!panelOpen || reduceMotion()) return;
  get('widget').animate([0, -7, 7, -6, 5, -3, 2, 0].map(x => ({translate: `${x}px 0`})), {duration: 620, easing: 'ease-out'});
}

async function pollWindows() {
  windowsPolledAt = Date.now();
  try {
    const list = await desktop.invoke('list_focus_windows');
    focusWindows = list.windows;
    focusTrusted = list.trusted;
    if (focus) renderWindowList();
  } catch (error) {
    console.warn('list_focus_windows', error);
  }
}

function tickFocus() {
  if (!focus) return;
  renderFocus();
  if (desktop && panelOpen && Date.now() - windowsPolledAt > 4000) void pollWindows();
  if (!desktop || focusClockPending) return;
  focusClockPending = true;
  native('awake_millis').then(ms => {
    if (!focus || !Number.isFinite(ms)) return;
    const previous = focusSample;
    focusSample = ms;
    if (previous === undefined) return;
    focus = focusTick(focus, creditDelta(previous, ms, true));
    persistFocus();
    if (focusFinished(focus)) {
      native('show_task_reminder', {title: 'Focus time is up'});
      show();
      stopFocus();
      get('announcement').textContent = 'Focus time is up.';
    }
  }).finally(() => { focusClockPending = false; });
}

window.addEventListener('focus-state', event => {
  if (!focus || focus.paused) return;
  const state = event.detail; // 'primary' | 'allowed' | 'away' | 'lost'
  focus = focusState(focus, state);
  const look = presentFor(state, reduceMotion());
  trayAttention(look.tray);
  if (look.shake) shakePanel();
  persistFocus(true);
  renderFocus();
  if (state === 'away') {
    native('show_task_reminder', {title: 'Back to ' + focus.primary.app});
    if (panelOpen && !get('widget').classList.contains('closed')) pulseTask(tasks.find(task => task.id === focus.taskId) ?? {id: ''});
    get('announcement').textContent = 'You left your focus windows.';
  } else if (state === 'lost') {
    native('show_task_reminder', {title: focus.primary.app + ' window closed'});
    get('announcement').textContent = 'The primary window was closed.';
  } else if (state === 'allowed') {
    get('announcement').textContent = 'On an allowed window.';
  } else {
    get('announcement').textContent = 'Back on the primary window.';
  }
});

// ---- Start dialog: pick or create the task and choose its windows in one step.
function selectedWindow() {
  return focusWindows[Number(get('focus-window').value)];
}

function renderAllowedChoices() {
  const primary = selectedWindow();
  const host = get('focus-allowed');
  host.replaceChildren(...focusWindows.map((win, index) => {
    const label = document.createElement('label');
    label.className = 'focus-allow';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(index);
    box.disabled = primary === win;
    label.append(box, ' ' + winLabel(win));
    return label;
  }));
  get('focus-allowed-set').hidden = focusWindows.length < 2;
}

async function fillFocusDialog() {
  const taskSelect = get('focus-task-select');
  const open = tasks.filter(task => !task.done);
  taskSelect.replaceChildren(...open.map(task => new Option(task.name, task.id)), new Option('New task…', ''));
  const current = focusTask();
  taskSelect.value = current ? current.id : '';
  get('focus-new-row').hidden = taskSelect.value !== '';
  await pollWindows();
  const select = get('focus-window');
  select.replaceChildren(...focusWindows.map((win, index) => new Option(winLabel(win), String(index))));
  const previous = focusTarget ? focusWindows.findIndex(win => win.bundle_id === focusTarget.bundleId && (win.title || '') === (focusTarget.title || '')) : -1;
  if (previous >= 0) select.value = String(previous);
  renderAllowedChoices();
  get('focus-hint').textContent = focusTrusted ? '' :
    'Window titles need the Accessibility permission. Without it, focus works for the whole app. Window names stay on this Mac.';
  get('focus-grant').hidden = focusTrusted;
  get('focus-start').disabled = !focusWindows.length;
  get('focus-status').textContent = !focusWindows.length ? 'No open windows found.' : '';
}

function openFocus() {
  if (!desktop || modalOpen() || focus) return;
  closeTaskMenu();
  show();
  focusDialog.showModal();
  void fillFocusDialog();
  void loadNiyyahOptions();
  sizeDesktop();
}

get('focus-open').onclick = openFocus;
get('focus-stop').onclick = stopFocus;
get('focus-pause').onclick = () => pauseFocus(!focus.paused);
get('focus-task-select').onchange = event => {
  get('focus-new-row').hidden = event.target.value !== '';
  if (event.target.value === '') get('focus-new-task').focus();
};
get('focus-window').onchange = renderAllowedChoices;
get('focus-mode').onchange = event => { get('focus-minutes-row').hidden = event.target.value !== 'down'; };
get('focus-grant').onclick = async () => {
  await native('request_accessibility');
  get('focus-status').textContent = 'Allow Niyyah Capture in System Settings > Privacy & Security > Accessibility, then reopen this window.';
};
get('focus-form').onsubmit = event => {
  event.preventDefault();
  const win = selectedWindow();
  if (!win) return;
  let task = tasks.find(item => item.id === get('focus-task-select').value);
  if (!task) {
    const name = get('focus-new-task').value.trim();
    if (!name) { get('focus-status').textContent = 'Name the new task.'; return; }
    task = {id: crypto.randomUUID(), name, done: false, deadlineAt: null, link: null};
    tasks.splice(currentTask() ? 1 : 0, 0, task);
    void fileInNiyyah([{name, id: task.id}]);
  }
  const allowed = [...get('focus-allowed').querySelectorAll('input:checked')].map(box => fromShell(focusWindows[Number(box.value)]));
  const minutes = Number(get('focus-minutes').value) || 25;
  startFocus(task, fromShell(win), allowed, get('focus-mode').value, minutes);
  focusDialog.close();
};

// First run: say what each permission is for, once, before it is asked for.
function showWelcome() {
  let seen = false;
  try { seen = localStorage.getItem('niyyah-focus-welcomed') === '1'; } catch {}
  if (seen || modalOpen() || !desktop) return;
  get('welcome').showModal();
  sizeDesktop();
}
get('welcome-ok').onclick = () => {
  try { localStorage.setItem('niyyah-focus-welcomed', '1'); } catch {}
  get('welcome').close();
};

async function initialize() {
  await loadTasks();
  await loadFocus();
  render();
  tick();
  setInterval(tick, 1000);
  const initialPin = setPinned(pinned);
  if (desktop) {
    syncBrowserPreference();
    for (const [action, binding] of Object.entries(bindings)) {
      registerShortcut(action, binding).catch(() => false).then(registered => {
        if (!registered) get('shortcut-status').textContent = 'Some shortcuts are only available while Niyyah Capture is focused.';
      });
    }
    window.addEventListener('desktop-show', () => { show(true); showWelcome(); });
    window.addEventListener('desktop-hidden', () => { panelOpen = false; collapse(); });
    const observer = new ResizeObserver(sizeDesktop);
    observer.observe(get('widget'));
    observer.observe(voice);
    observer.observe(settings);
    observer.observe(focusDialog);
    observer.observe(get('welcome'));
    window.addEventListener('desktop-checkin', () => checkIn());
    Promise.all([initialPin, sizeDesktop()]);
  }
  scheduleCheckIn();
}
void initialize();
