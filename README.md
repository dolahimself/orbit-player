# Orbit

A circular control skin for **Video.js 10**, shown on four Blender open movies.

Five separate buttons sit inside a seek ring that touches their outer edge:
play and pause in the middle, then options (top), skip forward (right), volume
(bottom) and skip back (left). Underneath it's a standard `<video-player>`, and
every control reads and writes the Video.js player store.

## Run it

```bash
bun install
bun dev        # http://localhost:5173
bun run build  # type-check and build to dist/
```

npm works too: `npm install && npm run dev`.

## Using the controls

| Do this | And this happens |
| --- | --- |
| Click the centre | Play or pause. The current time shows under the icon |
| Click the left or right button | Skip back or forward 10 seconds. Quick taps add up, and a badge shows the total |
| Press and hold the left or right button | Keep skipping 10 seconds at a time, faster the longer you hold, like Netflix. Let go to stop |
| Hover the ring | A thumbnail of that moment appears, and the ring lights up between the playhead and your pointer |
| Drag around the ring | Scrub. The blob and the centre time follow you, and the preview frame updates as you go |
| Click the bottom button | A horizontal volume slider opens below the orbit |
| Press and hold the bottom button, then circle | Turn the volume up (clockwise) or down, like a click wheel |
| Scroll over the orbit | Nudge the volume |
| Click the top button | Five options fan out above the orbit: subtitles, settings, cast, picture in picture and full screen. Each one opens its own panel upwards |
| Spin the dial at the bottom of the page | Move between films. The cards swing around with it and settle on the nearest one |

Keyboard: `Space`/`K` play, `J`/`L` ±10 s, `←`/`→` ±5 s, `↑`/`↓` volume,
`M` mute, `C` subtitles, `F` full screen, `P` picture in picture, `0`–`9` jump to
that tenth. With the dial focused, the arrow keys change films.

In **Settings** you can change playback speed, see the quality, loop the video,
and set the control's size (S, M, L) and position (centre, bottom, corner).
Those last two are remembered in this browser.

## How it's built

```
src/
  orbit/
    orbit-controls.ts  <orbit-controls>, a Video.js UIElement
    geometry.ts        ring and button shapes (200 × 200 viewBox)
    orbit.css          tokens and styles for the skin
    icons.ts           Video.js neutral icon set, plus a menu glyph on the same grid
    copy.ts            every string the skin shows
  app/
    films.ts           the four films and their details
    wheel.ts           spring-driven dial and card wheel
  main.ts              page wiring
public/captions/       English and Spanish production-notes tracks for each film
```

- `<orbit-controls>` extends `UIElement` and subscribes to the store with
  `PlayerController` and the feature selectors (`selectPlayback`, `selectTime`,
  `selectBuffer`, `selectVolume`, `selectTextTrack` and so on).
- Where Video.js already has a control, Orbit uses it: `media-play-button`,
  `media-seek-button`, `media-mute-button`, `media-volume-slider`,
  `media-pip-button`, `media-fullscreen-button`, `media-cast-button` and
  `media-airplay-button`. They bring their own labels, keyboard support and
  `data-*` state, which the CSS styles.
- `media-gesture` and `media-hotkey` handle taps, double taps and shortcuts.
- Each direction button is its own SVG shape with a constant-width gap and
  rounded corners, so the buttons read as separate pieces.
- The frosted backdrop is masked to the button shapes, so the gaps stay clear.
- The ring preview is a `<media-thumbnail>` reading the Mux storyboard track.
- Controls hide on idle through the store's `controlsVisible`, and stay locked
  on screen while a menu is open or you're scrubbing.
- Every duration goes through motion tokens that collapse under
  `prefers-reduced-motion`.

To drop the skin into another Video.js 10 player, copy `src/orbit/`, import
`orbit-controls.ts` and `orbit.css`, and put `<orbit-controls>` inside your
`<media-container>`.

## Media

The films are Blender Foundation open movies: *Sintel*, *Tears of Steel*,
*Big Buck Bunny* and *Elephants Dream*, released under Creative Commons
Attribution and streamed from [Mux](https://www.mux.com/docs). Each film is a
Mux playback ID in `src/app/films.ts`, played by Video.js's `<mux-video>`:

- Stream: `https://stream.mux.com/{PLAYBACK_ID}.m3u8`
- Poster and stage card: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.webp`
- Dial thumbnail: the same image, cropped square
- Seek previews: the Mux storyboard, which `<mux-video>` adds as a track and
  `<media-thumbnail>` reads

If a stream can't be reached, the player switches to a backup clip and says so.

# orbit
