import {
  UIElement,
  PlayerController,
  playerContext,
  selectPlayback,
  selectTime,
  selectBuffer,
  selectVolume,
  selectControls,
  selectTextTrack,
  selectPlaybackRate,
  selectPiP,
  selectFullscreen,
  selectRemotePlayback,
  selectQuality,
  type PropertyValues,
} from '@videojs/html';

import '@videojs/html/ui/play-button';
import '@videojs/html/ui/seek-button';
import '@videojs/html/ui/mute-button';
import '@videojs/html/ui/volume-slider';
import '@videojs/html/ui/slider-track';
import '@videojs/html/ui/slider-fill';
import '@videojs/html/ui/slider-thumb';
import '@videojs/html/ui/pip-button';
import '@videojs/html/ui/fullscreen-button';
import '@videojs/html/ui/cast-button';
import '@videojs/html/ui/airplay-button';
import '@videojs/html/ui/thumbnail';

import {
  C,
  RING_R,
  RING_W,
  CENTER_R,
  SEG_OUTER,
  SEG_INNER,
  SEGMENTS,
  segmentPath,
  arcPath,
  polar,
  angleOf,
  circlePath,
} from './geometry';
import { icon } from './icons';
import { copy } from './copy';

type Panel = 'captions' | 'settings' | 'cast' | 'pip' | 'fullscreen';
type Size = 's' | 'm' | 'l';
type Position = 'center' | 'bottom' | 'corner';

type Accent = 'white' | 'amber' | 'coral' | 'mint' | 'sky' | 'violet';

interface Prefs {
  size: Size;
  position: Position;
  accent: Accent;
}

/** Control colours. White is the default; each stays readable over video. */
const ACCENTS: Record<Accent, string> = {
  white: '#ffffff',
  amber: '#ffb224',
  coral: '#ff6b6b',
  mint: '#3ddc97',
  sky: '#4da3ff',
  violet: '#a78bfa',
};

const SIZES: Record<Size, number> = { s: 132, m: 160, l: 192 };
const PREFS_KEY = 'orbit:prefs';
const LONG_PRESS_MS = 380;
/** Seconds per skip step. */
const SKIP_STEP = 10;
/** Hold-to-skip repeat: first gap, fastest gap, and how quickly it speeds up. */
const SKIP_REPEAT_START = 340;
const SKIP_REPEAT_MIN = 130;
const SKIP_REPEAT_EASE = 0.84;
/** How long the running total stays up after the last skip. */
const SKIP_SETTLE_MS = 900;
/** Degrees of rotation for a full 0–100% volume sweep. */
const VOLUME_SWEEP = 300;
const FLY_GAP = 12;
const FLY_H = 44;
const PANEL_GAP = 10;
const EDGE = 14;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = { size: 'm', position: 'center', accent: 'white', ...JSON.parse(raw) } as Prefs;
      if (!(p.accent in ACCENTS)) p.accent = 'white';
      return p;
    }
  } catch {
    /* storage unavailable */
  }
  return { size: 'm', position: 'center', accent: 'white' };
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** Shortest signed difference between two angles, in degrees. */
function angleDelta(a: number, b: number) {
  return ((b - a + 540) % 360) - 180;
}

/**
 * <orbit-controls>
 *
 * A circular control for Video.js 10. Five separate buttons (play in the
 * middle, menu, skip forward, volume and skip back around it) sit inside a
 * seek ring that touches their outer edge. Place it inside <media-container>.
 */
export class OrbitControlsElement extends UIElement {
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #time = new PlayerController(this, playerContext, selectTime);
  #buffer = new PlayerController(this, playerContext, selectBuffer);
  #volume = new PlayerController(this, playerContext, selectVolume);
  #controls = new PlayerController(this, playerContext, selectControls);
  #text = new PlayerController(this, playerContext, selectTextTrack);
  #rate = new PlayerController(this, playerContext, selectPlaybackRate);
  #pip = new PlayerController(this, playerContext, selectPiP);
  #fs = new PlayerController(this, playerContext, selectFullscreen);
  #remote = new PlayerController(this, playerContext, selectRemotePlayback);
  #quality = new PlayerController(this, playerContext, selectQuality);

  #built = false;
  #abort: AbortController | null = null;
  #resize: ResizeObserver | null = null;
  #prefs: Prefs = loadPrefs();
  #theater = false;

  // UI state
  #menuOpen = false;
  #panel: Panel | null = null;
  #volumeOpen = false;
  #volumeTimer = 0;
  #locks = new Set<string>();
  #releaseLock: (() => void) | null = null;

  // Ring state
  #hoverP: number | null = null;
  #scrubbing = false;
  #scrubP = 0;
  #lastScrubP = 0;
  #lastSeekAt = 0;
  #volDrag = false;
  #volAngle = 0;
  #volValue = 0;
  #pressTimer = 0;
  #suppressClick = false;

  // Skip bursts: taps in quick succession or a held skip button add up, like Netflix.
  #skipDir: 1 | -1 | 0 = 0;
  #skipTotal = 0;
  #skipTarget = 0;
  #skipHolding = false;
  #skipHoldTimer = 0;
  #skipRepeatTimer = 0;
  #skipSettleTimer = 0;
  #skipGap = SKIP_REPEAT_START;
  #skipSuppressClick = false;

  // Cached render keys so panels only rebuild when their inputs change.
  #captionsKey = '';
  #settingsKey = '';
  /** Quality picked in the menu, shown at once until the player reports it. */
  #qualityChoice: string | null = null;

  // Layout
  #W = 0;
  #H = 0;
  #size = SIZES.m;

