# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio.
Runs smoothly at 60 fps on an average laptop.

## Features

- Tiled terrain rendering: The surface is divided into regions that are loaded and unloaded as needed
- Highly efficient loading of terrain and textures
- Reasonably accurate flight model of an F-16
- Synthesized, dynamic engine sound
- Gamepad support (limited to USB connected gamepads and Chrome)

Warning: The code is not beautiful.

## Screenshot

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/flight.jpg)

## Attributions

- Terrain data is provided by the [Norwegian Mapping Authority](https://www.kartverket.no) and is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Satellite photos are Copernicus Sentinel-2 data (2017), provided by the [Norwegian Mapping Authority](https://www.kartverket.no), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Flight model code is translated and rewritten from https://www.cds.caltech.edu/~murray/projects/afosr95-vehicles/models/f16/
- Node http server code is taken from https://adrianmejia.com/blog/2016/08/24/building-a-node-js-static-file-server-files-over-http-using-es6/
- Brown noise generator is taken from https://noisehack.com/generate-noise-web-audio-api/

## License

All code and data, except what is mentioned above, is licensed under Creative Commons Attribution-NonCommercial ShareAlike. See https://creativecommons.org/licenses/by-nc-sa/2.0/.

## Running

To run using local terrain data, download and prepare the data sets by following the instructions in `sh`-files in the `scripts/` folder and then running the scripts.

To run using already provided data sets, just open the file `src/index.html`.

Starting point location (in UTM 33 N coordinates) and altitude (in metres) can be provided as the url parameters e (UTM east), n (UTM NORTH) and a (altitude). Example: `index.html?e=120300&n=6959500&a=2000`.

## Controls

- Keyboard: Arrow keys for aileron and elevator. z and x for rudder. q and a for throttle.
- Gamepad: Right joystick for aileron and elevator. Buttons 6 and 7 for throttle.

Rendering and keyboard control is tested in Firefox, Chrome and Safari on OS X, and in Edge on Windows 10.
Gamepad controls are tested in Chrome on OS X using USB connected Steelseries Nimbus and Xbox One gamepads.
