/*
 * app.js — hash router + view rendering. Vanilla, no framework.
 * Routes:  #/  → Home (physics sim)   #/about → About Me   #/post/<slug> → a post
 */
(function () {
  const appEl = document.getElementById('app');
  const canvas = document.getElementById('sim');
  let posts = null;

  async function loadPosts() {
    if (posts) return posts;
    const res = await fetch('posts.json');
    posts = res.ok ? await res.json() : [];
    return posts;
  }

  function setActiveTab(tab) {
    document.querySelectorAll('nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.tab === tab);
    });
  }

  function showCanvas(show) {
    canvas.hidden = !show;
    appEl.hidden = show;
  }

  async function showHome() {
    setActiveTab('home');
    appEl.innerHTML = '';
    showCanvas(true);
    const p = await loadPosts();
    Sim.start(canvas, p, (slug) => { location.hash = '#/post/' + encodeURIComponent(slug); });
  }

  async function showFragment(url, withBack) {
    Sim.stop();
    showCanvas(false);
    let html;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('not found');
      html = '<article class="content">' + (await res.text()) + '</article>';
    } catch (e) {
      html = '<article class="content"><p>Not found.</p></article>';
    }
    if (withBack) html += '<p class="back"><a href="#/">← back to home</a></p>';
    appEl.innerHTML = html;
    main().scrollTo(0, 0);
  }

  const main = () => document.querySelector('main');

  function router() {
    const h = location.hash || '#/';
    const m = h.match(/^#\/post\/(.+)$/);
    if (m) { setActiveTab(null); return showFragment('posts/' + decodeURIComponent(m[1]) + '.html', true); }
    if (h.startsWith('#/about')) { setActiveTab('about'); return showFragment('about.html', false); }
    return showHome();
  }

  window.addEventListener('hashchange', router);
  router();
})();
