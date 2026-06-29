window.ipc.onRedirect((_, redirectUrl) => {
  console.log('[DVEA] Redirecting to:', redirectUrl);

  // 🚨 INTENTIONAL OPEN REDIRECT
  window.open(redirectUrl, '_blank');
});

// Optional: simulate without OS deep link

document.getElementById('simulate')?.addEventListener('click', () => {
  const url = 'https://example.com';
  window.open(url, '_blank');
});
