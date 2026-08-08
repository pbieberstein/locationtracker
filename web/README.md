# Static frontend

This directory has no build step. `index.html`, `app.js`, and `styles.css` are copied to the GitHub Pages artifact together with `/data/locations.json`.

For a quick local preview from the repository root:

```bash
python3 -m http.server 3000
```

Then open `http://localhost:3000/web/?phone=PHONE_HASH`. The production workflow publishes the contents of `web/` at the site root, so production URLs use `?phone=PHONE_HASH` without `/web/`.

The deployed `404.html` copy supports `/PHONE_HASH` links on GitHub Pages. Query-string links remain the canonical and most portable form.

Leaflet and OpenStreetMap tiles are loaded from public services. Review the tile provider's usage policy before any non-experimental launch.
