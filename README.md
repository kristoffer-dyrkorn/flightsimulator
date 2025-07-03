# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio. Runs smoothly at 60 fps on an average laptop.

[Try it out!](https://kristoffer-dyrkorn.github.io/flightsimulator/) Use arrow keys for control. (See below for more info.)

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image1.jpeg)

## Main features

- Realistic visualisation of all of mainland Norway
- Reasonably accurate flight model of an F-16
- Internal and external views
- Synthesized, dynamic engine sound
- Joystick support (only tested in Chrome, using an NXT Gladiator)
- Highly efficient terrain rendering based on tiling and dynamic loading of data
- Works on mobiles (but no steering implemented so far)

## Controls

Use the keyboard or, if you have, an NXT Gladiator joystick.

Arrow keys control aileron and elevator. `z` and `x`: rudder. `q` and `a`: throttle. Space cycles camera views: cockpit / wingman camera / external camera. For the external camera, `j` and `l` rotates the camera left and right, `i` and `k` rotates it up and down. Use `,` and `.` to move the camera nearer/further away. Use `h` to toggle HUD on and off.

## Screenshots

![Åndalsnes](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image2.jpeg)

![Wingman camera](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image3.jpeg)

![Landing](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image4.jpeg)

## Release notes

July 2025:

- Upgraded three.js. Switched data formats, now using GLB for meshes and KTX2 for textures.
- Tests for ground collisions

June 2025:

- Improved flight dynamics, now incorporating the "high fidelity model" for the F-16, as described in [NASA-TN-D-8176](https://ntrs.nasa.gov/citations/19760017178).

May 2025:

- Implemented a simple HUD!
- Significantly better colors and detail in the imagery - based on orthophotos of Norway and color-corrected Sentinel-2 images from 2022.
- Spatial audio

July 2021:

- Audio problems are fixed, now using audio worklets.
- Most prominent tiles are loaded first, reducing apparent loading times.
- Updated `three.js`.

April 2021:

- Updated satellite photos, taken summer/fall 2019, giving better image quality and more realistic colors.
- New external cameras: Press `space bar` to cycle between internal camera (cockpit), "wingman camera" and external camera.
- Geometry and textures have been omtimized. Mesh simplification reduces vertex counts, and compressed texture format reduces upload times and GPU memory.
- Start coordinates can be given both as UTM 33N and lat/lon values. A starting direction can also be given. See below for examples.
- Code has been rewritten to use `three.js`.

## Credits / attributions

- Terrain elevation data is provided by the [Norwegian Mapping Authority](https://www.kartverket.no) and is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Satellite photos are Copernicus Sentinel-2 data from 2022, provided and processed by the [Norwegian Mapping Authority](https://www.kartverket.no), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Orthophotos are from the [Norwegian Mapping Authority](https://www.kartverket.no), free for non-commercial use
- Flight dynamics code is translated and rewritten from https://github.com/shield09/gjf16fcs/, with these sources:
  - "Nonlinear Adaptive Trajectory Control Applied to an F-16 Model", E.R. van Oort & L. Sonneveldt, 2009
  - "Nonlinear F-16 simulation using Simulink and Matlab", R. S. Russel, University of Minnesota, 2003
  - "Six-Degree of Freedom Nonlinear F-16 Aircraft Model", Ying Huo, University of Southern California, 2003
  - "Aircraft Control and Simulation" by Brian L. Stevens, Frank L. Lewis, John Wiley & Sons, Inc. 1992
  - "NASA Technical Paper 1538", Nguyen, L.T. et al., 1979
  - "NASA Technical Note D-8176", Gilbert at al, 1976
- Brown noise generator is taken from https://noisehack.com/generate-noise-web-audio-api/
- 3D model of F-16 is taken from http://www.domawe.net/2015/10/f-16c-fighting-falcon-free-3d-models.html
- The application uses [three.js](https://threejs.org/) (MIT License), and [proj4js](https://github.com/proj4js/proj4js).

## License

All code and data, except what is mentioned above, is licensed under Creative Commons Attribution-NonCommercial ShareAlike. See https://creativecommons.org/licenses/by-nc-sa/4.0/.

## Running

The app can be tried out [here](https://kristoffer-dyrkorn.github.io/flightsimulator/).

Extra startup parameters:

- Provide starting point coordinates (in UTM 33N or GPS coordinates) using url parameters `e` and `n`. The default start point is south of Molde.
- Altitude (in metres) can be given using the parameter `a`. Default is 1500 metres (5000 ft).
- Start direction (compass angle) can be provided by `c`. Default is 0 degrees, ie due north.

Example: https://kristoffer-dyrkorn.github.io/flightsimulator/?n=6981000&e=110000&a=1000&c=270
