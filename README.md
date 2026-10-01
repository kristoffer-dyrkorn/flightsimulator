# A flight simulator in your browser

An F-16 flight simulator with realistic graphics, flight dynamics and audio. Runs smoothly at 60 fps on an average laptop.

[Try it out!](https://kristoffer-dyrkorn.github.io/flightsimulator/) Use arrow keys for control. (See below for more info.)

![Screenshot](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image1.jpeg)

## Main features

- Realistic visualisation of all of mainland Norway
- Reasonably accurate aerodynamic model of an F-16
- Flight control system (FCS) for realistic fly-by-wire controls
- Landing on runways is supported
- Internal and external views
- Synthesized, dynamic engine sound
- Joystick support (only tested in Chrome, using an NXT Gladiator)
- Highly efficient terrain rendering based on tiling and dynamic loading of data
- Works on mobiles (but no steering implemented so far)

## Controls

To steer the aircraft up, down, left or right, use the arrow keys. If you have an NXT Gladiator joystick it will also work.

The aircraft has a flight control system (FCS), so you do not steer it directly. The FCS decides how the control surfaces move in order to make the aircraft do what you want.

- `q` and `a`: throttle (afterburner kicks in at >80% throttle)
- `s` set throttle to idle
- `1` and `2`: decrease/increase air brakes
- `g` extend/retract landing gears and also enable/disable landing mode
- `z` and `x`: rudder (nose gear control when on a runway)
- `b` wheel brakes when on a runway
- `h`: toggle HUD on and off
- space bar: cycle camera views (cockpit camera / follower camera / external camera)
- `j` and `l`: rotate the external camera left and right
- `i` and `k`: rotate the external camera up and down.
- `,` and `.`: move the external camera nearer/further away

## Landing the aircraft

You can land the aircraft on any of Norway's runways. For a successful landing you must land inside the runway perimeter, have a sink rate of less than 600 feet/minute, and a banking angle of less than 7 degrees.

The FCS has a "landing mode", enabled when the landing gear is extended. When the aircraft is flying with the gears down it will trim itself to an angle of attack of 13 degrees, normal for an F16 on approach. In this mode, use the throttle to adjust the glide path. The stick controls can be used to adjust the angle of attack.
With the gears down, a throttle setting of around 20% and full air brakes will give you a speed of around 140 knots and a suitable glide path of 3 degrees. You will need to flare before touchdown. At touchdown, set the throttle to idle and apply wheel brakes.

## Screenshots

![Åndalsnes](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image2.jpeg)

![Wingman camera](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image3.jpeg)

![Landing](https://github.com/kristoffer-dyrkorn/flightsimulator/blob/master/screenshots/image4.jpeg)

## Release notes

September 2026:

- Added von Kármán wind turbulence model
- Added support for landing the aircraft on all of Norway's runways
- Added landing gear geometries to the 3D model and updated the aerodynamic model to incorporate gear drag
- Added bay door animations when extracting and retracting landing gear (animation of the landing gear itself is not yet in place)
- Added "landing mode" in the flight control system (FCS) when gears are extended
- Added trailing flaps (flaperons) when in landing mode
- Added physics model for rolling on the runway, including wheel brakes, turnable nose gear and compressible landing gear struts
- Added precise surface geometries of all of Norway's runways
- Improved ground textures (doubled the resolution and removed various artifacts)
- Fixed ground texture displacement bug

August 2026:

- Use quaternions instead of Euler angles in the physics model, avoids gimbal lock and improves numerical robustness
- Now calculates the compass direction correctly
- Decoupled the physics loop from the rendering loop to avoid large time steps and numerical instabilities
- Fixed leading edge flap aerodynamic calculations
- Fixed wrong data in the air brake aerodynamics table and enabled air brakes
- Fixed a bug in the flight path indicator placement
- Fixed limitations in the atmospheric model for high altitudes
- Fixed jitter when using the chase camera
- Added actuator lag and a flight control system (FCS) for fly-by-wire control. The data flow is now: stick input -> FCS logic (flight dynamics optimizer/limiter) -> actuator signal -> rudder movement -> physics model update
- Added air compressibility model (transonic drag)
- Switched from Euler integration to RK4 integration in the physics model, improving accuracy

July 2025:

- Upgraded `three.js`. Switched data formats, now using GLB for meshes and KTX2 for textures.
- Tests for ground collisions

June 2025:

- Improved flight dynamics, now incorporating the "high fidelity model" for the F-16, as described in [NASA-TN-D-8176](https://ntrs.nasa.gov/citations/19760017178).

May 2025:

- Implemented a simple HUD
- Significantly better colors and detail in the imagery - based on orthophotos of Norway and color-corrected Sentinel-2 images from 2022.
- Added spatial audio

July 2021:

- Audio problems are fixed, now using audio worklets.
- Most prominent tiles are loaded first, reducing apparent loading times.
- Updated `three.js`.

April 2021:

- Updated satellite photos, taken summer/fall 2019, giving better image quality and more realistic colors.
- New external cameras: Press `space bar` to cycle between internal camera (cockpit), "follower camera" and external camera.
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
- 3D model of F-16 is taken from http://www.domawe.net/2015/10/f-16c-fighting-falcon-free-3d-models.html, the landing gears from https://rigmodels.com/model.php?view=F-16_Fighting_Falcon_Jet_Fighter_Aircraft-3d-model__81ac66f8ec544649927fb2fc0e44fba1
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
