# Performance

Read this at step 4, before choosing fonts, images or a rendering technique, and at step 5 when measuring. Performance is a design decision: the typeface, the hero treatment and the illustration budget decide it long before any build setting does.

## The three numbers

| Metric | Bar | What decides it |
|---|---|---|
| LCP | 2.5s or less | The hero: an image, a webfont headline, or a blocked script |
| CLS | 0.1 or less | Media without dimensions, late fonts, content injected above the fold |
| INP | 200ms or less | Heavy synchronous work on interaction: big loops, layout thrash, giant DOM |

A canvas or WebGL scene that draws thousands of points is a legitimate hero. It is also the first thing that fails INP on a mid-range phone, so it must not also run on every pointer event unthrottled.

## Fonts

- WOFF2 only; subset to the glyphs used; a few hundred KB is the ceiling for the whole family.
- `preconnect` to the font host, and `font-display: swap` or `optional`.
- Self-host where possible; a third-party font host is a second connection before first paint.
- Two families maximum, and the second one must earn its place.

## Images

- WebP or AVIF, at the size they render.
- `width` and `height` always, so nothing shifts while loading.
- `loading="lazy"` below the fold only — never on the LCP image.
- `srcset` for anything that appears larger than a thumbnail.
- Vector for anything that can be vector. A screenshot of text is not an image, it is a maintenance problem.

## Scripts and weight

- `defer` or `async`; nothing render-blocking that can wait.
- One page should stay near 500 KB total; past 1500 KB you are asking for a bad first visit.
- Prefer a plain DOM and CSS for what a framework would do, and check a dependency's size before adding it.

## Waiting states are part of the design

- Under about a second, do nothing; a spinner that flashes is worse than a pause.
- Content-shaped waits get skeletons shaped like the arriving layout, not a centred spinner.
- The control that started the load stays mounted and shows its own progress; the surrounding geometry holds so the page does not jump when the data lands.
- Content fades in over its skeleton in 150 to 200ms rather than blinking.
- Optimistic updates need a visible rollback path when they fail.
- Report the number, not the adjective: what you measured, at what width, and what you did not measure.

Done when you can name LCP, CLS and INP for what you built, and say which you could not measure and why.
