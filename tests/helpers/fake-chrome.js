// Minimal stand-in for the chrome.* extension APIs the extension uses.
export function fakeChrome({ initial = {}, onMessage } = {}) {
  const data = structuredClone(initial);
  const changeListeners = [];
  const messageListeners = [];
  const sent = [];
  const created = [];

  const fire = (changes) => {
    for (const fn of changeListeners) fn(structuredClone(changes), 'local');
  };

  const storage = {
    local: {
      async get(keys) {
        const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
          data[k] = structuredClone(v);
        }
        await Promise.resolve();
        fire(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) {
          if (k in data) {
            changes[k] = { oldValue: data[k] };
            delete data[k];
          }
        }
        await Promise.resolve();
        if (Object.keys(changes).length) fire(changes);
      },
    },
    onChanged: { addListener: (fn) => changeListeners.push(fn) },
  };

  const runtime = {
    getURL: (p) => 'chrome-extension://test/' + p,
    // Content-script side: replies come from the onMessage option.
    async sendMessage(msg) {
      sent.push(msg);
      return onMessage ? onMessage(msg) : undefined;
    },
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  };

  // Background side: deliver a message to registered listeners like Chrome does.
  function dispatch(msg, sender = {}) {
    return new Promise((resolve) => {
      let async = false;
      for (const fn of messageListeners) {
        const ret = fn(msg, sender, resolve);
        if (ret === true) async = true;
      }
      if (!async) resolve(undefined);
    });
  }

  return {
    api: { storage, runtime, tabs: { create: (o) => created.push(o) } },
    data,
    sent,
    created,
    dispatch,
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
