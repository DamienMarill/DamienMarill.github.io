/* lab. — filtres, recherche et apparition des fiches. */
(() => {
  document.documentElement.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- filtres */
  const grid = document.querySelector('[data-grid]');
  if (grid) {
    const cards = [...grid.querySelectorAll('.card')];
    const input = document.querySelector('[data-search-input]');
    const tabs = [...document.querySelectorAll('[data-filter-lang]')];
    const resets = [...document.querySelectorAll('[data-reset]')];
    const tabsReset = document.querySelector('.tabs [data-reset]');
    const count = document.querySelector('[data-count]');
    const empty = document.querySelector('[data-empty]');
    const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
    const plural = (n) => `${n} manip${n > 1 ? 's' : ''}`;
    const state = { q: '', langs: new Set() };

    const params = new URLSearchParams(location.search);
    state.q = params.get('q') || '';
    (params.get('lang') || '').split(',').filter(Boolean).forEach((l) => state.langs.add(l));
    if (input) input.value = state.q;

    const apply = (updateUrl = true) => {
      const terms = fold(state.q).split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const card of cards) {
        const visible = (!state.langs.size || state.langs.has(card.dataset.lang)) &&
          terms.every((t) => card.dataset.search.includes(t));
        card.hidden = !visible;
        if (visible) { shown++; card.classList.add('is-visible'); }
      }
      tabs.forEach((t) => t.setAttribute('aria-pressed', String(state.langs.has(t.dataset.filterLang))));
      const filtered = state.langs.size > 0 || terms.length > 0;
      if (tabsReset) tabsReset.hidden = !filtered;
      if (empty) empty.hidden = shown > 0;
      if (count) count.textContent = filtered ? `${shown} / ${plural(cards.length)}` : plural(cards.length);
      if (!updateUrl) return;
      const next = new URLSearchParams();
      if (state.q.trim()) next.set('q', state.q.trim());
      if (state.langs.size) next.set('lang', [...state.langs].join(','));
      const qs = next.toString();
      history.replaceState(null, '', qs ? `?${qs}#manips` : location.pathname + location.hash);
    };

    input && input.addEventListener('input', () => { state.q = input.value; apply(); });
    tabs.forEach((t) => t.addEventListener('click', () => {
      const l = t.dataset.filterLang;
      state.langs.has(l) ? state.langs.delete(l) : state.langs.add(l);
      apply();
    }));
    resets.forEach((b) => b.addEventListener('click', () => {
      state.q = '';
      state.langs.clear();
      if (input) { input.value = ''; input.focus(); }
      apply();
    }));
    if (state.q || state.langs.size) apply(false);
  }

  /* ---------------------------------------------------------------- apparition */
  const reveals = [...document.querySelectorAll('.reveal')];
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty('--i', String(i++));
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  reveals.forEach((el) => io.observe(el));
  // Filet de sécurité : rien ne reste invisible si l'observateur ne se déclenche pas
  setTimeout(() => reveals.forEach((el) => el.classList.add('is-visible')), 4000);
})();
