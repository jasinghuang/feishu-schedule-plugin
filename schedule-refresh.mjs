export function createRefreshQueue(refresh, isSaving) {
  let timer, running, pending = false, metadataDirty = false, immediate = false, stopped = false;

  function schedule() {
    clearTimeout(timer);
    if (pending && !running && !isSaving() && !stopped) timer = setTimeout(flush, 500);
  }
  async function flush() {
    clearTimeout(timer);
    if (running) { await running; return flush(); }
    if (stopped || !pending) return;
    running = (async () => {
      while (pending && !stopped && (!isSaving() || immediate)) {
        const metadata = metadataDirty;
        // Events arriving during a read must survive for the next pass.
        pending = metadataDirty = immediate = false;
        await refresh({ metadata });
      }
    })();
    try { await running; }
    finally { running = undefined; schedule(); }
  }
  return {
    request({ metadata = false } = {}) {
      if (stopped) return Promise.resolve();
      pending = immediate = true;
      metadataDirty ||= metadata;
      return flush();
    },
    notify(metadata) {
      if (stopped) return;
      pending = true; metadataDirty ||= metadata;
      schedule();
    },
    settled: schedule,
    dispose() { stopped = true; clearTimeout(timer); }
  };
}
