"use strict";

(() => {
  const storageKey = "read-aloud-theme";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  let storageWarning = "";

  function reportWarning(message, error) {
    storageWarning = message;
    console.warn(message, error);
  }

  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved !== null) {
      if (["system", "light", "dark"].includes(saved)) preference = saved;
      else reportWarning("Unrecognized saved theme; following your system theme.", saved);
    }
  } catch (error) {
    reportWarning("Theme preferences are unavailable; changes apply only to this page.", error);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = preference;
    const dark = preference === "dark" || (preference === "system" && systemTheme.matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? "#141c17" : "#f6f7f4";
  }

  applyTheme();
  systemTheme.addEventListener("change", applyTheme);

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = document.querySelectorAll("[data-theme-choice]");
    const notice = document.getElementById("theme-notice");

    function updateButtons() {
      buttons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference));
      });
    }

    function showWarning() {
      notice.textContent = storageWarning;
      notice.hidden = !storageWarning;
    }

    updateButtons();
    showWarning();
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        preference = button.dataset.themeChoice;
        applyTheme();
        updateButtons();
        try {
          window.localStorage.setItem(storageKey, preference);
          storageWarning = "";
        } catch (error) {
          reportWarning("Could not save your theme preference; it applies only to this page.", error);
        }
        showWarning();
      });
    });
  });
})();
