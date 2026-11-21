/** Read-only endpoint; never touches chats, contacts or WhatsApp internals. */
(() => {
  if (location.origin !== 'https://web.whatsapp.com') return;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.protocol !== 1 || message.kind !== 'WEB_PRESENCE'
      || typeof message.requestId !== 'string' || !message.requestId.length || message.requestId.length > 64) return false;
    respond({
      protocol: 1,
      requestId: message.requestId,
      ok: true,
      data: { connected: true, documentReady: document.readyState === 'complete' }
    });
    return false;
  });
})();
