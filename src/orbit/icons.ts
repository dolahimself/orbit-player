/**
 * Icons come from Video.js's neutral set so every glyph shares one grid
 * (18 × 18), one fill style and one corner radius. The set has no menu or
 * close glyph, so those two are drawn here on the same grid.
 */
import {
  playIcon,
  pauseIcon,
  seekIcon,
  volumeHighIcon,
  volumeLowIcon,
  volumeOffIcon,
  captionsOnIcon,
  captionsOffIcon,
  gearIcon,
  castEnterIcon,
  castExitIcon,
  pipEnterIcon,
  pipExitIcon,
  fullscreenEnterIcon,
  fullscreenExitIcon,
  checkIcon,
  chevronIcon,
  spinnerIcon,
  airPlayEnterIcon,
  restartIcon,
} from '@videojs/html/icons/neutral';

/** Menu: three bars that fold into a cross when the menu is open (see CSS). */
const menuIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" aria-hidden="true" viewBox="0 0 18 18" class="icon-menu"><rect class="bar bar-1" x="2.5" y="3.875" width="13" height="2.25" rx="1.125"/><rect class="bar bar-2" x="2.5" y="7.875" width="13" height="2.25" rx="1.125"/><rect class="bar bar-3" x="2.5" y="11.875" width="13" height="2.25" rx="1.125"/></svg>`;

export const icons = {
  play: playIcon,
  pause: pauseIcon,
  seek: seekIcon,
  volumeHigh: volumeHighIcon,
  volumeLow: volumeLowIcon,
  volumeOff: volumeOffIcon,
  captionsOn: captionsOnIcon,
  captionsOff: captionsOffIcon,
  gear: gearIcon,
  castEnter: castEnterIcon,
  castExit: castExitIcon,
  airplay: airPlayEnterIcon,
  pipEnter: pipEnterIcon,
  pipExit: pipExitIcon,
  fullscreenEnter: fullscreenEnterIcon,
  fullscreenExit: fullscreenExitIcon,
  check: checkIcon,
  chevron: chevronIcon,
  spinner: spinnerIcon,
  restart: restartIcon,
  menu: menuIcon,
};

export type IconName = keyof typeof icons;

export const icon = (name: IconName, cls = '') =>
  cls ? icons[name].replace('<svg ', `<svg class="${cls}" `) : icons[name];
