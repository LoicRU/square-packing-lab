/** Améliorations d'accessibilité transverses, sans toucher à la logique des pages :
 *  - onglets (role=tablist) : flèches / Home / End, tabindex itinérant (un seul onglet dans l'ordre de tabulation) ;
 *  - interrupteurs (.tog, role=button) : aria-pressed synchronisé avec la classe « on » ;
 *  - zones d'état : aria-live poli. */
export function enhanceTabs(root = document) {
  for (const list of root.querySelectorAll('[role=tablist]')) {
    const tabs = () => [...list.querySelectorAll('[role=tab]:not([hidden])')];
    const sync = () => { for (const t of tabs()) t.tabIndex = t.getAttribute('aria-selected') === 'true' || t.classList.contains('cur') ? 0 : -1; if (!tabs().some((t) => t.tabIndex === 0) && tabs()[0]) tabs()[0].tabIndex = 0; };
    list.addEventListener('keydown', (e) => {
      const t = tabs(), i = t.indexOf(document.activeElement); if (i < 0) return;
      const to = { ArrowRight: (i + 1) % t.length, ArrowLeft: (i - 1 + t.length) % t.length, Home: 0, End: t.length - 1 }[e.key];
      if (to === undefined) return; e.preventDefault(); t[to].focus(); if (!t[to].classList.contains('todo')) t[to].click(); // activation automatique
    });
    new MutationObserver(sync).observe(list, { attributes: true, subtree: true, attributeFilter: ['aria-selected', 'class'], childList: true }); sync();
  }
}
export function enhanceToggles(root = document) {
  for (const el of root.querySelectorAll('.tog')) {
    const sync = () => el.setAttribute('aria-pressed', el.classList.contains('on') ? 'true' : 'false');
    new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] }); sync();
  }
}
export const initA11y = () => { enhanceTabs(); enhanceToggles(); };
