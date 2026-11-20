/* auth-guard.js — companion of the server-side login gate (topo/collector/app.py)
   1) If any request comes back 401 with X-Auth-Required (session expired), go to the login page.
   2) When the login gate is on, add a "Sign out" button to the header toolbar.
   Purely additive: does not change any existing behaviour of the page. */
(function () {
  'use strict';
  function toLogin() {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
  }
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (r) {
        if (r && r.status === 401 && r.headers && r.headers.get('X-Auth-Required')) toLogin();
        return r;
      });
    };
  }
  function addSignOut(st) {
    if (!st || !st.auth) return;
    var bar = document.querySelector('header .toolbar');
    if (!bar || document.getElementById('nsa-signout')) return;
    var b = document.createElement('button');
    b.id = 'nsa-signout'; b.type = 'button'; b.title = 'Sign out'; b.textContent = '⎋ Sign out';
    b.onclick = function () { location.href = '/auth/logout'; };
    bar.appendChild(b);
  }
  var start = function () {
    (origFetch || window.fetch).call(window, '/auth/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(addSignOut).catch(function () {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
