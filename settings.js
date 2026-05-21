(() => {
  const ACCENTS = [
    { color: '#c8ff00' },
    { color: '#00e5ff' },
    { color: '#ff4d6d' },
    { color: '#ff9500' },
    { color: '#bf5af2' },
    { color: '#ffffff' }, // на светлой теме автоматом → #000000
  ];

  function luminance(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return (r*299 + g*587 + b*114) / 1000;
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r}, ${g}, ${b}`;
  }

  function isLightTheme(theme) { return theme === 'light'; }

  // Белый <-> Чёрный при смене темы
  function adaptAccentToTheme(accent, theme) {
    if (isLightTheme(theme) && accent === '#ffffff') return '#000000';
    if (!isLightTheme(theme) && accent === '#000000') return '#ffffff';
    return accent;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('it-theme', theme);
  }

  function applyAccent(hex) {
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-dim', `rgba(${hexToRgb(hex)}, 0.12)`);
    localStorage.setItem('it-accent', hex);
  }

  function accentFg(hex) {
    return luminance(hex) > 140 ? '#000' : '#fff';
  }

  function updateDynamicStyles(accent, theme) {
    let style = document.getElementById('_dyn-style');
    if (!style) {
      style = document.createElement('style');
      style.id = '_dyn-style';
      document.head.appendChild(style);
    }
    const fg = accentFg(accent);
    // Рамка активного свотча контрастна к фону
    const swBorder = isLightTheme(theme) ? '#111' : '#fff';

    // На светлой теме яркие акценты (лайм, белый/→чёрный уже подменён)
    // делаем чуть темнее в тексте где цвет акцента используется как fg
    const dimText = (isLightTheme(theme) && luminance(accent) > 180)
      ? `
        .nav a.active { color: color-mix(in srgb, var(--accent) 60%, #000) !important; }
        .logo a::before { color: color-mix(in srgb, var(--accent) 60%, #000) !important; }
        footer::before  { color: color-mix(in srgb, var(--accent) 60%, #000) !important; }
        .quality-val, .size-tag span { color: color-mix(in srgb, var(--accent) 60%, #000) !important; }
        .theme-btn.active { color: color-mix(in srgb, var(--accent) 60%, #000) !important; border-color: color-mix(in srgb, var(--accent) 60%, #000) !important; }
        `
      : '';

    style.textContent = `
      button.primary { background: var(--accent); border-color: var(--accent); color: ${fg}; font-weight: 700; }
      button.primary:hover { filter: brightness(1.1); color: ${fg}; }
      .accent-swatch.active { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px ${swBorder}; }
      ${dimText}
    `;
  }

  function syncSwatches(accent) {
    // Свотч #ffffff отображает и #000000 (они взаимозаменяемы)
    const logical = (accent === '#000000') ? '#ffffff' : accent;
    document.querySelectorAll('.accent-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === logical);
    });
  }

  function buildPanel() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    const btn = document.createElement('button');
    btn.className = 'settings-btn';
    btn.textContent = 'настройки';
    header.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.innerHTML = `
      <span class="sp-label">Тема</span>
      <div class="theme-options">
        <button class="theme-btn" data-t="black">Чёрная</button>
        <button class="theme-btn" data-t="dark">Тёмная</button>
        <button class="theme-btn" data-t="light">Белая</button>
      </div>
      <span class="sp-label">Акцент</span>
      <div class="accent-options" id="accentSwatches"></div>
    `;
    header.appendChild(panel);

    const swatchWrap = panel.querySelector('#accentSwatches');
    let currentAccent = localStorage.getItem('it-accent') || '#c8ff00';
    let currentTheme  = localStorage.getItem('it-theme')  || 'dark';

    ACCENTS.forEach(({ color }) => {
      const sw = document.createElement('div');
      sw.className = 'accent-swatch';
      sw.dataset.color = color; // всегда храним как #ffffff в data-атрибуте
      // Визуально свотч "#ffffff" на светлой теме показываем как чёрный
      const displayColor = (color === '#ffffff' && isLightTheme(currentTheme)) ? '#000000' : color;
      sw.style.background = displayColor;
      sw.title = color;

      const logicalCurrent = (currentAccent === '#000000') ? '#ffffff' : currentAccent;
      if (color === logicalCurrent) sw.classList.add('active');

      sw.onclick = () => {
        // Реальный акцент зависит от темы
        const realAccent = adaptAccentToTheme(color, currentTheme);
        currentAccent = realAccent;
        applyAccent(realAccent);
        syncSwatches(realAccent);
        updateDynamicStyles(realAccent, currentTheme);
      };
      swatchWrap.appendChild(sw);
    });

    panel.querySelectorAll('.theme-btn').forEach(b => {
      if (b.dataset.t === currentTheme) b.classList.add('active');
      b.onclick = () => {
        panel.querySelectorAll('.theme-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        currentTheme = b.dataset.t;
        applyTheme(currentTheme);

        // Адаптируем акцент (белый↔чёрный)
        const adapted = adaptAccentToTheme(currentAccent, currentTheme);
        currentAccent = adapted;
        applyAccent(adapted);
        syncSwatches(adapted);
        updateDynamicStyles(adapted, currentTheme);

        // Обновляем фон свотчей под новую тему
        swatchWrap.querySelectorAll('.accent-swatch').forEach(sw => {
          const c = sw.dataset.color;
          sw.style.background = (c === '#ffffff' && isLightTheme(currentTheme)) ? '#000000' : c;
        });
      };
    });

    btn.onclick = (e) => { e.stopPropagation(); panel.classList.toggle('open'); };
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('open');
    });
  }

  // Применяем до рендера — без мигания
  const savedTheme  = localStorage.getItem('it-theme')  || 'dark';
  let   savedAccent = localStorage.getItem('it-accent') || '#c8ff00';
  savedAccent = adaptAccentToTheme(savedAccent, savedTheme);
  applyTheme(savedTheme);
  applyAccent(savedAccent);
  updateDynamicStyles(savedAccent, savedTheme);

  document.addEventListener('DOMContentLoaded', buildPanel);
})();
