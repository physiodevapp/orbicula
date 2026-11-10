// Modo alojado (?host=physiq): se aplica ANTES de pintar, para que no se vea un instante la cabecera ni el
// tema claro dentro del hub. Sin dependencias; la misma regla está en src/integration/host.js (un test las compara).
(function () {
  try {
    if (new URLSearchParams(location.search).get('host') === 'physiq') {
      var root = document.documentElement;
      root.dataset.host = 'physiq';
      if (!root.dataset.theme) root.dataset.theme = 'dark'; // el hub es solo oscuro
    }
  } catch (e) { /* sin modo alojado */ }
})();
