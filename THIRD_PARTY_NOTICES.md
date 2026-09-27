# Third-party notices

`public/map.json` uses coastlines derived from the Natural Earth low-resolution world dataset. Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The generated provinces, country start allocations, sea routes and game ownership are authored gameplay abstractions. They are not representations of 1910 political boundaries. No historical-political accuracy claim is made.

To regenerate the map, install GeoPandas and Shapely in a development Python environment and run `python scripts/build_map.py /path/to/naturalearth_lowres.shp`. These are optional development tools; running the game needs only the checked-in JSON and Node.js.

Playwright is an optional test dependency and is not shipped in the runtime. All presentation uses local system fonts. No font files or remotely loaded assets are bundled.

Sound (`public/audio/`) is original synthesis made for this project by `scripts/sound/compose.js`; it contains no samples or third-party recordings. It is rendered at build time with Tone.js (MIT License, Copyright (c) 2014-2020 Yotam Mann), an optional development dependency that is not shipped or served; see `docs/UI-DESIGN.md` → Sound.