  // Elements
  #els = {} as {
    orbit: HTMLElement;
    glass: HTMLElement;
    svg: SVGSVGElement;
    ringBuffer: SVGPathElement;
    ringHover: SVGPathElement;
    ringFill: SVGCircleElement;
    ringVolume: SVGCircleElement;
    ringHit: SVGCircleElement;
    blob: SVGGElement;
    ghost: SVGGElement;
    top: HTMLButtonElement;
    bottom: HTMLButtonElement;
    center: HTMLElement;
    time: HTMLElement;
    fly: HTMLElement;
    panels: HTMLElement;
    volume: HTMLElement;
    volumeValue: HTMLElement;
    preview: HTMLElement;
    previewThumb: HTMLElement & { time: number };
    previewTime: HTMLElement;
    ringA11y: HTMLElement;
    live: HTMLElement;
    skipFwd: HTMLElement;
    skipBack: HTMLElement;
    skipFwdNum: HTMLElement;
    skipBackNum: HTMLElement;
    skipFwdBadge: HTMLElement;
    skipBackBadge: HTMLElement;
  };

  connectedCallback() {
    super.connectedCallback();
    if (!this.#built) this.#build();
    this.#abort?.abort();
    this.#abort = new AbortController();
    this.#bind(this.#abort.signal);
    this.#resize = new ResizeObserver(() => this.#layout());
    this.#resize.observe(this.parentElement ?? this);
    this.#layout();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#abort = null;
    this.#resize?.disconnect();
    this.#resize = null;
    this.#releaseLock?.();
    this.#releaseLock = null;
    this.#locks.clear();
    this.#endSkip(false);
  }

  /** Close every popup; used when the app swaps films. */
  reset() {
    this.#setMenu(false);
    this.#setVolumeOpen(false);
    this.#captionsKey = '';
    this.#settingsKey = '';
    this.#qualityChoice = null;
  }

  set theater(v: boolean) {
    this.#theater = v;
    this.#settingsKey = '';
    this.#renderFullscreenPanel();
  }

  // ---------------------------------------------------------------- build

  #build() {
    this.#built = true;
    this.setAttribute('data-hidden', '');

    const segPath = (k: keyof typeof SEGMENTS) => segmentPath(SEGMENTS[k][0], SEGMENTS[k][1]);
    const segSvg = (k: keyof typeof SEGMENTS) =>
      `<svg class="seg-svg" viewBox="0 0 200 200" aria-hidden="true"><path class="seg-shape" d="${segPath(k)}"/></svg>`;

    const iconR = ((SEG_OUTER + SEG_INNER) / 2 / 200) * 100; // % of orbit size from centre
    const centerD = ((CENTER_R * 2) / 200) * 100;

    this.style.setProperty('--icon-r', `${iconR}%`);
    this.style.setProperty('--center-d', `${centerD}%`);

    const flyButton = (p: Panel, i: number, label: string, ic: string) =>
      `<button type="button" class="fly-btn" data-panel="${p}" aria-label="${label}" aria-expanded="false" aria-controls="orbit-panel-${p}" style="--i:${i}">
        <span class="fly-icon">${ic}</span><span class="fly-dot" aria-hidden="true"></span>
        <span class="tip" aria-hidden="true">${label}</span>
      </button>`;

    this.innerHTML = /* html */ `
      <div class="orbit-scrim" aria-hidden="true"></div>
      <div class="orbit-panels" data-interactive>
        <section class="orbit-panel" id="orbit-panel-captions" data-panel="captions" role="group" aria-label="${copy.subtitles}">
          <header class="panel-head">${copy.subtitles}</header>
          <div class="panel-body" data-slot="captions"></div>
        </section>
        <section class="orbit-panel" id="orbit-panel-settings" data-panel="settings" role="group" aria-label="${copy.settings}">
          <header class="panel-head">${copy.settings}</header>
          <div class="panel-body" data-slot="settings"></div>
        </section>
        <section class="orbit-panel" id="orbit-panel-cast" data-panel="cast" role="group" aria-label="${copy.cast}">
          <header class="panel-head">${copy.cast}</header>
          <div class="panel-body">
            <media-cast-button class="row row-btn">
              <span class="row-icon cast-off">${icon('castEnter')}</span>
              <span class="row-icon cast-on">${icon('castExit')}</span>
              <span class="row-label" data-slot="cast-label">${copy.castTo}</span>
            </media-cast-button>
            <media-airplay-button class="row row-btn">
              <span class="row-icon">${icon('airplay')}</span>
              <span class="row-label">${copy.airplay}</span>
            </media-airplay-button>
            <p class="panel-note" data-slot="cast-note"></p>
          </div>
        </section>
        <section class="orbit-panel" id="orbit-panel-pip" data-panel="pip" role="group" aria-label="${copy.pip}">
          <header class="panel-head">${copy.pip}</header>
          <div class="panel-body">
            <media-pip-button class="row row-btn">
              <span class="row-icon pip-off">${icon('pipEnter')}</span>
              <span class="row-icon pip-on">${icon('pipExit')}</span>
              <span class="row-label" data-slot="pip-label">${copy.pipEnter}</span>
              <kbd class="row-kbd">P</kbd>
            </media-pip-button>
            <p class="panel-note" data-slot="pip-note">${copy.pipHint}</p>
          </div>
        </section>
        <section class="orbit-panel" id="orbit-panel-fullscreen" data-panel="fullscreen" role="group" aria-label="${copy.fullscreen}">
          <header class="panel-head">${copy.fullscreen}</header>
          <div class="panel-body" data-slot="fullscreen">
            <media-fullscreen-button class="row row-btn">
              <span class="row-icon fs-off">${icon('fullscreenEnter')}</span>
              <span class="row-icon fs-on">${icon('fullscreenExit')}</span>
              <span class="row-label" data-slot="fs-label">${copy.fsEnter}</span>
              <kbd class="row-kbd">F</kbd>
            </media-fullscreen-button>
            <button type="button" class="row row-btn row-switch" data-action="theater" role="switch" aria-checked="false">
              <span class="row-label">${copy.theater}<small>${copy.theaterHint}</small></span>
              <span class="switch" aria-hidden="true"></span>
            </button>
          </div>
        </section>
      </div>

      <div class="orbit-fly" role="toolbar" aria-label="${copy.options}" data-interactive>
        ${flyButton('captions', 0, copy.subtitles, `<span class="sw-off">${icon('captionsOff')}</span><span class="sw-on">${icon('captionsOn')}</span>`)}
        ${flyButton('settings', 1, copy.settings, icon('gear', 'gear'))}
        ${flyButton('cast', 2, copy.cast, `<span class="sw-off">${icon('castEnter')}</span><span class="sw-on">${icon('castExit')}</span>`)}
        ${flyButton('pip', 3, copy.pip, `<span class="sw-off">${icon('pipEnter')}</span><span class="sw-on">${icon('pipExit')}</span>`)}
        ${flyButton('fullscreen', 4, copy.fullscreen, `<span class="sw-off">${icon('fullscreenEnter')}</span><span class="sw-on">${icon('fullscreenExit')}</span>`)}
      </div>

      <div class="orbit" data-interactive>
        <div class="orbit-glass" aria-hidden="true"></div>
        <svg class="orbit-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle class="ring-base" cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W}"/>
          <circle class="ring-track" cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W - 3}"/>
          <path class="ring-buffer" stroke-width="${RING_W - 3}" d=""/>
          <path class="ring-hover" stroke-width="${RING_W - 3}" d=""/>
          <circle class="ring-fill" cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W - 3}" pathLength="100" transform="rotate(-90 ${C} ${C})"/>
          <circle class="ring-volume" cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W - 3}" pathLength="100" transform="rotate(-90 ${C} ${C})"/>
          <circle class="ring-wait" cx="${C}" cy="${C}" r="${RING_R}" stroke-width="${RING_W - 3}" pathLength="100"/>
          <g class="ring-ghost"><circle r="4.5"/></g>
          <g class="ring-blob"><circle class="blob-halo" r="12"/><circle class="blob-dot" r="7.5"/></g>
          <circle class="ring-hit" cx="${C}" cy="${C}" r="${RING_R + 2}" stroke-width="${RING_W + 12}"/>
        </svg>

        <button type="button" class="seg seg-top" aria-label="${copy.menu}" aria-expanded="false" aria-haspopup="true">
          ${segSvg('top')}<span class="seg-icon">${icon('menu')}</span>
        </button>
        <media-seek-button class="seg seg-right" seconds="10">
          ${segSvg('right')}<span class="seg-icon seek-icon">${icon('seek')}<b>10</b></span>
        </media-seek-button>
        <span class="skip-badge fwd" aria-hidden="true"></span>
        <button type="button" class="seg seg-bottom" aria-label="${copy.volume}" aria-expanded="false">
          ${segSvg('bottom')}
          <span class="seg-icon vol-icon">
            <span class="vi vi-off">${icon('volumeOff')}</span>
            <span class="vi vi-low">${icon('volumeLow')}</span>
            <span class="vi vi-high">${icon('volumeHigh')}</span>
          </span>
        </button>
        <media-seek-button class="seg seg-left" seconds="-10">
          ${segSvg('left')}<span class="seg-icon seek-icon back">${icon('seek')}<b>10</b></span>
        </media-seek-button>
        <span class="skip-badge back" aria-hidden="true"></span>

        <media-play-button class="orbit-center">
          <span class="center-icon ci-play">${icon('play')}</span>
          <span class="center-icon ci-pause">${icon('pause')}</span>
          <span class="center-icon ci-replay">${icon('restart')}</span>
          <span class="orbit-time" aria-hidden="true">0:00</span>
        </media-play-button>

        <div class="ring-a11y" role="slider" tabindex="0" aria-label="${copy.seekRing}" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
      </div>

      <div class="orbit-volume" data-interactive>
        <media-mute-button class="vol-mute">
          <span class="vi vi-off">${icon('volumeOff')}</span>
          <span class="vi vi-low">${icon('volumeLow')}</span>
          <span class="vi vi-high">${icon('volumeHigh')}</span>
        </media-mute-button>
        <media-volume-slider class="vol-slider">
          <media-slider-track class="vol-track"><media-slider-fill class="vol-fill"></media-slider-fill></media-slider-track>
          <media-slider-thumb class="vol-thumb"></media-slider-thumb>
        </media-volume-slider>
        <span class="vol-value" aria-hidden="true">100</span>
      </div>

      <div class="orbit-preview" aria-hidden="true">
        <div class="preview-frame"><media-thumbnail class="preview-thumb"></media-thumbnail></div>
        <span class="preview-time">0:00</span>
      </div>

      <div class="sr-only" aria-live="polite" data-slot="live"></div>
    `;

    const q = <T extends Element>(s: string) => this.querySelector(s) as unknown as T;
    this.#els = {
      orbit: q('.orbit'),
      glass: q('.orbit-glass'),
      svg: q('.orbit-ring'),
      ringBuffer: q('.ring-buffer'),
      ringHover: q('.ring-hover'),
      ringFill: q('.ring-fill'),
      ringVolume: q('.ring-volume'),
      ringHit: q('.ring-hit'),
      blob: q('.ring-blob'),
      ghost: q('.ring-ghost'),
      top: q('.seg-top'),
      bottom: q('.seg-bottom'),
      center: q('.orbit-center'),
      time: q('.orbit-time'),
      fly: q('.orbit-fly'),
      panels: q('.orbit-panels'),
      volume: q('.orbit-volume'),
      volumeValue: q('.vol-value'),
      preview: q('.orbit-preview'),
      previewThumb: q('.preview-thumb'),
      previewTime: q('.preview-time'),
      ringA11y: q('.ring-a11y'),
      live: q('[data-slot="live"]'),
      skipFwd: q('.seg-right'),
      skipBack: q('.seg-left'),
      skipFwdNum: q('.seg-right .seek-icon b'),
      skipBackNum: q('.seg-left .seek-icon b'),
      skipFwdBadge: q('.skip-badge.fwd'),
      skipBackBadge: q('.skip-badge.back'),
    };
    this.#maskGlass();
    this.#applyAccent();
  }

  // ---------------------------------------------------------------- events

  #bind(signal: AbortSignal) {
    const e = this.#els;
    const on = <K extends keyof HTMLElementEventMap>(
      el: EventTarget,
      type: K | string,
      fn: (ev: any) => void,
      opts: AddEventListenerOptions = {},
    ) => el.addEventListener(type, fn, { signal, ...opts });

    // Menu
    on(e.top, 'click', () => this.#setMenu(!this.#menuOpen));

    // Flyout buttons open their panel
    on(e.fly, 'click', (ev: MouseEvent) => {
      const btn = (ev.target as Element).closest<HTMLElement>('.fly-btn');
      if (!btn) return;
      const p = btn.dataset.panel as Panel;
      this.#setPanel(this.#panel === p ? null : p);
    });

    // Panel actions (delegated)
    on(e.panels, 'click', (ev: MouseEvent) => {
      const t = (ev.target as Element).closest<HTMLElement>('[data-action]');
      if (!t) return;
      this.#action(t.dataset.action!, t.dataset.value);
    });

    // Volume segment: click toggles the slider, long press + circular drag sets level
    on(e.bottom, 'click', () => {
      if (this.#suppressClick) {
        this.#suppressClick = false;
        return;
      }
      this.#setVolumeOpen(!this.#volumeOpen);
    });
    on(e.bottom, 'pointerdown', (ev: PointerEvent) => this.#volPointerDown(ev));
    on(e.bottom, 'pointermove', (ev: PointerEvent) => this.#volPointerMove(ev));
    on(e.bottom, 'pointerup', (ev: PointerEvent) => this.#volPointerUp(ev));
    on(e.bottom, 'pointercancel', (ev: PointerEvent) => this.#volPointerUp(ev));
    on(e.bottom, 'contextmenu', (ev: Event) => ev.preventDefault());

    // Skip buttons: a tap skips 10 s (Video.js does the seek); holding keeps skipping.
    for (const [el, dir] of [
      [e.skipFwd, 1],
      [e.skipBack, -1],
    ] as const) {
      on(el, 'pointerdown', (ev: PointerEvent) => this.#skipPointerDown(ev, dir));
      on(el, 'pointerup', (ev: PointerEvent) => this.#skipPointerUp(ev));
      on(el, 'pointercancel', (ev: PointerEvent) => this.#skipPointerUp(ev));
      on(el, 'lostpointercapture', (ev: PointerEvent) => this.#skipPointerUp(ev));
      on(el, 'contextmenu', (ev: Event) => ev.preventDefault());
      // A plain tap (or Enter/Space) still counts toward the running total.
      on(el, 'click', () => this.#skipTap(dir));
    }
    // After a hold, swallow the click that follows release so it doesn't add 10 s more.
    on(
      e.orbit,
      'click',
      (ev: MouseEvent) => {
        if (!this.#skipSuppressClick) return;
        if (!(ev.target as Element).closest('.seg-right, .seg-left')) return;
        this.#skipSuppressClick = false;
        ev.stopPropagation();
        ev.preventDefault();
      },
      { capture: true },
    );

    // Keep the volume slider open while it's being used
    on(e.volume, 'pointerenter', () => this.#holdVolume());
    on(e.volume, 'pointerleave', () => this.#scheduleVolumeClose());
    on(e.volume, 'focusin', () => this.#holdVolume());
    on(e.volume, 'focusout', () => this.#scheduleVolumeClose());
    on(e.volume, 'pointerdown', () => this.#holdVolume());

    // Wheel over the orbit nudges volume
    on(
      e.orbit,
      'wheel',
      (ev: WheelEvent) => {
        ev.preventDefault();
        const v = this.#volume.value;
        if (!v) return;
        const next = Math.min(1, Math.max(0, (v.muted ? 0 : v.volume) - Math.sign(ev.deltaY) * 0.05));
        if (v.muted && next > 0) v.setMuted(false);
        v.setVolume(next);
        this.#setVolumeOpen(true);
        this.#scheduleVolumeClose();
      },
      { passive: false },
    );

    // Seek ring
    on(e.ringHit, 'pointerenter', (ev: PointerEvent) => this.#ringHover(ev));
    on(e.ringHit, 'pointermove', (ev: PointerEvent) => this.#ringMove(ev));
    on(e.ringHit, 'pointerleave', () => this.#ringLeave());
    on(e.ringHit, 'pointerdown', (ev: PointerEvent) => this.#ringDown(ev));
    on(e.ringHit, 'pointerup', (ev: PointerEvent) => this.#ringUp(ev));
    on(e.ringHit, 'pointercancel', (ev: PointerEvent) => this.#ringUp(ev));
    on(e.ringA11y, 'keydown', (ev: KeyboardEvent) => this.#ringKey(ev));
    on(e.ringA11y, 'focus', () => this.toggleAttribute('data-ring-focus', true));
    on(e.ringA11y, 'blur', () => this.toggleAttribute('data-ring-focus', false));


    // Escape closes the innermost popup; clicks outside close everything
    on(this.parentElement ?? this, 'keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (this.#panel) {
        const p = this.#panel;
        this.#setPanel(null);
        this.querySelector<HTMLElement>(`.fly-btn[data-panel="${p}"]`)?.focus();
      } else if (this.#menuOpen) {
        this.#setMenu(false);
        e.top.focus();
      } else if (this.#volumeOpen) this.#setVolumeOpen(false);
    });
    on(document, 'pointerdown', (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (!this.contains(t)) {
        if (this.#menuOpen) this.#setMenu(false);
        if (this.#volumeOpen) this.#setVolumeOpen(false);
        return;
      }
      const inside = (sel: string) => (t as Element).closest?.(sel);
      if (this.#panel && !inside('.orbit-panels') && !inside('.orbit-fly')) this.#setPanel(null);
    });
  }

  // ---------------------------------------------------------------- menu & panels

  #setMenu(open: boolean) {
    this.#menuOpen = open;
    if (!open) this.#setPanel(null);
    this.toggleAttribute('data-menu-open', open);
    this.#els.top.setAttribute('aria-expanded', String(open));
    this.#els.top.setAttribute('aria-label', open ? copy.closeMenu : copy.menu);
    this.#lock('menu', open);
    if (open) this.#setVolumeOpen(false);
    this.#layout();
  }

  #setPanel(p: Panel | null) {
    this.#panel = p;
    for (const btn of this.querySelectorAll<HTMLElement>('.fly-btn')) {
      btn.setAttribute('aria-expanded', String(btn.dataset.panel === p));
    }
    for (const el of this.querySelectorAll<HTMLElement>('.orbit-panel')) {
      el.toggleAttribute('data-open', el.dataset.panel === p);
    }
    if (p) this.setAttribute('data-panel', p);
    else this.removeAttribute('data-panel');
    this.#lock('panel', !!p);
    if (p === 'captions') this.#captionsKey = '';
    if (p === 'settings') this.#settingsKey = '';
    this.#render();
    this.#layout();
  }

  #action(action: string, value?: string) {
    const rate = this.#rate.value;
    const text = this.#text.value;
    const quality = this.#quality.value;
    switch (action) {
      case 'track':
        text?.selectSubtitlesTrack(value === 'off' ? null : value!);
        this.#announce(value === 'off' ? `${copy.subtitles}: ${copy.off}` : '');
        break;
      case 'rate':
        rate?.setPlaybackRate(Number(value));
        break;
      case 'quality':
        this.#qualityChoice = value!;
        this.#settingsKey = '';
        quality?.selectVideoRendition(value!);
        break;
      case 'size':
        this.#prefs.size = value as Size;
        savePrefs(this.#prefs);
        this.#settingsKey = '';
        this.#layout();
        break;
      case 'position':
        this.#prefs.position = value as Position;
        savePrefs(this.#prefs);
        this.#settingsKey = '';
        this.#layout();
        break;
      case 'accent':
        this.#prefs.accent = value as Accent;
        savePrefs(this.#prefs);
        this.#settingsKey = '';
        this.#applyAccent();
        break;
      case 'loop': {
        const video = this.#video();
        if (video) video.loop = !video.loop;
        this.#settingsKey = '';
        break;
      }
      case 'theater':
        this.#theater = !this.#theater;
        this.dispatchEvent(new CustomEvent('orbit-theater', { bubbles: true, detail: this.#theater }));
        this.#renderFullscreenPanel();
        break;
    }
    this.#render();
  }

  #video(): HTMLVideoElement | null {
    return this.parentElement?.querySelector(':scope > mux-video, :scope > video') ?? null;
  }

  // ---------------------------------------------------------------- volume

  #setVolumeOpen(open: boolean) {
    this.#volumeOpen = open;
    this.toggleAttribute('data-volume-open', open);
    this.#els.bottom.setAttribute('aria-expanded', String(open));
    this.#lock('volume', open);
    clearTimeout(this.#volumeTimer);
    if (open) this.#scheduleVolumeClose(3200);
    this.#layout();
  }

  #holdVolume() {
    clearTimeout(this.#volumeTimer);
  }

  #scheduleVolumeClose(ms = 2200) {
    clearTimeout(this.#volumeTimer);
    this.#volumeTimer = window.setTimeout(() => {
      if (this.#els.volume.matches(':hover, :focus-within')) return;
      this.#setVolumeOpen(false);
    }, ms);
  }

  #center(): { x: number; y: number; scale: number } {
    const r = this.#els.orbit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, scale: r.width / 200 };
  }

  #volPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    const { x, y } = this.#center();
    this.#volAngle = angleOf(ev.clientX, ev.clientY, x, y);
    clearTimeout(this.#pressTimer);
    this.#pressTimer = window.setTimeout(() => {
      const v = this.#volume.value;
      if (!v) return;
      this.#volDrag = true;
      this.#volValue = v.muted ? 0 : v.volume;
      if (v.muted) v.setMuted(false);
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      this.toggleAttribute('data-vol-drag', true);
      this.#lock('voldrag', true);
      navigator.vibrate?.(8);
      this.#render();
    }, LONG_PRESS_MS);
  }

  #volPointerMove(ev: PointerEvent) {
    if (!this.#volDrag) return;
    const { x, y } = this.#center();
    const a = angleOf(ev.clientX, ev.clientY, x, y);
    const d = angleDelta(this.#volAngle, a);
    this.#volAngle = a;
    this.#volValue = Math.min(1, Math.max(0, this.#volValue + d / VOLUME_SWEEP));
    this.#volume.value?.setVolume(this.#volValue);
  }

  #volPointerUp(ev: PointerEvent) {
    clearTimeout(this.#pressTimer);
    if (!this.#volDrag) return;
    this.#volDrag = false;
    this.#suppressClick = true;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    this.toggleAttribute('data-vol-drag', false);
    this.#lock('voldrag', false);
    this.#render();
  }

  // ---------------------------------------------------------------- skip bursts

  #skipPointerDown(ev: PointerEvent, dir: 1 | -1) {
    if (ev.button !== 0) return;
    this.#skipSuppressClick = false;
    clearTimeout(this.#skipHoldTimer);
    const el = ev.currentTarget as Element;
    const id = ev.pointerId;
    this.#skipHoldTimer = window.setTimeout(() => {
      const time = this.#time.value;
      if (!time || !time.duration) return;
      el.setPointerCapture?.(id);
      this.#skipHolding = true;
      this.#skipSuppressClick = true;
      this.#skipGap = SKIP_REPEAT_START;
      if (this.#skipDir !== dir) this.#resetSkipBurst(dir);
      // Continue from where an earlier tap in this burst was heading, if any.
      if (!this.#skipTotal) this.#skipTarget = time.currentTime;
      this.toggleAttribute('data-skip-holding', true);
      this.#lock('skip', true);
      navigator.vibrate?.(8);
      this.#skipStep(dir);
    }, LONG_PRESS_MS);
  }

  #skipPointerUp(ev: PointerEvent) {
    clearTimeout(this.#skipHoldTimer);
    if (!this.#skipHolding) return;
    (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId);
    this.#endSkip(true);
  }

  /** One held step: seek by 10 s from the running target, then schedule the next. */
  #skipStep(dir: 1 | -1) {
    if (!this.#skipHolding) return;
    const time = this.#time.value;
    if (!time || !time.duration) return this.#endSkip(true);
    const next = Math.min(time.duration, Math.max(0, this.#skipTarget + dir * SKIP_STEP));
    const moved = Math.abs(next - this.#skipTarget) > 0.01;
    if (moved) {
      this.#skipTarget = next;
      time.seek(next);
      this.#addToBurst(dir, SKIP_STEP);
    }
    // Stop at either end of the video.
    if (!moved || next <= 0 || next >= time.duration) return;
    this.#skipRepeatTimer = window.setTimeout(() => this.#skipStep(dir), this.#skipGap);
    this.#skipGap = Math.max(SKIP_REPEAT_MIN, this.#skipGap * SKIP_REPEAT_EASE);
  }

  /** A tap: Video.js already seeked, so only count it. */
  #skipTap(dir: 1 | -1) {
    if (this.#skipHolding) return;
    const time = this.#time.value;
    if (this.#skipDir !== dir || !this.#skipTotal) {
      this.#resetSkipBurst(dir);
      this.#skipTarget = time?.currentTime ?? 0;
    }
    const dur = time?.duration ?? Infinity;
    this.#skipTarget = Math.min(dur, Math.max(0, this.#skipTarget + dir * SKIP_STEP));
    this.#addToBurst(dir, SKIP_STEP);
    this.#scheduleSkipSettle();
  }

  #resetSkipBurst(dir: 1 | -1) {
    if (this.#skipDir && this.#skipDir !== dir) this.#showSkip(this.#skipDir, 0);
    this.#skipDir = dir;
    this.#skipTotal = 0;
  }

  #addToBurst(dir: 1 | -1, seconds: number) {
    this.#skipTotal += seconds;
    this.#showSkip(dir, this.#skipTotal);
    this.#nudgeSkipIcon(dir);
    clearTimeout(this.#skipSettleTimer);
  }

  #scheduleSkipSettle() {
    clearTimeout(this.#skipSettleTimer);
    this.#skipSettleTimer = window.setTimeout(() => this.#settleSkip(), SKIP_SETTLE_MS);
  }

  #endSkip(settle: boolean) {
    clearTimeout(this.#skipHoldTimer);
    clearTimeout(this.#skipRepeatTimer);
    if (this.#skipHolding) {
      this.#skipHolding = false;
      this.toggleAttribute('data-skip-holding', false);
      this.#lock('skip', false);
    }
    if (settle) this.#scheduleSkipSettle();
    else {
      clearTimeout(this.#skipSettleTimer);
      this.#settleSkip(false);
    }
  }

  #settleSkip(announce = true) {
    const dir = this.#skipDir;
    const total = this.#skipTotal;
    if (dir) this.#showSkip(dir, 0);
    if (announce && dir && total > SKIP_STEP) {
      this.#announce(`${dir > 0 ? copy.skippedForward : copy.skippedBack} ${total} ${copy.seconds}`);
    }
    this.#skipDir = 0;
    this.#skipTotal = 0;
  }

  /** Show the running total on the arrow and in the badge beside it; 0 resets. */
  #showSkip(dir: 1 | -1, total: number) {
    const num = dir > 0 ? this.#els.skipFwdNum : this.#els.skipBackNum;
    const badge = dir > 0 ? this.#els.skipFwdBadge : this.#els.skipBackBadge;
    num.textContent = String(total || SKIP_STEP);
    num.toggleAttribute('data-wide', total >= 100);
    // A single tap needs no badge; the arrow already says 10.
    const show = total > SKIP_STEP;
    if (show) badge.textContent = `${dir > 0 ? '+' : '−'}${total}s`;
    badge.toggleAttribute('data-show', show);
  }

  #nudgeSkipIcon(dir: 1 | -1) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const svg = (dir > 0 ? this.#els.skipFwd : this.#els.skipBack).querySelector('.seek-icon > svg');
    svg?.animate(
      [{ rotate: '0deg' }, { rotate: `${dir * 36}deg` }, { rotate: '0deg' }],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  // ---------------------------------------------------------------- seek ring

  #pFromEvent(ev: PointerEvent): number {
    const { x, y } = this.#center();
    return angleOf(ev.clientX, ev.clientY, x, y) / 360;
  }

  #ringHover(ev: PointerEvent) {
    if (ev.pointerType === 'touch') return;
    this.#ringMove(ev);
  }

  #ringMove(ev: PointerEvent) {
    let p = this.#pFromEvent(ev);
    if (this.#scrubbing) {
      // Don't let a drag wrap across twelve o'clock from the end to the start.
      if (Math.abs(p - this.#lastScrubP) > 0.5) p = this.#lastScrubP > 0.5 ? 1 : 0;
      this.#lastScrubP = p;
      this.#scrubP = p;
      const now = performance.now();
      if (now - this.#lastSeekAt > 140) {
        this.#lastSeekAt = now;
        this.#seekTo(p);
      }
    } else if (ev.pointerType !== 'touch') {
      this.#hoverP = p;
    }
    this.toggleAttribute('data-ring-hover', true);
    this.#renderRing();
    this.#renderPreview();
  }

  #ringLeave() {
    if (this.#scrubbing) return;
    this.#hoverP = null;
    this.toggleAttribute('data-ring-hover', false);
    this.#renderRing();
    this.#renderPreview();
  }

  #ringDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const time = this.#time.value;
    if (!time || !time.duration) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    this.#scrubbing = true;
    this.#scrubP = this.#lastScrubP = this.#pFromEvent(ev);
    this.#lastSeekAt = 0;
    this.toggleAttribute('data-scrubbing', true);
    this.#lock('scrub', true);
    this.#ringMove(ev);
  }

  #ringUp(ev: PointerEvent) {
    if (!this.#scrubbing) return;
    this.#scrubbing = false;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    this.#seekTo(this.#scrubP);
    this.toggleAttribute('data-scrubbing', false);
    this.#lock('scrub', false);
    if (ev.pointerType === 'touch') {
      this.#hoverP = null;
      this.toggleAttribute('data-ring-hover', false);
    }
    this.#renderRing();
    this.#renderPreview();
  }

  #ringKey(ev: KeyboardEvent) {
    const time = this.#time.value;
    if (!time) return;
    const steps: Record<string, number> = {
      ArrowRight: 5,
      ArrowUp: 5,
      ArrowLeft: -5,
      ArrowDown: -5,
      PageUp: 30,
      PageDown: -30,
    };
    if (ev.key in steps) {
      ev.preventDefault();
      ev.stopPropagation();
      time.seek(Math.max(0, Math.min(time.duration, time.currentTime + steps[ev.key])));
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      time.seek(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      time.seek(time.duration);
    }
  }

  #seekTo(p: number) {
    const time = this.#time.value;
    if (!time || !time.duration) return;
    time.seek(Math.min(time.duration - 0.05, Math.max(0, p * time.duration)));
  }

  // ---------------------------------------------------------------- controls lock

  #lock(key: string, on: boolean) {
    if (on) this.#locks.add(key);
    else this.#locks.delete(key);
    if (this.#locks.size && !this.#releaseLock) {
      this.#releaseLock = this.#controls.value?.requestControlsLock() ?? null;
    } else if (!this.#locks.size && this.#releaseLock) {
      this.#releaseLock();
      this.#releaseLock = null;
    }
  }

  #announce(msg: string) {
    if (!msg) return;
    this.#els.live.textContent = '';
    requestAnimationFrame(() => (this.#els.live.textContent = msg));
  }

  // ---------------------------------------------------------------- layout

  #layout() {
    if (!this.#built) return;
    const host = this.parentElement;
    if (!host) return;
    const W = host.clientWidth;
    const H = host.clientHeight;
    if (!W || !H) return;
    this.#W = W;
    this.#H = H;

    const compact = H < 340 || W < 420;
    this.toggleAttribute('data-compact', compact);

    const pref = SIZES[this.#prefs.size];
    const size = Math.round(Math.max(104, Math.min(pref, H * 0.56, W * 0.42)));
    this.#size = size;

    let cx = W / 2;
    let cy = H / 2;
    const pad = Math.max(EDGE, H * 0.05);
    if (this.#prefs.position === 'bottom') {
      cy = H - size / 2 - pad;
    } else if (this.#prefs.position === 'corner') {
      cx = W - size / 2 - pad;
      cy = H - size / 2 - pad;
    }

    // Room above the orbit for the option row and the open panel.
    const above = this.#menuOpen ? FLY_GAP + FLY_H : 0;
    let panelH = 0;
    if (this.#panel && !compact) {
      const panel = this.querySelector<HTMLElement>(`.orbit-panel[data-panel="${this.#panel}"]`);
      panelH = panel ? panel.scrollHeight : 0;
    }
    const needAbove = above + (panelH ? PANEL_GAP + panelH : 0);
    const minTop = EDGE + needAbove;
    const maxTop = H - size - EDGE - (this.#volumeOpen ? 56 : 0);
    let top = cy - size / 2;
    if (top < minTop) top = Math.min(minTop, Math.max(EDGE + above, maxTop));
    if (top > maxTop) top = Math.max(EDGE + above, maxTop);
    cy = top + size / 2;

    // In the corner, keep the option row inside the frame.
    const flyW = 5 * FLY_H + 4 * 6;
    const flyX = Math.min(W - flyW / 2 - EDGE, Math.max(flyW / 2 + EDGE, cx));
    const panelW = Math.min(300, W - EDGE * 2);
    const panelX = Math.min(W - panelW / 2 - EDGE, Math.max(panelW / 2 + EDGE, cx));
    const panelMax = Math.max(120, top - above - PANEL_GAP - EDGE);

    const s = this.style;
    s.setProperty('--orbit-size', `${size}px`);
    s.setProperty('--cx', `${cx}px`);
    s.setProperty('--cy', `${cy}px`);
    s.setProperty('--fly-x', `${flyX}px`);
    s.setProperty('--panel-x', `${panelX}px`);
    s.setProperty('--panel-w', `${panelW}px`);
    s.setProperty('--panel-max', compact ? `${H - EDGE * 2}px` : `${panelMax}px`);
    s.setProperty('--fly-scale', String(Math.min(1, (W - EDGE * 2) / flyW)));
    // Skip totals sit beside the ring; with no room at a side, they move above it.
    const badgeRoom = 84;
    this.toggleAttribute('data-skip-above', cx + size / 2 + badgeRoom > W || cx - size / 2 - badgeRoom < 0);

  }

  /** Set the control colour used by the seek ring, volume level and selected options. */
  #applyAccent() {
    const accent = this.#prefs.accent;
    this.style.setProperty('--orbit-accent', ACCENTS[accent]);
    this.setAttribute('data-accent', accent);
  }

  /**
   * Mask the frosted backdrop to the button shapes so the gaps between buttons
   * stay clear. A mask (not clip-path: path()) because Chromium ignores path
   * clips on backdrop-filter. Drawn once in viewBox units, so it scales freely.
   */
  #maskGlass() {
    const d = [
      circlePath(RING_R + RING_W / 2, C, C),
      circlePath(RING_R - RING_W / 2, C, C, true),
      circlePath(CENTER_R, C, C),
      ...(Object.keys(SEGMENTS) as (keyof typeof SEGMENTS)[]).map((key) =>
        segmentPath(SEGMENTS[key][0], SEGMENTS[key][1]),
      ),
    ].join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="${d}"/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const g = this.#els.glass.style;
    g.setProperty('mask-image', url);
    g.setProperty('-webkit-mask-image', url);
  }

  // ---------------------------------------------------------------- render

  update(changed: PropertyValues) {
    super.update(changed);
    this.#render();
  }

  #render() {
    if (!this.#built) return;

    const playback = this.#playback.value;
    const time = this.#time.value;
    const volume = this.#volume.value;
    const controls = this.#controls.value;
    const text = this.#text.value;
    const pip = this.#pip.value;
    const fs = this.#fs.value;
    const remote = this.#remote.value;

    const paused = playback?.paused ?? true;
    const visible = (controls?.controlsVisible ?? true) || paused || this.#locks.size > 0;
    this.toggleAttribute('data-hidden', !visible);
    this.toggleAttribute('data-paused', paused);
    this.toggleAttribute('data-ended', !!playback?.ended);
    this.toggleAttribute('data-waiting', !!playback?.waiting && !paused);

    // Volume
    const level = !volume || volume.muted || volume.volume === 0 ? 'off' : volume.volume < 0.5 ? 'low' : 'high';
    this.setAttribute('data-volume-level', level);
    const pct = Math.round((volume?.muted ? 0 : volume?.volume ?? 1) * 100);
    this.#els.volumeValue.textContent = String(pct);
    this.#els.ringVolume.style.strokeDasharray = `${pct} 100`;

    // Center readout
    let readout = formatTime(time?.currentTime ?? 0);
    if (this.#volDrag) readout = `${pct}%`;
    else if (this.#scrubbing) readout = formatTime(this.#scrubP * (time?.duration ?? 0));
    this.#els.time.textContent = readout;

    // Accessible seek ring
    const a = this.#els.ringA11y;
    const dur = Math.floor(time?.duration ?? 0);
    a.setAttribute('aria-valuemax', String(dur));
    a.setAttribute('aria-valuenow', String(Math.floor(time?.currentTime ?? 0)));
    a.setAttribute('aria-valuetext', `${formatTime(time?.currentTime ?? 0)} of ${formatTime(time?.duration ?? 0)}`);

    // Option row state (icon swap + dot, never colour alone)
    const setFly = (p: Panel, on: boolean, hidden = false) => {
      const b = this.querySelector<HTMLElement>(`.fly-btn[data-panel="${p}"]`);
      b?.toggleAttribute('data-on', on);
      b?.toggleAttribute('data-unavailable', hidden);
    };
    setFly('captions', !!text?.subtitlesShowing);
    setFly('cast', remote?.remotePlaybackState === 'connected');
    setFly('pip', !!pip?.isPictureInPicture);
    setFly('fullscreen', !!fs?.isFullscreen);


    this.#renderRing();
    this.#renderPreview();
    if (this.#panel === 'captions') this.#renderCaptions();
    if (this.#panel === 'settings') this.#renderSettings();
    if (this.#panel === 'cast') this.#renderCast();
    if (this.#panel === 'pip') this.#renderPip();
    if (this.#panel === 'fullscreen') this.#renderFullscreenPanel();
  }

  #renderRing() {
    const time = this.#time.value;
    const buffer = this.#buffer.value;
    const dur = time?.duration ?? 0;
    const cur = time?.currentTime ?? 0;
    const p = this.#scrubbing ? this.#scrubP : dur ? cur / dur : 0;

    this.#els.ringFill.style.strokeDasharray = `${(p * 100).toFixed(3)} 100`;
    const [bx, by] = polar(RING_R, p * 360);
    this.#els.blob.setAttribute('transform', `translate(${bx.toFixed(2)} ${by.toFixed(2)})`);

    // Buffered ranges as arcs
    let d = '';
    if (dur && buffer?.buffered) {
      for (const [s, e] of buffer.buffered) d += arcPath(RING_R, (s / dur) * 360, (e / dur) * 360) + ' ';
    }
    this.#els.ringBuffer.setAttribute('d', d.trim());

    // Hover: light arc between the playhead and the pointer, like a timeline hover fill
    const h = this.#scrubbing ? null : this.#hoverP;
    if (h != null && dur) {
      const [from, to] = h > p ? [p, h] : [h, p];
      this.#els.ringHover.setAttribute('d', arcPath(RING_R, from * 360, to * 360));
      const [gx, gy] = polar(RING_R, h * 360);
      this.#els.ghost.setAttribute('transform', `translate(${gx.toFixed(2)} ${gy.toFixed(2)})`);
    } else {
      this.#els.ringHover.setAttribute('d', '');
    }
  }

  #renderPreview() {
    const time = this.#time.value;
    const dur = time?.duration ?? 0;
    const p = this.#scrubbing ? this.#scrubP : this.#hoverP;
    const show = p != null && dur > 0;
    this.#els.preview.toggleAttribute('data-show', show);
    if (!show) return;

    const t = p! * dur;
    this.#els.previewTime.textContent = formatTime(t);

    // Frames come from the Mux storyboard track that <mux-video> adds.
    this.#els.previewThumb.time = t;

    // Place the bubble just outside the ring at the pointer's angle, kept in frame.
    const W = this.#W;
    const H = this.#H;
    const size = this.#size;
    const cx = parseFloat(this.style.getPropertyValue('--cx')) || W / 2;
    const cy = parseFloat(this.style.getPropertyValue('--cy')) || H / 2;
    const pw = Math.min(176, W * 0.36);
    const ph = pw * (9 / 16) + 26;
    const deg = p! * 360;
    const rad = ((deg - 90) * Math.PI) / 180;
    // Distance from centre so the box clears the ring along this direction.
    const reach = Math.abs(Math.cos(rad)) * (pw / 2) + Math.abs(Math.sin(rad)) * (ph / 2);
    const r = size / 2 + 14 + reach;
    let x = cx + Math.cos(rad) * r;
    let y = cy + Math.sin(rad) * r;
    x = Math.min(W - pw / 2 - 8, Math.max(pw / 2 + 8, x));
    y = Math.min(H - ph / 2 - 8, Math.max(ph / 2 + 8, y));
    this.style.setProperty('--pv-x', `${x}px`);
    this.style.setProperty('--pv-y', `${y}px`);
    this.style.setProperty('--pv-w', `${pw}px`);
  }

  #renderCaptions() {
    const text = this.#text.value;
    const slot = this.querySelector<HTMLElement>('[data-slot="captions"]')!;
    const tracks = (text?.textTrackList ?? []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    const showing = tracks.find((t) => t.mode === 'showing');
    const key = tracks.map((t) => `${t.id}:${t.mode}`).join('|');
    if (key === this.#captionsKey) return;
    this.#captionsKey = key;

    if (!tracks.length) {
      slot.innerHTML = `<p class="panel-note">${copy.noTracks}</p>`;
      return;
    }
    const opt = (id: string, label: string, sub: string, on: boolean) => `
      <button type="button" class="row row-btn row-opt" role="menuitemradio" aria-checked="${on}" data-action="track" data-value="${id}">
        <span class="row-check">${on ? icon('check') : ''}</span>
        <span class="row-label">${label}${sub ? `<small>${sub}</small>` : ''}</span>
      </button>`;
    slot.innerHTML =
      `<div role="menu" aria-label="${copy.subtitles}">` +
      opt('off', copy.off, '', !showing) +
      tracks.map((t) => opt(t.id, t.label || t.language, t.language.toUpperCase(), t === showing)).join('') +
      `</div>`;
    this.#layout();
  }

  #renderSettings() {
    const rate = this.#rate.value;
    const quality = this.#quality.value;
    const video = this.#video();
    const rates = (rate?.playbackRates ?? [0.5, 0.75, 1, 1.25, 1.5, 2]).filter((r) =>
      [0.5, 0.75, 1, 1.25, 1.5, 2].includes(r),
    );
    const current = rate?.playbackRate ?? 1;
    const renditions = quality?.videoRenditionList ?? [];
    const active = quality?.activeVideoRendition;
    const height = video?.videoHeight ?? 0;
    const loop = !!video?.loop;
    // Which rendition is selected. A pick from the menu shows straight away; the
    // player's own selection takes over once it reports the same one.
    const reported = renditions.find((r) => r.selected)?.id ?? 'auto';
    if (this.#qualityChoice === reported) this.#qualityChoice = null;
    const selectedQuality = this.#qualityChoice ?? reported;
    const key = [
      rates.join(),
      current,
      renditions.map((r) => r.id).join(),
      selectedQuality,
      active?.id,
      height,
      loop,
      this.#prefs.size,
      this.#prefs.position,
      this.#prefs.accent,
    ].join('|');
    if (key === this.#settingsKey) return;
    this.#settingsKey = key;

    const seg = (action: string, items: [string, string][], value: string, label: string) => `
      <div class="seg-control" role="radiogroup" aria-label="${label}">
        ${items
          .map(
            ([v, l]) =>
              `<button type="button" role="radio" aria-checked="${v === value}" data-action="${action}" data-value="${v}">${l}</button>`,
          )
          .join('')}
      </div>`;

    const rateLabel = (r: number) => (r === 1 ? '1×' : `${r}×`);
    const qualityRows = renditions.length
      ? seg(
          'quality',
          [['auto', copy.auto], ...renditions.map((r): [string, string] => [r.id, `${r.height ?? '?'}p`])],
          selectedQuality,
          copy.quality,
        )
      : `<div class="row row-static"><span class="row-label">${copy.auto}</span><span class="row-meta">${height ? `${height}p` : '—'}</span></div>`;

    this.querySelector<HTMLElement>('[data-slot="settings"]')!.innerHTML = `
      <div class="field">
        <div class="field-label"><span>${copy.speed}</span><span class="row-meta">${current === 1 ? copy.normal : rateLabel(current)}</span></div>
        ${seg('rate', rates.map((r) => [String(r), rateLabel(r)]), String(current), copy.speed)}
      </div>
      <div class="field">
        <div class="field-label"><span>${copy.quality}</span></div>
        ${qualityRows}
      </div>
      <div class="field">
        <div class="field-label"><span>${copy.orbitSize}</span></div>
        ${seg('size', [['s', copy.small], ['m', copy.medium], ['l', copy.large]], this.#prefs.size, copy.orbitSize)}
      </div>
      <div class="field">
        <div class="field-label"><span>${copy.orbitPosition}</span></div>
        ${seg('position', [['center', copy.center], ['bottom', copy.bottom], ['corner', copy.corner]], this.#prefs.position, copy.orbitPosition)}
      </div>
      <div class="field">
        <div class="field-label"><span>${copy.orbitColour}</span><span class="row-meta">${copy.accents[this.#prefs.accent]}</span></div>
        <div class="swatches" role="radiogroup" aria-label="${copy.orbitColour}">
          ${(Object.keys(ACCENTS) as Accent[])
            .map(
              (a) =>
                `<button type="button" class="swatch" role="radio" aria-checked="${a === this.#prefs.accent}" aria-label="${copy.accents[a]}" title="${copy.accents[a]}" data-action="accent" data-value="${a}" style="--swatch: ${ACCENTS[a]}"></button>`,
            )
            .join('')}
        </div>
      </div>
      <button type="button" class="row row-btn row-switch" data-action="loop" role="switch" aria-checked="${loop}">
        <span class="row-label">${copy.loop}</span><span class="switch" aria-hidden="true"></span>
      </button>`;
    this.#layout();
  }

  #renderCast() {
    const remote = this.#remote.value;
    const state = remote?.remotePlaybackState ?? 'disconnected';
    const avail = remote?.remotePlaybackAvailability ?? 'unsupported';
    const label = this.querySelector('[data-slot="cast-label"]')!;
    const note = this.querySelector('[data-slot="cast-note"]')!;
    label.textContent = state === 'connected' ? copy.castStop : state === 'connecting' ? copy.castConnecting : copy.castTo;
    note.textContent =
      state === 'connected'
        ? copy.castConnected
        : avail === 'unsupported'
          ? copy.castUnsupported
          : avail === 'unavailable'
            ? copy.castNoDevices
            : '';
  }

  #renderPip() {
    const pip = this.#pip.value;
    const on = !!pip?.isPictureInPicture;
    this.querySelector('[data-slot="pip-label"]')!.textContent = on ? copy.pipExit : copy.pipEnter;
    this.querySelector('[data-slot="pip-note"]')!.textContent =
      pip?.pictureInPictureAvailability === 'unsupported' ? copy.pipUnsupported : copy.pipHint;
  }

  #renderFullscreenPanel() {
    if (!this.#built) return;
    const fs = this.#fs.value;
    this.querySelector('[data-slot="fs-label"]')!.textContent = fs?.isFullscreen ? copy.fsExit : copy.fsEnter;
    this.querySelector('[data-action="theater"]')?.setAttribute('aria-checked', String(this.#theater));
  }
}

customElements.define('orbit-controls', OrbitControlsElement);

declare global {
  interface HTMLElementTagNameMap {
    'orbit-controls': OrbitControlsElement;
  }
}
