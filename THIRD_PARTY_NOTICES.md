# Third-party notices

`public/imperial-map.json` uses coastlines derived from the Natural Earth low-resolution world dataset. Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The generated provinces, country start allocations, sea routes and game ownership are authored gameplay abstractions. They are not representations of 1910 political boundaries. No historical-political accuracy claim is made.

The map is maintained as checked-in JSON; running the game needs only that file and Node.js.

Playwright is an optional test dependency and is not shipped in the runtime. Fonts in `public/fonts/` are SIL OFL 1.1 (licences alongside). No remotely loaded assets.

Sound (`public/audio/`) is original synthesis made for this project by `scripts/sound/compose.js`; it contains no samples or third-party recordings. It is rendered at build time with Tone.js (MIT License, Copyright (c) 2014-2020 Yotam Mann), an optional development dependency that is not shipped or served; see `docs/UI-DESIGN.md` → Sound.
