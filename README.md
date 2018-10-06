# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio. Runs smoothly at 60 fps on an average laptop.

[Try it out!](https://kristoffer-dyrkorn.github.io/flightsimulator/) Use arrow keys for control. (See below for more info.)

## Features

- Tiled terrain rendering: The surface is divided into regions that are loaded and unloaded as needed
- Highly efficient loading of terrain and textures
- Reasonably accurate flight model of an F-16
- Synthesized, dynamic engine sound
- Gamepad support (limited to USB connected gamepads and Chrome)
- Works on iOS and Android (but no steering implemented so far)

Warning: The code is not beautiful.

## Screenshot

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/flight.jpg)

## Attributions

- Terrain data is provided by the [Norwegian Mapping Authority](https://www.kartverket.no) and is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Satellite photos are Copernicus Sentinel-2 data (2017), provided by the [Norwegian Mapping Authority](https://www.kartverket.no), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Flight dynamics code is translated and rewritten from https://www.cds.caltech.edu/~murray/projects/afosr95-vehicles/models/f16/
- Brown noise generator is taken from https://noisehack.com/generate-noise-web-audio-api/
- Node.js http server code is taken from https://adrianmejia.com/blog/2016/08/24/building-a-node-js-static-file-server-files-over-http-using-es6/

## License

All code and data, except what is mentioned above, is licensed under Creative Commons Attribution-NonCommercial ShareAlike. See https://creativecommons.org/licenses/by-nc-sa/2.0/.

## Running

The app can be tried out [here](https://kristoffer-dyrkorn.github.io/flightsimulator/).

To run locally, using provided data sets, install Node (if not already installed), clone the project, go to `src` and run `node server.js`. The app is available at `localhost:8000`.

To run locally, on local data sets, first download and prepare the data sets by following the instructions in `sh`-files in the `scripts/` folder and then running the scripts.

Starting point location (in UTM 33 N coordinates) and altitude (in metres) can be provided as url parameters e (UTM east), n (UTM NORTH) and a (altitude). Example: `index.html?e=120300&n=6959500&a=2000`.

## Controls

- Keyboard: Arrow keys for aileron and elevator. z and x for rudder. q and a for throttle.
- Gamepad: Right joystick for aileron and elevator. Lower left and right front buttons for throttle.

Rendering and keyboard control is tested in Firefox, Chrome and Safari on OS X, and in Edge on Windows 10. Gamepad control is tested in Chrome on OS X, on Steelseries Nimbus and Xbox One gamepads (each connected by USB cable). Rendering and audio works on iOS (tested in Safari on 11.4, iPhone 8) and Android (tested in Chrome on 8.1, Google Pixel). So far no support for steering is implemented on mobile platforms.
