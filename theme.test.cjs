const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const source = readFileSync(`${__dirname}/theme.js`, "utf8");
const html = readFileSync(`${__dirname}/index.html`, "utf8");

function setup({ dark = false, saved = null, readError, writeError } = {}) {
  const stored = new Map(saved === null ? [] : [["read-aloud-theme", saved]]);
  const warnings = [];
  const buttons = ["system", "light", "dark"].map((themeChoice) => ({
    dataset: { themeChoice },
    attributes: {},
    events: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.events[name] = callback; },
  }));
  const notice = { textContent: "", hidden: true };
  const meta = {};
  const root = { dataset: {} };
  const systemTheme = {
    matches: dark,
    addEventListener(name, callback) { this[name] = callback; },
  };
  let ready;
  const document = {
    documentElement: root,
    querySelector(selector) {
      assert.equal(selector, 'meta[name="theme-color"]');
      return meta;
    },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-theme-choice]");
      return buttons;
    },
    getElementById(id) {
      assert.match(html, new RegExp(`id="${id}"`));
      assert.equal(id, "theme-notice");
      return notice;
    },
    addEventListener(name, callback) {
      assert.equal(name, "DOMContentLoaded");
      ready = callback;
    },
  };
  runInNewContext(source, {
    document,
    console: { warn(...args) { warnings.push(args); } },
    window: {
      matchMedia(query) {
        assert.equal(query, "(prefers-color-scheme: dark)");
        return systemTheme;
      },
      get localStorage() {
        if (readError) throw readError;
        return {
          getItem(key) { return stored.get(key) ?? null; },
          setItem(key, value) {
            if (writeError) throw writeError;
            stored.set(key, value);
          },
        };
      },
    },
  });
  return {
    root, meta, buttons, notice, warnings, stored,
    ready() { ready(); },
    selected() {
      const active = buttons.filter((button) => button.attributes["aria-pressed"] === "true");
      assert.equal(active.length, 1);
      return active[0].dataset.themeChoice;
    },
    choose(value) { buttons.find((button) => button.dataset.themeChoice === value).events.click(); },
    setSystemDark(value) { systemTheme.matches = value; systemTheme.change(); },
  };
}

test("theme initializes before styles load and accessible icon buttons default to System", () => {
  assert.ok(html.indexOf('<script src="theme.js"></script>') < html.indexOf('<link rel="stylesheet"'));
  assert.match(html, /role="group" aria-label="Theme"/);
  assert.doesNotMatch(html, /<select id="theme">/);
  for (const [theme, label] of [["system", "System"], ["light", "Light"], ["dark", "Dark"]]) {
    assert.match(html, new RegExp(`<button[^>]+type="button"[^>]+data-theme-choice="${theme}"[^>]+aria-label="${label} theme"[^>]+title="${label} theme"[^>]+aria-pressed="${theme === "system"}"`));
  }
  for (const dark of [false, true]) {
    const app = setup({ dark });
    assert.equal(app.root.dataset.theme, "system");
    assert.equal(app.meta.content, dark ? "#141c17" : "#f6f7f4");
    app.ready();
    assert.equal(app.selected(), "system");
    assert.equal(app.notice.hidden, true);
    assert.equal(app.stored.size, 0);
    app.setSystemDark(!dark);
    assert.equal(app.meta.content, dark ? "#f6f7f4" : "#141c17");
  }
});

test("saved explicit themes override the system before the controls initialize", () => {
  for (const saved of ["light", "dark"]) {
    const app = setup({ dark: saved === "light", saved });
    assert.equal(app.root.dataset.theme, saved);
    assert.equal(app.meta.content, saved === "dark" ? "#141c17" : "#f6f7f4");
    app.ready();
    assert.equal(app.selected(), saved);
    app.setSystemDark(false);
    app.setSystemDark(true);
    assert.equal(app.root.dataset.theme, saved);
    assert.equal(app.meta.content, saved === "dark" ? "#141c17" : "#f6f7f4");
  }
});

test("theme changes apply immediately, persist across visits, and can return to System", () => {
  const app = setup({ dark: true });
  app.ready();
  for (const preference of ["light", "dark", "system"]) {
    app.choose(preference);
    assert.equal(app.root.dataset.theme, preference);
    assert.equal(app.selected(), preference);
    assert.equal(app.meta.content, preference === "light" ? "#f6f7f4" : "#141c17");
    const saved = app.stored.get("read-aloud-theme");
    assert.equal(saved, preference);
    const nextVisit = setup({ dark: true, saved });
    nextVisit.ready();
    assert.equal(nextVisit.selected(), preference);
    assert.equal(nextVisit.meta.content, app.meta.content);
  }
  app.setSystemDark(false);
  assert.equal(app.root.dataset.theme, "system");
  assert.equal(app.meta.content, "#f6f7f4");
});

test("unavailable storage surfaces a warning without preventing theme changes", () => {
  const app = setup({ dark: true, readError: new Error("Storage blocked") });
  assert.equal(app.meta.content, "#141c17");
  app.ready();
  assert.equal(app.notice.hidden, false);
  assert.match(app.notice.textContent, /unavailable/);
  app.choose("light");
  assert.equal(app.meta.content, "#f6f7f4");
  assert.equal(app.root.dataset.theme, "light");
  assert.match(app.notice.textContent, /Could not save/);
  assert.equal(app.warnings.length, 2);
});

test("a failed save keeps the chosen theme active and reports the failure", () => {
  const app = setup({ writeError: new Error("Quota exceeded") });
  app.ready();
  app.choose("dark");
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.meta.content, "#141c17");
  assert.equal(app.stored.size, 0);
  assert.equal(app.notice.hidden, false);
  assert.match(app.notice.textContent, /Could not save/);
  assert.equal(app.warnings.length, 1);
});

test("an invalid saved preference reports a warning and recovers after a valid selection", () => {
  const app = setup({ dark: true, saved: "invalid" });
  app.ready();
  assert.equal(app.root.dataset.theme, "system");
  assert.equal(app.meta.content, "#141c17");
  assert.equal(app.selected(), "system");
  assert.match(app.notice.textContent, /Unrecognized saved theme/);
  assert.equal(app.notice.hidden, false);
  assert.equal(app.warnings.length, 1);
  app.choose("dark");
  assert.equal(app.notice.hidden, true);
  assert.equal(app.notice.textContent, "");
  assert.equal(app.stored.get("read-aloud-theme"), "dark");
});
