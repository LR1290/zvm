'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const source = fs.readFileSync(path.join(process.argv[2],'app/content/security/session/auth-ui.js'),'utf8');
  const between = (a,b) => source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  const functions = [
    ...source.split('\n').filter(line => /^var ZVM_LICENSE_KEY_/.test(line)),
    between('function compactLicenseKey','function keyLogicalOffset'),
    between('var AUTH_LOGIN_SPEC','function integrityNeedsManualRetry'),
    between('function applyAccountReauthNotice','function removeOverlay'),
    between('function wireOverlay','var _authGateGeneration')
  ].join('\n');
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  try {
    const page = await browser.newPage({offline:true});
    const result = await page.evaluate(async functions => {
      const OVERLAY_ID = 'overlay', _authGateDetail = null;
      let calls = 0, reject;
      function pending() { calls++; return new Promise((_,fail) => {reject=fail;}); }
      const sendSecurityRequest = pending, getLicenseService = () => ({_h:pending});
      const root = eval('(() => {' + functions + ';const el=buildOverlay();wireOverlay(el);return el;})()');
      const el = suffix => root.querySelector('#extapp' + suffix);
      const submit = suffix => el(suffix).dispatchEvent(new Event('submit',{cancelable:true}));
      const next = () => new Promise(resolve => setTimeout(resolve,0));
      el('AccountEmail').value = 'qa@example.invalid';
      el('AccountPassword').value = 'synthetic';
      el('OverlayKeyInput').value = 'ZV-ABCDE-ABCDE-ABCDE';
      const listeners=new Set();
      const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);
      window.addEventListener=(name,fn,...args)=>{if(name==='extui-s0-state')listeners.add(fn);return add(name,fn,...args)};
      window.removeEventListener=(name,fn,...args)=>{if(name==='extui-s0-state')listeners.delete(fn);return remove(name,fn,...args)};
      el('UseKeyBtn').click();
      submit('OverlayForm');
      const before=listeners.size;
      root.remove();
      await new Promise(resolve=>setTimeout(resolve,900));
      return {before,after:listeners.size,calls};
    }, functions);
    console.log(JSON.stringify(result));
    assert.deepEqual(result,{before:1,after:Number(process.argv[3]),calls:1});
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
