# HTML-in-Canvas reference demos

Optional capability reference. Not a style, layout, or copy source.

HTML-in-Canvas renders live DOM inside a canvas. The text stays real HTML, so selection, copy, focus, find-in-page, translation, and screen readers keep working while 2D, WebGL, or WebGPU applies the visual effect.

- API guide: https://developer.chrome.com/blog/html-in-canvas
- Specification: https://github.com/WICG/html-in-canvas
- Source artifact: https://claude.ai/artifact/7cCNqKnoFSoib9SuNLB3vk
- Five demos selected from the 15 linked demos by smallest size; the Claude frame runtime was removed.

## API

```html
<canvas content="drawable">
  <div drawable>Real HTML here</div>
</canvas>
```

```js
const ctx = canvas.getContext("2d");
ctx.drawElementImage(element, x, y);
canvas.updateElementGeometry(element, { canvasTransform });
```

WebGL and WebGPU use `texElementSubImage2D` and `drawElementImageToTexture`. A `paint` event synchronizes DOM changes with the canvas.

## Limits

- Chrome 157+, Edge 157+, and Claude desktop 5.11492+. Firefox and Safari do not support it.
- Feature-detect the API; always provide a usable DOM-only fallback.
- Text remains DOM. Preserve selection, focus, keyboard access, translation, and screen readers.
- GPU and memory cost is real. Test mobile, reduced motion, and long pages.
- Open these files in a supported browser. Do not read whole demo files into context.
- Borrow capability ideas only. Do not copy the demo visual style, copy, or assets.

## Demo catalog

| Demo | What it shows | Size |
| --- | --- | --- |
| [Paper Desk](demos/paper-desk.html) | Live HTML sheet on a WebGL desk; curl, fold, crumple, burn | 122 KB |
| [Knitted Page](demos/knitted-page.html) | Page as knitted fabric; unravel while typing | 131 KB |
| [Jelly](demos/jelly.html) | Page as jelly; wobble, drag, click, type | 155 KB |
| [Exploded View](demos/exploded-view.html) | 3D tour planner; drag to turn, scroll to pull apart | 215 KB |
| [Ink](demos/ink.html) | Wet-ink text; drag, type, change colour, settle with Esc | 579 KB |

`manifest.json` records source URLs, frame versions, byte counts, and SHA-256 hashes.

## Provenance and safety

Source demos are public Claude artifacts with no license; redistribution rights are unverified. Keep them as reference material, not as a licensed asset pack. Static audit found no external scripts, automatic external network requests, cookies, credential access, `eval`, hidden characters, or prompt-injection text. The demos execute JavaScript when opened; they were audited statically, not executed here. Chrome 157 was not available.
