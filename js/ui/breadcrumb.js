// "Life › Health › Gym" in the top bar. Each part opens that level and is a
// drop target (data-crumb = board id, '' for the top level): drop an item on
// it to move the item up to that level. On narrow screens only "‹ Parent ›
// Current" is shown.
export function createBreadcrumb({ onNavigate }) {
  const nav = document.createElement('nav');
  nav.className = 'crumbs';
  nav.setAttribute('aria-label', 'Where you are');

  function render(doc, path) {
    const parts = path.map((id, i) => {
      const last = i === path.length - 1;
      const name = id === null ? doc.name : (doc.items[id] && doc.items[id].title) || 'Untitled';
      const b = document.createElement(last ? 'span' : 'button');
      b.className = 'crumb' + (last ? ' current' : '');
      b.dataset.crumb = id === null ? '' : id;
      b.textContent = name;
      if (!last) {
        b.type = 'button';
        b.addEventListener('click', () => onNavigate(id));
      }
      return b;
    });
    nav.replaceChildren();
    parts.forEach((p, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        nav.append(sep);
      }
      nav.append(p);
    });
    nav.classList.toggle('deep', path.length > 1);
  }

  return { el: nav, render };
}
