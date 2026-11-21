#!/usr/bin/env python3
"""Tests the actual unpacked MV3 runtime. Does not need network or WhatsApp login."""
import json
import os
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

EXT = Path(__file__).resolve().parents[1] / 'extension'
with tempfile.TemporaryDirectory(prefix='zvm-v2-chrome-') as profile:
    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=profile,
                executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                headless=os.environ.get('CHROMIUM_HEADLESS', '1') != '0',
                args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--no-sandbox', '--disable-dev-shm-usage'],
            )
        except Exception as exc:
            raise RuntimeError(f'CHROMIUM_LAUNCH_BLOCKED: {exc}') from exc
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline and not context.service_workers:
            time.sleep(.2)
        workers = context.service_workers
        if not workers:
            print('CHROMIUM_MV3_UNAVAILABLE: service worker not exposed; not claiming integration validated')
            context.close()
            raise SystemExit(2)
        worker = workers[0]
        ext_id = worker.url.split('/')[2]
        assert worker.url.endswith('/background/worker.js'), worker.url
        page = context.new_page()
        console_errors = []
        page.on('pageerror', lambda err: console_errors.append(str(err)))
        page.goto(f'chrome-extension://{ext_id}/panel/popup.html')
        page.get_by_text('Respondendo', exact=True).wait_for(timeout=8000)
        page.get_by_text('Íntegras (v1)', exact=True).wait_for(timeout=8000)
        assert page.locator('#diagnostics').is_enabled()
        page.locator('#diagnostics').check()
        page.get_by_text('Preferência salva no navegador.').wait_for(timeout=5000)
        page.reload()
        page.get_by_text('Íntegras (v1)', exact=True).wait_for(timeout=5000)
        assert page.locator('#diagnostics').is_checked(), 'persistence failed after popup reload'
        assert not console_errors, console_errors
        print(json.dumps({'status':'CHROMIUM_MV3_PASS','extension_id':ext_id,'worker_url':worker.url,'worker':'RESPONDING','prefs_after_popup_reload':'PERSISTED','js_page_errors':console_errors}, ensure_ascii=False))
        context.close()
