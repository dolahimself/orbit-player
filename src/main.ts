import './style.css';

import '@videojs/html/video/player';
import '@videojs/html/ui/container';
import '@videojs/html/ui/gesture';
import '@videojs/html/ui/hotkey';
import '@videojs/html/media/mux-video';
import './orbit/orbit-controls';

import { films, FALLBACK_SRC, type Film } from './app/films';
import { createWheel } from './app/wheel';
import { initThemeSwitch } from './app/theme';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

const video = $<HTMLVideoElement>('#player mux-video');
const orbit = $('orbit-controls') as HTMLElementTagNameMap['orbit-controls'];
const player = $('#player');
const toast = $('.toast', player);
const details = $('#details');

let active = -1;
const failed = new Set<number>();

// ------------------------------------------------------------------ cards

const cardsRoot = $('#cards');
cardsRoot.innerHTML = films
  .map(
    (f, i) => `
    <div class="card" data-index="${i}" role="button" tabindex="-1" aria-label="${f.title}">
      <img src="${f.poster}" alt="" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" />
      <div class="card-label">${f.title}<span>${f.year} · ${f.genre}</span></div>
    </div>`,
  )
  .join('');
const cards = [...cardsRoot.querySelectorAll<HTMLElement>('.card')];

// ------------------------------------------------------------------ dial

const dial = $('#dial');
const ticks = $<SVGSVGElement>('.dial-ticks', dial);
const itemsRoot = $('.dial-items', dial);

itemsRoot.innerHTML = films
  .map(
    (f, i) =>
      `<button type="button" class="dial-item" data-index="${i}" tabindex="-1" aria-label="${f.title}"><img src="${f.thumb}" alt="" /></button>`,
  )
  .join('');
const dialItems = [...itemsRoot.querySelectorAll<HTMLElement>('.dial-item')];

// ------------------------------------------------------------------ film loading

function setTracks(f: Film) {
  for (const t of video.querySelectorAll('track')) t.remove();
  const tracks: [string, string][] = [
    ['en', 'Production notes'],
    ['es', 'Notas de producción'],
  ];
  for (const [lang, label] of tracks) {
    const el = document.createElement('track');
    el.kind = 'subtitles';
    el.srclang = lang;
    el.label = label;
    el.src = `/captions/${f.id}.${lang}.vtt`;
    video.append(el);
  }
}

let ambientFlip = false;
function setAmbient(src: string) {
  const [a, b] = document.querySelectorAll<HTMLImageElement>('.ambient img');
  const next = ambientFlip ? a : b;
  const prev = ambientFlip ? b : a;
  ambientFlip = !ambientFlip;
  next.onload = () => {
    next.toggleAttribute('data-on', true);
    prev.toggleAttribute('data-on', false);
  };
  next.src = src;
}

function renderDetails(f: Film, i: number) {
  const set = (k: string, html: string) => ($(`[data-f="${k}"]`, details).innerHTML = html);
  set('eyebrow', `${f.project} · Blender Foundation`);
  set('title', f.title);
  set('tagline', f.tagline);
  set(
    'meta',
    [String(f.year), f.genre, f.runtime, f.license]
      .map((m, n) => `${n ? '<li aria-hidden="true" class="text-faint">·</li>' : ''}<li>${m}</li>`)
      .join(''),
  );
  set('synopsis', f.synopsis);
  set(
    'credits',
    f.credits.map((c) => `<dt class="text-muted">${c.role}</dt><dd>${c.name}</dd>`).join(''),
  );
  set('facts', f.facts.map((t) => `<li>${t}</li>`).join(''));

  const n = String(i + 1).padStart(2, '0');
  $('#counter').innerHTML = `${n} <span class="text-faint">/ ${String(films.length).padStart(2, '0')}</span>`;
  document.title = `${f.title} · Orbit`;
}

function swapDetails(f: Film, i: number) {
  if (!details.dataset.ready) {
    renderDetails(f, i);
    details.dataset.ready = '1';
    return;
  }
  details.toggleAttribute('data-leaving', true);
  window.setTimeout(() => {
    renderDetails(f, i);
    requestAnimationFrame(() => details.toggleAttribute('data-leaving', false));
  }, 150);
}

function showToast(msg: string) {
  toast.textContent = msg;
  toast.toggleAttribute('data-show', true);
  window.setTimeout(() => toast.toggleAttribute('data-show', false), 4200);
}

function loadFilm(i: number, autoplay: boolean) {
  if (i === active) return;
  active = i;
  const f = films[i];
  orbit.reset();
  video.pause();
  video.poster = f.poster;
  video.src = failed.has(i) ? FALLBACK_SRC : f.src;
  setTracks(f);
  video.load();
  if (autoplay) video.play().catch(() => {});
  swapDetails(f, i);
  setAmbient(f.poster);
  dial.setAttribute('aria-valuenow', String(i + 1));
  dial.setAttribute('aria-valuetext', f.title);
}

video.addEventListener('error', () => {
  if (active < 0 || failed.has(active)) return;
  failed.add(active);
  video.src = FALLBACK_SRC;
  video.load();
  showToast('Couldn’t reach this film’s host, so a backup clip is playing.');
});

orbit.addEventListener('orbit-theater', (e) => {
  const on = (e as CustomEvent<boolean>).detail;
  document.body.toggleAttribute('data-theater', on);
  wheel.relayout();
});

// ------------------------------------------------------------------ wheel

const wheel = createWheel({
  count: films.length,
  stage: $('#stage'),
  cards,
  dial,
  ticks,
  dialItems,
  player,
  dialIndex: $('[data-f="dial-index"]', dial),
  dialTitle: $('[data-f="dial-title"]', dial),
  titles: films.map((f) => f.title),
  video,
  onCommit: (i, autoplay) => loadFilm(i, autoplay),
});

const tuck = () => dial.toggleAttribute('data-tucked', window.scrollY > 120);
window.addEventListener('scroll', tuck, { passive: true });
tuck();

initThemeSwitch($('.theme-switch'));

loadFilm(0, false);
wheel.jump(0);
