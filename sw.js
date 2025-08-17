/* PWA cache (no interceptar Firebase) */
const CACHE = 'deutsch-coach-v3';
const ASSETS = [
  './','./index.html','./app.css','./app.js','./manifest.json',
  './icons/icon-192.png','./icons/icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE?caches.delete(k):null))));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin) return; // ⛔️ nada externo
  e.respondWith(
    caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{
      const copy=r.clone(); caches.open(CACHE).then(cc=>cc.put(e.request,copy)); return r;
    }))
  );
});
