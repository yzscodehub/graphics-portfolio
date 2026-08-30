document.documentElement.classList.remove("no-js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const navToggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
const nav = document.querySelector<HTMLElement>("[data-site-nav]");

const setNavigationOpen = (open: boolean, focusFirstItem = false) => {
  nav?.classList.toggle("is-open", open);
  navToggle?.setAttribute("aria-expanded", String(open));
  navToggle?.setAttribute(
    "aria-label",
    open
      ? (navToggle.dataset.navOpenLabel ?? "Close navigation")
      : (navToggle.dataset.navClosedLabel ?? "Open navigation"),
  );
  if (open && focusFirstItem) {
    window.requestAnimationFrame(() => nav?.querySelector<HTMLAnchorElement>("a")?.focus());
  }
};

navToggle?.addEventListener("click", () => {
  setNavigationOpen(!nav?.classList.contains("is-open"), true);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !nav?.classList.contains("is-open")) return;
  setNavigationOpen(false);
  navToggle?.focus();
});

document.querySelectorAll<HTMLElement>(".reveal").forEach((element) => {
  if (reducedMotion || !("IntersectionObserver" in window)) {
    element.classList.add("is-visible");
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      element.classList.add("is-visible");
      observer.disconnect();
    },
    { threshold: 0.08, rootMargin: "0px 0px -8%" },
  );
  observer.observe(element);
});

document.querySelectorAll<HTMLButtonElement>("[data-copy-email]").forEach((button) => {
  button.addEventListener("click", async () => {
    const email = button.dataset.copyEmail ?? "";
    const status = document.querySelector<HTMLElement>("[data-copy-status]");
    try {
      await navigator.clipboard.writeText(email);
      if (status)
        status.textContent =
          document.documentElement.lang === "en" ? "Email copied." : "邮箱已复制。";
    } catch {
      if (status)
        status.textContent =
          document.documentElement.lang === "en"
            ? "Copy failed. Select the email manually."
            : "复制失败，请手动选择邮箱。";
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest<HTMLElement>("[data-filter-group]");
    const value = button.dataset.filter ?? "all";
    group?.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });
    document.querySelectorAll<HTMLElement>("[data-category]").forEach((card) => {
      card.hidden = value !== "all" && card.dataset.category !== value;
    });
  });
});
