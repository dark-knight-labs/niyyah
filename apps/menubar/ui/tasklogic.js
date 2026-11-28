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

  // The Niyyah side of a new task: only what the server can store. Link, timer and deadline stay local.
  function captureFor(name, lane, stream, product, clientId) {
    return { text: name, lane, stream, product: product || null, client_id: clientId || null };
  }

  // ---- Focus session: a timer tied to one task and one chosen window. -----------------------------
  // session = {taskId, clientId, taskName, app, bundleId, title, mode: 'up'|'down', durationMs,
  //            elapsedMs, awayMs, awayCount, state: 'on'|'away'|'lost', startedAt}

  function newSession(task, target, mode, minutes, now) {
    return {
      taskId: task.id, clientId: task.id, taskName: task.name,
      app: target.app, bundleId: target.bundleId, title: target.title || '',
      mode: mode === 'down' ? 'down' : 'up',
      durationMs: mode === 'down' ? Math.max(1, Math.round(minutes)) * 60000 : 0,
      elapsedMs: 0, awayMs: 0, awayCount: 0, state: 'on', startedAt: now,
    };
  }

  // Add `delta` awake ms. Time spent away from (or without) the window counts as away time.
  function focusTick(session, delta) {
    if (!(delta > 0)) return session;
    return {
      ...session,
      elapsedMs: session.elapsedMs + delta,
      awayMs: session.awayMs + (session.state === 'on' ? 0 : delta),
    };
  }

  function focusState(session, state) {
    if (session.state === state) return session;
    return { ...session, state, awayCount: session.awayCount + (state === 'on' ? 0 : 1) };
  }

  function focusShown(session) {
    return session.mode === 'down' ? Math.max(0, session.durationMs - session.elapsedMs) : session.elapsedMs;
  }

  function focusFinished(session) {
    return session.mode === 'down' && session.elapsedMs >= session.durationMs;
  }

  // One line of the session log, in the shape that will sync to Niyyah's timer fields later.
  function focusRecord(session, endedAt) {
    return {
      task_id: session.taskId, client_id: session.clientId, task: session.taskName,
      app: session.app, window: session.title || null, mode: session.mode,
      started_at: session.startedAt, ended_at: endedAt,
      duration_ms: Math.min(session.elapsedMs, session.mode === 'down' ? session.durationMs : Infinity),
      away_ms: session.awayMs, away_count: session.awayCount, completed: focusFinished(session),
    };
  }

  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }

  // Menu-bar text. Plain text: the native tray can only show the system font.
  function trayTitle(session, runningTaskName) {
    if (session) {
      const time = formatStamp(focusShown(session));
      const lead = session.state === 'on' ? '' : session.state === 'away' ? 'Away · ' : 'Window closed · ';
      return lead + time + ' · ' + clip(session.taskName, 22);
    }
    return runningTaskName ? clip(runningTaskName, 26) : '';
  }

  return {
    newSession, focusTick, focusState, focusShown, focusFinished, focusRecord, trayTitle,
    DEADLINE_SOON_MS, BROWSERS, webLink, formatStamp, creditDelta, addTracked, isDueSoon, moveTask,
    cycleTarget, namesFrom, captureFor,
  };
});
