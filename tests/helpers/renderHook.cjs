// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// A dependency-aware hook harness. Double updater evaluation models StrictMode purity checks.
function createHookHarness({ doubleUpdates = false } = {}) {
  const slots = [];
  let cursor = 0, effects = [], layouts = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (queue, callback, dependencies) => {
    const index = cursor++, previous = slots[index];
    if (previous && same(previous.dependencies, dependencies)) return;
    slots[index] = { dependencies, cleanup: previous?.cleanup };
    queue.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], update => {
        if (typeof update === 'function') {
          if (doubleUpdates) update(slots[index]);
          slots[index] = update(slots[index]);
        } else slots[index] = update;
      }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: callback() };
      return slots[index].value;
    },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { effect(effects, callback, dependencies); },
    useLayoutEffect(callback, dependencies) { effect(layouts, callback, dependencies); }
  };
  return {
    react,
    render(callback) { cursor = 0; return callback(); },
    commit() { const pending = [...layouts, ...effects]; layouts = []; effects = []; pending.forEach(callback => callback()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); }
  };
}

module.exports = { createHookHarness };
