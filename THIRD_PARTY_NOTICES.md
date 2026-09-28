# Third-party notices

`public/map.json` uses coastlines derived from the Natural Earth low-resolution world dataset. Natural Earth data is public domain: https://www.naturalearthdata.com/about/terms-of-use/

The generated provinces, country start allocations, sea routes and game ownership are authored gameplay abstractions. They are not representations of 1910 political boundaries. No historical-political accuracy claim is made.

To regenerate the map, install GeoPandas and Shapely in a development Python environment and run `python scripts/build_map.py /path/to/naturalearth_lowres.shp`. These are optional development tools; running the game needs only the checked-in JSON and Node.js.

`public/imperial-map.json` (the playable Industry & Empire board) is built from Natural Earth 1:10m admin-1 states and provinces, also public domain: `python scripts/build_imperial_map.py /path/to/ne_10m_admin_1_states_provinces.zip`. Each state is assigned whole to one game province; the grouping is an authored abstraction, not a claim about 1910 borders.

Playwright is an optional test dependency and is not shipped in the runtime. All presentation uses local system fonts. No font files or remotely loaded assets are bundled.
