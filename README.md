# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio.
Runs smoothly at 60 fps on an average laptop.

## Features

- Tiled terrain rendering: The surface is divided into regions that are loaded and unloaded as needed
- Highly efficient loading of terrain and textures
- Reasonably accurate flight model of an F-16
- Synthesized, dynamic engine sound
- Gamepad support

Warning: The code is not beautiful.

## Screenshot

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/flight.jpg)

## Attributions

- Flight model code is translated and rewritten from https://www.cds.caltech.edu/~murray/projects/afosr95-vehicles/models/f16/
- Node http server code is taken from https://adrianmejia.com/blog/2016/08/24/building-a-node-js-static-file-server-files-over-http-using-es6/
- Brown noise generator is taken from https://noisehack.com/generate-noise-web-audio-api/

## License

All code, except from the modules mentioned above, is licenced under Creative Commons Attribution-NonCommercial ShareAlike. See https://creativecommons.org/licenses/by-nc-sa/2.0/.

## Running

Go to `src/`, type `node server.js`, open a browser and go to `http://localhost:8000`.

- Keyboard controls: Arrow keys for aileron and elevator. z and x for rudder. q and a for throttle.
- Gamepad controls: Right joystick for aileron and elevator. Buttons 6 and 7 for throttle.

Tested in Chrome, Firefox and Safari and on a Steelseries Nimbus gamepad.

## Setup and config

Terrain data is not included. To run the simulator you will need to download and setup your own terrain files. You will need at least height data, but matching ortophotos is needed for high realism.

Please note: The code assumes that all coordinates are specified using UTM zone 32N, using meters as unit.

Height models (DEM files) for Norway can be downloaded from
https://kartkatalog.geonorge.no/metadata/kartverket/dtm-50/e25d0104-0858-4d06-bba8-d154514c11d2

See `script/` for a bash script that converts DEM files to the height data format (PNG) used by the simulator. The script relies on GDAL (https://www.gdal.org) already being installed.

Orthophoto textures for Norway are unfortunately not openly available. Shaded reliefs that might work as a replacement are available here:
https://kartkatalog.geonorge.no/metadata/uuid/8c233f06-2327-46ed-b330-c57c86e70d79

## Height data

Height data must be encoded as grayscale PNG files. Each PNG covers a given geographical area. At rendering, the intensity levels in the PNG are mapped to terrain heights using the mulitiplicator GraphicsConstants.MAX_HEIGHT. (See `src/js/graphics/graphicsconstants.js` .)

PNG files must be named using the UTM coordinate of the lower left (southernmost and westernmost) corner of the area covered by the file. The naming convention is `EAST-NORTH.png`. Pixel sizes must be 2^n and set in GraphicsConstants.TOPO_SIZE. The geographic extents (length or width) of the height data must be set in GraphicsConstants.TILE_EXTENTS.

## Surface textures

Surface textures should be encoded in JPG files. They must be named using the same UTM coordinate convension as for PNGs. Pixel sizes (width and height) must be 2^n, but textures can (and should) have a higher spatial resolution than height data. The size must be set in GraphicsConstants.PHOTO_SIZE. The geographic extents (actual terrain distance along the lengths and widths) of the texture must be set in GraphicsConstants.TILE_EXTENTS.

## Terrain extents

The UTM coordinates for the corner points of the entire tile set must be set in
GraphicsConstants.MIN_EAST, GraphicsConstants.MIN_NORTH, GraphicsConstants.MAX_EAST and GraphicsConstants.MAX_NORTH.
