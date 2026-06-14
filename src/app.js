/*
 * app.js — hash router + view rendering. Vanilla, no framework.
 * Routes:  (no hash) → Home (physics sim)   #about → About Me   #post/<slug> → a post
 * Home is hash-less so it lives at the bare domain, not domain/#/.
 */
(function () {
  const appEl = document.getElementById('app');
  const canvas = document.getElementById('sim');
  const homeTitle = document.getElementById('home-title');
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

  // Toggle the Home chrome (canvas + title) vs the article container.
  function showHomeChrome(show) {
    canvas.hidden = !show;
    homeTitle.hidden = !show;
    appEl.hidden = show;
  }

  async function showHome() {
    setActiveTab('home');
    appEl.innerHTML = '';
    showHomeChrome(true);
    const p = await loadPosts();
    Sim.start(canvas, p, (slug) => { location.hash = 'post/' + encodeURIComponent(slug); });
  }

  async function showFragment(url, withBack) {
    Sim.stop();
    showHomeChrome(false);
    let html;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('not found');
      html = '<article class="content">' + (await res.text()) + '</article>';
    } catch (e) {
      html = '<article class="content"><p>Not found.</p></article>';
    }
    if (withBack) html += '<p class="back"><a href="#" data-home>← back to home</a></p>';
    appEl.innerHTML = html;
    document.querySelector('main').scrollTo(0, 0);
  }

  // Navigate Home by clearing the hash entirely, so the URL is the bare domain.
  function goHome() {
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    router();
  }

  function router() {
    const route = location.hash.replace(/^#/, '');
    if (route.startsWith('post/')) {
      setActiveTab(null);
      return showFragment('posts/' + decodeURIComponent(route.slice(5)) + '.html', true);
    }
    if (route === 'about') {
      setActiveTab('about');
      return showFragment('about.html', false);
    }
    return showHome();
  }

  // Home nav link and "back to home" links clear the hash instead of leaving a bare "#".
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a[data-tab="home"], a[data-home]');
    if (el) { e.preventDefault(); goHome(); }
  });

  window.addEventListener('hashchange', router);
  window.addEventListener('popstate', router);
  router();
})();
