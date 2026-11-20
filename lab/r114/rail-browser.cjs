'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function exercise(page, tree) {
  const source = fs.readFileSync(path.join(tree, 'app/sidebar/native-whatsapp-rail.js'), 'utf8');
  const functions = source.slice(source.indexOf('function setRailAttribute'), source.indexOf('function requestStateRefresh'));
  return page.evaluate(async functions => {
    const HOST_ID = 'rail';
    let refreshInFlight = false, refreshPending = false, refreshGeneration = 0, lastRefreshAt = 0;
    const report = () => {}, requestStateRefresh = () => {};
    let release;
    const commands = {state: command => command === 'slow' ? new Promise(resolve => { release = resolve; }) :
      Promise.resolve({registered:true, enabled:true})};
    const root = {ExtensionUI:{commands}};
    const refresh = eval('(' + 'function(){' + functions + 'return refreshStates;})')();
    document.body.innerHTML = '<div id="rail"></div>';
    const host = document.getElementById(HOST_ID);
    for (const command of ['slow','ready']) {
      const button = document.createElement('button');
      button.disabled = true;
      button.dataset.command = command;
      button.className = 'extuiNativeWaRailButton';
      host.append(button);
    }
    const [slow, ready] = host.children;
    const started = performance.now();
    const readyAt = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!ready.disabled) { observer.disconnect(); resolve(performance.now()-started); }
      });
      observer.observe(ready,{attributes:true});
    });
    refresh();
    await new Promise(resolve => setTimeout(resolve,1300));
    const independent = !ready.disabled && slow.disabled;
    release({registered:true,enabled:false});
    const elapsed = await readyAt;
    await new Promise(resolve => setTimeout(resolve,0));
    refresh();
    await Promise.resolve();
    refreshGeneration++;
    release({registered:true,enabled:true});
    await new Promise(resolve => setTimeout(resolve,0));
    return {independent, elapsed, staleDenied:slow.disabled};
  }, functions);
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  try {
    for (const [index,tree] of process.argv.slice(2).entries()) {
      const page = await browser.newPage({offline:true});
      const result = await exercise(page,tree);
      console.log(JSON.stringify({chromium:browser.version(), tree:path.basename(tree), ...result}));
      assert.equal(result.independent,index === 1);
      assert.ok(result.staleDenied);
      if (index === 1) assert.ok(result.elapsed < 100);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
