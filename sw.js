/* Juice Box Football — offline service worker.
   Strategy:
   - Same-origin app shell (index.html / styles.css / app.js / icons): network-first, so a fresh
     deploy is always picked up when online, falling back to the cached copy when offline.
   - Cross-origin fonts / CDN libs (supabase, pdf.js, Google Fonts): cache-first.
   - Supabase API (auth + data): never touched — always straight to the network.
   Bump CACHE when this file's logic changes to drop old caches. */
var CACHE = 'jbf-v2';
var CORE = ['./', './index.html', './styles.css', './app.js',
            './juice-wordmark.png', './juice-full.png', './juice-icon.png'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  // Cache core files individually so one missing asset can't abort the whole precache.
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(CORE.map(function(u){ return c.add(u).catch(function(){}); }));
  }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ if(k !== CACHE) return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(_) { return; }
  // Supabase auth/data must always hit the network — never serve a cached session or rows.
  if(/supabase\.co$/.test(url.hostname)) return;

  if(url.origin === location.origin){
    // App shell: network-first → fresh when online, cached when offline.
    e.respondWith(
      fetch(req).then(function(res){
        if(res && res.status === 200){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){
        return caches.match(req).then(function(m){ return m || caches.match('./index.html'); });
      })
    );
  } else {
    // Fonts / CDN libs: cache-first → instant offline once seen.
    e.respondWith(
      caches.match(req).then(function(m){
        return m || fetch(req).then(function(res){
          if(res && (res.status === 200 || res.type === 'opaque')){
            var copy = res.clone();
            caches.open(CACHE).then(function(c){ c.put(req, copy); });
          }
          return res;
        }).catch(function(){ return m; });
      })
    );
  }
});
