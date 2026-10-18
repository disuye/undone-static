const revealMailto = (link) => {
  const set = () => { link.href = `mailto:${link.dataset.u}@${link.dataset.d}`; };
  ['mouseover', 'touchstart', 'focus'].forEach((type) =>
    link.addEventListener(type, set, { once: true, passive: true }));
};

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

const lockViewportHeight = () => {
  const root = document.documentElement.style;
  const portrait = matchMedia('(orientation: portrait)');
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
  addEventListener('resize', grow, { passive: true });
  measure();
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

// Staggers cards that enter together; CSS keeps unrevealed cards hidden.
const revealOnScroll = (els) => {
  const observer = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach(({ target }, i) => {
      target.style.setProperty('--reveal-delay', `${i * 120}ms`);
      target.dataset.revealed = '';
      observer.unobserve(target);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  els.forEach((el) => observer.observe(el));
};

revealOnScroll(document.querySelectorAll(
  ['card', 'photo', 'divider', 'quote', 'spec', 'banner', 'dialog'].map((name) => `[data-is="${name}"]`).join()));
document.querySelectorAll('[data-is="vertical-logo"]').forEach(driveParallax);
document.querySelectorAll('button[aria-controls][aria-expanded]').forEach(toggleDisclosure);
document.querySelectorAll('[data-is="nav-menu"]').forEach(closeMenuOnNavigate);
document.querySelectorAll('[data-is="hk-time"]').forEach(showHongKongTime);
document.querySelectorAll('a[data-u][data-d]:not([data-copy])').forEach(revealMailto);
document.querySelectorAll('a[data-u][data-d][data-copy]').forEach(copyEmail);
document.querySelectorAll('[data-is="split-headline"]').forEach(fitHeadline);
lockViewportHeight();
