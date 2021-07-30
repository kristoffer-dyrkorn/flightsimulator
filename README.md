# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio. Runs smoothly at 60 fps on an average laptop.

[Try it out!](https://kristoffer-dyrkorn.github.io/flightsimulator/) Use arrow keys for control. (See below for more info.)

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/flight.jpg)

## July 20th 2021: New version!

Highlights:

- Audio problems are fixed, now using audio worklets.
- Most prominent tiles are loaded first, reducing apparent loading times.
- Updated `three.js`.

## April 9th 2021: New version!

A new version has been released. Highlights:

- Updated satellite photos, taken summer/fall 2019, giving better image quality and more realistic colors.
- New external cameras: Press `space bar` to cycle between internal camera (cockpit), external "chase camera" and external "static camera".
- Geometry and textures have been omtimized. Mesh simplification reduces vertex counts, and compressed texture format reduces upload times and GPU memory.
- Start coordinates can be given both as UTM 33N and lat/lon values. A starting direction can also be given. See below for examples.
- Code has been rewritten to use `three.js`.

## Features

- Realistic visualisation of all of mainland Norway
- Tiled terrain rendering: The surface is divided into regions that are loaded and unloaded as needed
- Highly efficient loading of terrain geometry and textures
- Reasonably accurate flight model of an F-16
- Internal and external views
- Synthesized, dynamic engine sound
- Gamepad support (only tested on an USB gamepad and Chrome)
- Works on iOS and Android (but no steering implemented so far)

Warning: The code is not beautiful.

## Attributions

- Terrain elevation data is provided by the [Norwegian Mapping Authority](https://www.kartverket.no) and is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Satellite photos are Copernicus Sentinel-2 data (from july 2019), provided and processed by the [Norwegian Mapping Authority](https://www.kartverket.no), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Flight dynamics code is translated and rewritten from https://www.cds.caltech.edu/~murray/projects/afosr95-vehicles/models/f16/
- Brown noise generator is taken from https://noisehack.com/generate-noise-web-audio-api/
- Node.js http server code is taken from https://adrianmejia.com/blog/2016/08/24/building-a-node-js-static-file-server-files-over-http-using-es6/
- 3D model of F-16 is taken from http://www.domawe.net/2015/10/f-16c-fighting-falcon-free-3d-models.html
- The application uses [three.js](https://threejs.org/) (MIT License), and [proj4js](https://github.com/proj4js/proj4js).

## License

All code and data, except what is mentioned above, is licensed under Creative Commons Attribution-NonCommercial ShareAlike. See https://creativecommons.org/licenses/by-nc-sa/4.0/.

## Running

The app can be tried out [here](https://kristoffer-dyrkorn.github.io/flightsimulator/).

Startup parameters:

- Provide starting point coordinates (in UTM 33N or GPS coordinates) using url parameters `e` and `n`. Default start point is south of Molde.
- Altitude (in metres) can be given using the parameter `a`. Default is 3000 metres.
- Start direction (compass angle) can be provided by `c`. Default is 0 degrees, due north.

Example: https://kristoffer-dyrkorn.github.io/flightsimulator/?n=6981000&e=110000&a=1000&c=270

## Controls

Use keyboard or gamepad.

Arrow keys control aileron and elevator. z and `x`: rudder. `q` and `a`: throttle. Space cycles camera views. When using the external static camera, move the camera left and right using `j` and `l`, and up and down using `i` and `k`. Use `,` and `.` to move the camera nearer/further away.

Right joystick controls both aileron and elevator. Lower left and right front buttons regulate throttle.

Rendering and keyboard control should work on all modern desktop browsers. Rendering should work on mobile browsers as well, but aircraft control has not yet been implemented.
