# Element Collector

Select any element on any website and get its HTML, CSS, interactive states and responsive CSS, with a live preview in a side panel.

## Install (developer mode)

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click Load unpacked and choose this folder
4. Pin the extension and click its icon to open the side panel

## Use

1. Click Pick element
2. Hover an element on the page and click it (Up / Down arrows select the parent / child, Esc cancels)
3. The element appears in the panel with a thumbnail. Open it to see the live preview, switch Mobile / Tablet / Desktop widths, and copy the HTML, CSS, Responsive CSS or everything together

## Visual editor (free)

Click **Editor** in the side panel (or **Edit in editor** on any collected element) to open the design canvas in a tab.

- **Canvas**: every collected element becomes a frame. Drag frame headers to move them, drag the right edge to change width (snaps to 375 / 768 / 1280), Ctrl+scroll to zoom, scroll to pan. Add a **Blank frame** to design from scratch.
- **Edit like a design tool**: click to select, drag the 8 handles to resize (Shift keeps ratio), drag an element to reorder it (blue line shows where it lands), Alt+drag to offset it, double-click to edit text. Duplicate, wrap, delete, copy/paste, undo/redo.
- **Properties panel**: layout (flex/grid), size, spacing, typography, fill, border, radius, shadow, opacity, filters, transform, transition, position, plus a custom CSS box.
- **Responsive**: frame width decides the breakpoint (mobile <= 480, tablet <= 900, desktop). Edits are stored per breakpoint and exported as real `@media` rules. A **Default / Hover / Focus / Active** switch edits interactive states.
- **Insert**: container, row, grid, heading, text, button, link, image, input, divider, card, navbar, hero.
- **Export**: HTML, all frames (.zip), copy HTML + CSS, CSS, React component (.jsx + .css in a zip), **Figma** (copy and paste, or SVG download), PNG, project .json (save and reopen later).

### Figma

Choose **Export > Copy for Figma**, click the Figma canvas, press Ctrl+V. The page is exported as real vectors and text with layers named after the elements (rects, rounded corners, borders, gradients, drop shadows, images, text lines). It is positioned output, not auto-layout; for auto-layout frames use the exported HTML with an HTML-to-Figma plugin.

### Limits

- Pasting into Figma uses the page's computed layout at the frame's current width, so export each breakpoint separately.
- Stacking order follows the DOM (z-index and transforms are not exported to SVG).
- PNG uses the browser's own rendering; remote images and web fonts may be missing.

## Before publishing

- Set your donation link in `config.js`
- Store tile is in `store/promo-tile-440x280.png`; add 1280x800 screenshots of the panel
- The extension asks for access to all sites because it reads page styles and fetches cross-origin stylesheets. Explain this in your store listing.

## Notes

- Output CSS uses generated class names such as `div-root` and `button-1`
- Sizes come from authored `width` / `height` rules so layouts stay fluid
- Responsive CSS contains the `@media` and `@container` rules that match the element or its children
- Only the top frame can be picked (not content inside iframes)
