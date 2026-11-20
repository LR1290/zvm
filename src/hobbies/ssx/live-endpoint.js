'use strict';
function publicBridgeEndpoint() {
  const raw=String(process.env.SSX_PUBLIC_BRIDGE_URL||'').trim();
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:' || u.hostname.toLowerCase()!=='script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) ||
      u.search || u.hash || u.username || u.password) return '';
    return u.toString();
  } catch {return '';}
}
module.exports={publicBridgeEndpoint};