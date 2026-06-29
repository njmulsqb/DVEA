window.analyticsAPI.onName((_, name) => {
  // Extract any <meta> elements and inject them into <head>.
  // Chromium processes dynamically-appended meta-refresh tags, so a
  // meta-refresh payload causes navigation without executing any inline JS.
  const tmp = document.createElement('div');
  tmp.innerHTML = name;
  for (const meta of tmp.querySelectorAll('meta')) {
    document.head.appendChild(meta.cloneNode(true));
  }

  // Render the name in the table. CSP (script-src *) blocks inline event
  // handlers, so <img onerror="..."> injected here will not execute.
  document.getElementById('participantName').innerHTML = name;
});

document.addEventListener('securitypolicyviolation', (e) => {
  const banner = document.getElementById('csp-banner');
  banner.style.display = 'block';
  banner.innerHTML =
    '<strong>CSP blocked inline script execution</strong> — violated directive: <code>' +
    e.violatedDirective +
    '</code>. The redirect did not fire. Try the <code>&lt;meta&gt;</code> payload instead.';
});
