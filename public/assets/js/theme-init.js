// Classic script loaded in <head> to apply the saved theme before first paint (prevents a flash).
(function () {
  try {
    var t = localStorage.getItem('studenthub.proto.theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f3f5fa' : '#0a0e16');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'dark'); }
})();
