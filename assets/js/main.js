const copyEmail = (link) => {
  const label = link.textContent;
  const address = `${link.dataset.u}@${link.dataset.d}`;
  let timer;

  const flash = (text) => {
    link.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { link.textContent = label; }, 1500);
  };

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      flash('Copied');
    } catch {
      location.href = `mailto:${address}`;
    }
  });
};

// Grow-only --vh-lock is for touch browsers (collapsing URL bar); desktop windows re-measure on every resize.
const lockViewportHeight = () => {
  const root = document.documentElement.style;
  const portrait = matchMedia('(orientation: portrait)');
  const touch = matchMedia('(pointer: coarse)');
  let height;

  const set = (name, px) => root.setProperty(name, `${px}px`);

  const measure = () => {
    height = innerHeight;
    set('--vh-static', height);
    set('--vh-lock', height);
  };

  const grow = () => {
    if (innerHeight <= height) return;
    height = innerHeight;
    set('--vh-lock', height);
  };

  portrait.addEventListener('change', () => {
    measure();
    addEventListener('resize', measure, { once: true });
  });
  addEventListener('resize', () => (touch.matches ? grow() : measure()), { passive: true });
  measure();
};

// Moving a window to a screen with a different pixel ratio doesn't reliably fire 'resize'; re-dispatch it
// so every resize listener (scene buffer, CRT mask, viewport tokens) picks up the new devicePixelRatio.
const watchPixelRatio = () => {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
    dispatchEvent(new Event('resize'));
    watchPixelRatio();
  }, { once: true });
};

const fitHeadline = (headline) => {
  const lines = [...headline.children];
  let fit = 1;
  let lastWidth = 0;

  const naturalWidth = (line) => {
    const indent = parseFloat(getComputedStyle(line).paddingLeft);
    return { indent, text: (line.offsetWidth - indent) / fit };
  };

  const apply = () => {
    const available = headline.clientWidth;
    fit = Math.min(1, ...lines.map(naturalWidth).map(({ indent, text }) => (available - indent) / text));
    headline.style.setProperty('--fit', fit.toFixed(4));
  };

  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === lastWidth) return;
    lastWidth = entry.contentRect.width;
    apply();
  }).observe(headline);

  document.fonts.ready.then(apply);
};

const showHongKongTime = (el) => {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const tick = () => {
    const p = Object.fromEntries(format.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    el.textContent = `HKT ${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second}`;
  };
  tick();
  setInterval(tick, 1000);
};

const closeMenuOnNavigate = (menu) => {
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) menu.hidePopover();
  });
};

// Persisted on/off for the 3D scene. The switch's aria-checked is the state: scene.css and
// scene/index.js read it, and scene/index.js listens for 'motionchange'.
const toggleMotion = (button) => {
  const set = (on) => {
    button.setAttribute('aria-checked', String(on));
    localStorage.setItem('motion', on ? 'on' : 'off');
    document.dispatchEvent(new Event('motionchange'));
  };
  set(localStorage.getItem('motion') !== 'off');
  button.addEventListener('click', () => set(button.getAttribute('aria-checked') !== 'true'));
};

const toggleDisclosure = (button) => {
  button.addEventListener('click', () => {
    button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') !== 'true');
  });
};

// Fallback for browsers without scroll-driven animations; CSS derives travel from --progress.
const driveParallax = (el) => {
  if (CSS.supports('animation-timeline: scroll()')) return;
  const root = document.documentElement;
  let queued = false;

  const update = () => {
    queued = false;
    const max = root.scrollHeight - innerHeight;
    el.style.setProperty('--progress', max > 0 ? (scrollY / max).toFixed(4) : 0);
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue, { passive: true });
  update();
};

// Staggers cards that enter together; CSS keeps cards hidden until --revealed is set.
const revealOnScroll = (els) => {
  const observer = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach(({ target }, i) => {
      target.style.setProperty('--reveal-delay', `${i * 120}ms`);
      target.style.setProperty('--revealed', 1);
      observer.unobserve(target);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  els.forEach((el) => observer.observe(el));
};

// Overlay button toggles play/pause; video events (not the click) drive the label and icon state.
const playOnClick = (figure) => {
  const video = figure.querySelector('video');
  const button = figure.querySelector('button');
  const label = button.getAttribute('aria-label');

  const sync = () => {
    figure.toggleAttribute('data-playing', !video.paused);
    button.setAttribute('aria-label', video.paused ? label : label.replace(/^Play/, 'Pause'));
  };

  button.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  button.hidden = false;
};

// Videos ship with preload="none" so they never compete with the scripts and 3D scene at startup;
// buffering starts once a clip is within a viewport's distance. load() re-runs resource selection
// with the new preload value (changing the attribute alone isn't honoured by every browser).
const bufferNearViewport = (videos) => {
  const observer = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach(({ target }) => {
      observer.unobserve(target);
      if (!target.paused) return;
      target.preload = 'auto';
      target.load();
    });
  }, { rootMargin: '100% 0px' });
  videos.forEach((v) => observer.observe(v));
};

revealOnScroll(document.querySelectorAll('main > *'));
document.querySelectorAll('[data-is="clip"]').forEach(playOnClick);
bufferNearViewport(document.querySelectorAll('[data-is="clip"] > video'));
document.querySelectorAll('[data-is="vertical-logo"]').forEach(driveParallax);
document.querySelectorAll('button[aria-controls][aria-expanded]').forEach(toggleDisclosure);
document.querySelectorAll('[data-is="nav-menu"]').forEach(closeMenuOnNavigate);
document.querySelectorAll('[data-is="nav-actions"] > [role="switch"]').forEach(toggleMotion);
document.querySelectorAll('[data-is="hk-time"]').forEach(showHongKongTime);
document.querySelectorAll('a[data-u][data-d]').forEach(copyEmail);
document.querySelectorAll('[data-is="split-headline"]').forEach(fitHeadline);
lockViewportHeight();
watchPixelRatio();
