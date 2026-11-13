/* AliceLabs Core PWA: same-origin static shell cache. Never cache API requests or secrets. */
const VERSION='core-pwa-v3';
const FILES=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('core-pwa-')&&key!==VERSION)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const request=e.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate'){
    e.respondWith(fetch(request).then(response=>{if(response.ok){const clone=response.clone();void caches.open(VERSION).then(c=>c.put('/index.html',clone));}return response;}).catch(()=>caches.match('/index.html')));
    return;
  }
  if(['script','style','font','image','worker','manifest'].includes(request.destination)||url.pathname.startsWith('/vs/')){
    e.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok&&response.type==='basic'){const clone=response.clone();void caches.open(VERSION).then(c=>c.put(request,clone));}return response;})));
  }
});
/* A notification opens only the app origin; it never includes account tokens. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tag = String(event.notification.tag || '');
  const id = tag.startsWith('alicelabs-task-') ? tag.slice('alicelabs-task-'.length) : '';
  const url = new URL('/', self.location.origin);
  if (/^[a-f0-9-]{36}$/i.test(id)) url.searchParams.set('project', id);
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const existing = open.find(c => new URL(c.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(url.toString());
      await existing.focus();
    } else await self.clients.openWindow(url.toString());
  })());
});
