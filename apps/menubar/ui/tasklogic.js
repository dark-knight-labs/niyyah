// Pure task logic for the focus panel: no DOM, no Tauri. Loaded as a classic script in the
// webview (globals on `NiyyahTasks`) and with require() in `node --test` (ui/tests).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NiyyahTasks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEADLINE_SOON_MS = 3 * 60 * 60 * 1000;
  const BROWSERS = ['chrome', 'safari'];

  // Only plain http(s) links without credentials. Returns the normalised href, or '' if refused.
  // The Rust shell checks again before opening (core/src/link.rs).
  function webLink(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href;
    } catch (_) { /* not a URL */ }
    return '';
  }

  // m:ss, or h:mm:ss from an hour on.
  function formatStamp(trackedMs) {
    const seconds = Math.floor((Number.isFinite(trackedMs) ? Math.max(0, trackedMs) : 0) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const minuteStamp = hours ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes);
    return `${minuteStamp}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // Time to add to the running task between two clock samples. On desktop the clock is the awake
  // clock (sleep and display-off excluded), so any positive delta counts. In a plain browser the
  // clock is Date.now(), so a gap over 2.5 s means the tab was throttled or the machine slept.
  function creditDelta(previousMs, currentMs, desktop) {
    if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs)) return 0;
    const delta = currentMs - previousMs;
    if (delta <= 0 || (!desktop && delta > 2500)) return 0;
    return delta;
  }

  // Tracked time for a task as of two samples; returns the updated total.
  function addTracked(task, previousMs, currentMs, desktop) {
    return (task.trackedMs ?? 0) + creditDelta(previousMs, currentMs, desktop);
  }

  function isDueSoon(task, now) {
    if (!task || task.done || !Number.isFinite(task.deadlineAt)) return false;
    const remaining = task.deadlineAt - now;
    return remaining >= 0 && remaining <= DEADLINE_SOON_MS;
  }

  // Move `fromId` to where `toId` is. The running task and unknown ids never move.
  function moveTask(tasks, fromId, toId) {
    const from = tasks.findIndex(task => task.id === fromId);
    const to = tasks.findIndex(task => task.id === toId);
    if (from < 0 || to < 0 || tasks[from].startedAt != null || tasks[to].startedAt != null) return tasks;
    const next = tasks.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  // Which task the previous/next shortcut selects. `order` is the open tasks in cycle order.
  function cycleTarget(order, currentIndex, direction) {
    if (!order.length) return -1;
    if (currentIndex < 0) return direction > 0 ? 0 : order.length - 1;
    return (currentIndex + direction + order.length) % order.length;
  }

  // Split dictated/pasted bulk text into task names; single mode keeps one name.
  function namesFrom(text, single) {
    return (single ? [text] : text.split(/\n+/)).map(line => line.trim()).filter(Boolean);
  }

  // The Niyyah side of a new task: only what the server can store (text, stream, optional products).
  // No lane. Link, timer, deadline and the focus window stay local.
  function captureFor(name, stream, products, clientId) {
    return { text: name, stream, products: [...new Set(products ?? [])], client_id: clientId || null };
  }

  // Stream picker: choosing a stream shows that stream's products as an optional multi-pick. Nothing is
  // preselected beyond the stream; products survive a change of stream only if the new stream has them.
  function pickStream(streams, value, products) {
    const stream = streams.find(item => item.value === value) ?? streams[0];
    if (!stream) return { stream: null, products: [], available: [] };
    const keep = (products ?? []).filter(slug => stream.products.some(item => item.slug === slug));
    return { stream: stream.value, products: keep, available: stream.products };
  }

  // ---- Focus session: ONE task, ONE primary window, optional allowed (secondary) windows. -------------
  // session = {taskId, clientId, taskName, primary: {app, bundleId, title}, allowed: [{...}], mode: 'up'|'down',
  //            durationMs, elapsedMs, awayMs, awayCount, paused,
  //            state: 'primary'|'allowed'|'away'|'lost', startedAt}
  // Window names (app, title) live in the session and its local files only. They never go into a capture.

  const sameWindow = (a, b) => Boolean(a && b) && a.bundleId === b.bundleId && (a.title || '') === (b.title || '');
  const windowKey = w => w.bundleId + '\u0000' + (w.title || '');
  const plainWindow = w => ({ app: w.app, bundleId: w.bundleId, title: w.title || '' });

  function newSession(task, primary, allowed, mode, minutes, now) {
    return {
      taskId: task.id, clientId: task.id, taskName: task.name,
      primary: plainWindow(primary),
      allowed: allowed.filter(w => !sameWindow(w, primary)).map(plainWindow),
      mode: mode === 'down' ? 'down' : 'up',
      durationMs: mode === 'down' ? Math.max(1, Math.round(minutes)) * 60000 : 0,
      elapsedMs: 0, awayMs: 0, awayCount: 0, paused: false, state: 'primary', startedAt: now,
    };
  }

  const isNudge = state => state === 'away' || state === 'lost';

  // Add `delta` awake ms. The timer runs on the primary and on allowed windows; away time is counted too,
  // so the session is honest about how much of it was spent off the set. Paused sessions do not move.
  function focusTick(session, delta) {
    if (!(delta > 0) || session.paused) return session;
    return {
      ...session,
      elapsedMs: session.elapsedMs + delta,
      awayMs: session.awayMs + (isNudge(session.state) ? delta : 0),
    };
  }

  function focusState(session, state) {
    if (session.state === state) return session;
    return { ...session, state, awayCount: session.awayCount + (isNudge(state) ? 1 : 0) };
  }

  function focusPause(session, paused) {
    return session.paused === paused ? session : { ...session, paused };
  }

  // Does the task's own timer earn time right now? Only on the primary or an allowed window, and not paused.
  function taskEarns(session) {
    return !session || (!session.paused && !isNudge(session.state));
  }

  // One click: make `target` the primary window. The old primary becomes an allowed window, so you can go
  // back and forth without the nudge firing.
  function setPrimary(session, target) {
    if (sameWindow(session.primary, target)) return session;
    const allowed = [session.primary, ...session.allowed].filter(w => !sameWindow(w, target));
    return { ...session, primary: plainWindow(target), allowed, state: 'primary' };
  }

  // Add or remove an allowed window. The primary is never in the allowed list.
  function toggleAllowed(session, target) {
    if (sameWindow(session.primary, target)) return session;
    const has = session.allowed.some(w => sameWindow(w, target));
    return { ...session, allowed: has ? session.allowed.filter(w => !sameWindow(w, target)) : [...session.allowed, plainWindow(target)] };
  }

  function focusShown(session) {
    return session.mode === 'down' ? Math.max(0, session.durationMs - session.elapsedMs) : session.elapsedMs;
  }

  function focusFinished(session) {
    return session.mode === 'down' && session.elapsedMs >= session.durationMs;
  }

  // Rows for the window list in the popup: the session's windows first (primary, then allowed), then every
  // other open window. `listed` is what the shell reports as open; a session window that is not listed is
  // shown as closed.
  function windowRows(session, reported) {
    // The shell reports `bundle_id`; sessions use `bundleId`.
    const listed = reported.map(w => ({ app: w.app, bundleId: w.bundle_id ?? w.bundleId, title: w.title || '' }));
    const open = new Set(listed.map(windowKey));
    const rows = [{ ...session.primary, kind: 'primary', closed: !open.has(windowKey(session.primary)) }];
    for (const w of session.allowed) rows.push({ ...w, kind: 'allowed', closed: !open.has(windowKey(w)) });
    for (const w of listed) {
      if (!sameWindow(w, session.primary) && !session.allowed.some(a => sameWindow(a, w))) {
        rows.push({ ...w, kind: 'other', closed: false });
      }
    }
    return rows;
  }

  // The choices made when starting a focus (in the composer or on a task row): which listed window is
  // primary, which others are allowed, the timer. `windows` is the shell's list ({app, bundle_id, title}).
  // Returns null when nothing valid was chosen; the primary is never also an allowed window.
  function readFocusOptions(windows, primaryIndex, allowedIndexes, mode, minutes) {
    const pick = index => (Number.isInteger(index) && index >= 0 && index < windows.length
      ? { app: windows[index].app, bundleId: windows[index].bundle_id ?? windows[index].bundleId, title: windows[index].title || '' } : null);
    const primary = pick(primaryIndex);
    if (!primary) return null;
    const allowed = [...new Set(allowedIndexes)].filter(index => index !== primaryIndex).map(pick).filter(Boolean);
    const down = mode === 'down';
    const length = Math.min(240, Math.max(1, Math.round(Number(minutes)) || 25));
    return { primary, allowed, mode: down ? 'down' : 'up', minutes: down ? length : 0 };
  }

  // How a focus state looks in the tray icon and the popup. Mirrors core/src/focus.rs `presentation`
  // (both are tested): calm on the primary, a soft tint on an allowed window, a blink plus popup shake
  // for a window outside the set; Reduce Motion turns the blink into a steady highlight and drops the shake.
  function presentFor(state, reduceMotion) {
    if (state === 'allowed') return { tray: 'tint', shake: false };
    if (isNudge(state)) return { tray: reduceMotion ? 'steady' : 'blink', shake: !reduceMotion };
    return { tray: 'off', shake: false };
  }

  // One line of the local session log. `app` and `window` are for the local display only.
  function focusRecord(session, endedAt) {
    return {
      task_id: session.taskId, client_id: session.clientId, task: session.taskName,
      app: session.primary.app, window: session.primary.title || null, allowed_count: session.allowed.length,
      mode: session.mode, started_at: session.startedAt, ended_at: endedAt,
      duration_ms: Math.min(session.elapsedMs, session.mode === 'down' ? session.durationMs : Infinity),
      away_ms: session.awayMs, away_count: session.awayCount, completed: focusFinished(session),
    };
  }

  // The part of a session record that may ever leave the Mac (when timer sync exists): no window names.
  function syncable(record) {
    const { app, window, ...rest } = record;
    return rest;
  }

  // Menu-bar text: only the timer, while a focus session runs. Never a window title or task text.
  function trayTitle(session) {
    return session ? formatStamp(focusShown(session)) : '';
  }

  return {
    pickStream, newSession, focusTick, focusState, focusPause, taskEarns, setPrimary, toggleAllowed, windowRows,
    presentFor, readFocusOptions, syncable, sameWindow, windowKey, focusShown, focusFinished, focusRecord, trayTitle,
    DEADLINE_SOON_MS, BROWSERS, webLink, formatStamp, creditDelta, addTracked, isDueSoon, moveTask,
    cycleTarget, namesFrom, captureFor,
  };
});
