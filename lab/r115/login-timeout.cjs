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
      const start = performance.now();
      submit('AccountForm');
      el('UseKeyBtn').click();
      const switched = root.dataset.extuiLoginMode === 'key';
      for (let i=0;i<10000;i++) submit(i%2 ? 'AccountForm':'OverlayForm');
      const attempts = calls;
      const obsolete = reject;
      while(el('OverlaySubmitBtn').disabled && performance.now()-start<1500) await next();
      const wait = performance.now()-start;
      submit('OverlayForm');
      obsolete(Object.assign(new Error('obsolete'),{code:'ACCOUNT_MFA_REQUIRED'}));
      await next();
      if (!el('OverlaySubmitBtn').disabled) throw Error('obsolete completion unlocked new login');
      if(wait>=1000) throw Error('UI exceeded deadline '+wait);

      
      await next();
      const mfaHidden = el('AccountTotpGroup').hidden;
      el('UseAccountBtn').click();
      reject(new Error('obsolete key'));
      await next();
      return {wait,switched,attempts,mfaHidden,calls,restored:!el('AccountSubmitBtn').disabled,
        errorHidden:el('OverlayErrorBox').hidden, mode:root.dataset.extuiLoginMode};
    }, functions);
    console.log(JSON.stringify(result));
    const {wait,...state}=result;
    assert.deepEqual(state,{switched:true,attempts:1,mfaHidden:true,calls:2,restored:true,errorHidden:true,mode:'account'});
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
