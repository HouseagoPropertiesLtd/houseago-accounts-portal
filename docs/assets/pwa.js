// Registers the service worker so the site can be installed as an app and
// opens instantly on repeat visits. Quietly does nothing if service workers
// aren't available (e.g. opening the files directly instead of through a
// real web server) - never blocks or breaks the page either way.
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol === 'file:') return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
  });
})();
