/* Minimaler Service Worker: macht die App installierbar (Android/Chrome).
   Bewusst kein Caching der Daten – die kommen live aus Firebase. */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {
  /* Netzwerk zuerst; App-Shell als Fallback wäre möglich, ist hier aber
     nicht nötig, da die App ohne Netz ohnehin keine Daten hätte. */
});
