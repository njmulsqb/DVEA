window.analyticsAPI.onName((_, name) => {
  // Hoist any <meta> tags out of the submitted name into <head> (they have no effect inside the
  // table cell). Solution-relevant reasoning lives only in the withheld writeup, not here.
  const tmp = document.createElement('div');
  tmp.innerHTML = name;
  for (const meta of tmp.querySelectorAll('meta')) {
    document.head.appendChild(meta.cloneNode(true));
  }

  // Render the submitted name into the table.
  document.getElementById('participantName').innerHTML = name;

  // Notify main that we've injected the name/meta so it can re-scan (meta may be injected after load)
  try {
    if (window.analyticsAPI && window.analyticsAPI.injected) window.analyticsAPI.injected();
  } catch (err) {}
});

document.addEventListener('securitypolicyviolation', (e) => {
  const banner = document.getElementById('csp-banner');
  banner.style.display = 'block';
  banner.innerHTML =
    '<strong>Blocked by Content-Security-Policy</strong> — violated directive: <code>' +
    e.violatedDirective +
    '</code>.';
});
