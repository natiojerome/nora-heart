import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture() {
  const held = deferred<any>(),
    timers = new Set<unknown>(),
    state = { authenticated: true };
  let badge: any = null;
  const row = {
    dataset: { conversationId: "a" },
    querySelector: () => badge,
    firstElementChild: {
      append(value: any) {
        badge = value;
      },
    },
  };
  const document = {
    hidden: false,
    querySelectorAll: (selector: string) =>
      selector === "[data-conversation-id]" ? [row] : [],
    getElementById: () => null,
    addEventListener() {},
    createElement: () => ({
      dataset: {},
      textContent: "",
      remove() {
        badge = null;
      },
    }),
  };
  const window: any = { addEventListener() {} };
  vm.runInNewContext(
    await readFile("src/interfaces/web/public/work.js", "utf8"),
    {
      window,
      document,
      state,
      api: () => held.promise,
      conversationRequests: new Set(["active-request"]),
      setTimeout: () => {
        const id = {};
        timers.add(id);
        return id;
      },
      clearTimeout: (id: unknown) => timers.delete(id),
    },
  );
  return {
    work: window.heartWork,
    held,
    state,
    timers,
    get badge() {
      return badge;
    },
  };
}
const record = (status: string) => [
  { id: "a", title: "temporary", work: { status } },
];
test("work catalogue ignores a pending response after newer state or logout and stops polling", async () => {
  const f = await fixture();
  f.work.update(record("running"));
  assert.equal(f.badge.textContent, "En cours");
  const older = f.work.refresh();
  f.work.update(record("completed"));
  assert.equal(f.badge.textContent, "Terminé");
  f.held.resolve({ conversations: record("running") });
  await older;
  assert.equal(f.badge.textContent, "Terminé");
  const logout = await fixture();
  logout.work.update(record("running"));
  const pending = logout.work.refresh();
  logout.state.authenticated = false;
  logout.work.update([]);
  assert.equal(logout.timers.size, 0);
  logout.held.resolve({ conversations: record("running") });
  await pending;
  assert.equal(logout.badge, null);
  assert.equal(logout.timers.size, 0);
  await logout.work.refresh();
  assert.equal(
    logout.timers.size,
    0,
    "unfinished requests must not restart timers after logout",
  );
});
