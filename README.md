# Gabi

A scroll-driven night walk through an imagined heritage town on a volcanic lake, inspired by Taal, Batangas. One camera, one page, five chapters: the lake, the candlelit stair, the stone houses, the church and the parols.

Every surface is drawn in code. Textures are painted on canvases at load, the foreground plants are SVG paths from a seed, and the sound is synthesized. The only image file is the share preview.

A design concept by [HELIOKI](https://github.com/heliokii).

## Run it

```sh
npm install
npm run dev      # local server
npm test         # camera path, layout and sound checks
npm run build    # production build in dist/
```

## How it shows

The page picks one of three modes on load:

| Mode | When | What you get |
|---|---|---|
| Live | WebGL 2 available | The camera walks the town as you scroll. Quality steps down on its own if the GPU struggles. |
| Held shots | `prefers-reduced-motion` | The same 3D town, one still shot per chapter. The camera cuts between them and never moves. |
| Still plate | Data Saver on, no WebGL, or the GPU drops the context | A painted night sky behind the words. With Data Saver or no WebGL, the 3D code is never downloaded. |

The words are plain HTML in every mode, so the page reads the same with a screen reader or without JavaScript.

## Sound

Off until the visitor presses **Sound** in the top bar. Lake water, crickets, rain on the tiles and a far church bell, all built with the Web Audio API and mixed per chapter. It pauses when the tab is hidden.

## Files

- `index.html`: the five chapters, nav and footer
- `src/main.js`: smooth scroll, chapter tracking, menu, sound button, mode choice
- `src/scene.js`: renderer, post-processing, the frame loop
- `src/world.js`: everything in the town, built from `layout.js`: lamp light in the fog, wet-street reflections, rain, the steam off the volcano
- `src/fog.js`: height fog that drifts, patched into three's fog chunks so every material wears it
- `src/rope.js`: Verlet ropes for the parol strings, so the lanterns swing in the wind (walking faster stirs it)
- `src/layout.js`: where things stand, in metres, and the counts the page quotes
- `src/path.js`: camera waypoints, the field-note shots and scroll-to-pose math
- `src/textures.js`: canvas-painted stone, wood, tiles, capiz, moon
- `src/foreground.js`: the lit SVG near things at each chapter's edge: reeds, banana leaves, candles, walls, bougainvillea, a parol
- `src/sound.js`: the synthesized soundscape
- `public/og.jpg`: share preview. Set `og:image` in `index.html` to an absolute URL once the site has a domain.

## Credits

The town is fictional, inspired by Taal heritage, and not affiliated with any parish or tourism office.
