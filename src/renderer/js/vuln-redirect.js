


// Listen for deep link redirects from main
window.ipc.onRedirect((_, redirectUrl) => {
  console.log('[DVEA] Redirecting to:', redirectUrl);

  // 🚨 INTENTIONAL OPEN REDIRECT
  window.location.href = redirectUrl;
});

// Optional: simulate without OS deep link
document.getElementById('simulate')?.addEventListener('click', () => {
  const url = 'https://evil.com';
  window.location.href = url;
});
