// How little an audio parameter may change before it is set again - far below
// anything audible. Setting one is costly (each setValueAtTime schedules an
// event on the audio thread): set every frame, the twenty of them here took a
// fifth of the main thread's time.
const POSITION_TOLERANCE = 0.01 // m
const DIRECTION_TOLERANCE = 1e-4
const FREQUENCY_TOLERANCE = 0.1 // Hz
const GAIN_TOLERANCE = 1e-4

export default class EngineSound {
  start(audioContext) {
    this.audioContext = audioContext
    this.listener = this.audioContext.listener

    /* the value each parameter was last set to - see set */
    this.values = new Map()

    this.panner = new PannerNode(this.audioContext)

    this.panner.coneInnerAngle = 30
    this.panner.coneOuterAngle = 120
    this.panner.coneOuterGain = 0.4
    this.panner.refDistance = 70
    this.panner.rolloffFactor = 2

    this.noiseSource = new AudioWorkletNode(this.audioContext, "brown-noise-processor")
    this.noiseGain = this.audioContext.createGain()
    this.set(this.noiseGain.gain, 0, 0)

    this.noiseSource.connect(this.noiseGain)
    this.noiseGain.connect(this.panner)

    this.pitchSource = this.audioContext.createOscillator()
    this.pitchSource.type = "triangle"
    this.set(this.pitchSource.frequency, 1000, 0)
    this.pitchSource.start()

    this.pitchGain = this.audioContext.createGain()
    this.pitchVolume = 0
    this.set(this.pitchGain.gain, 0, 0)

    this.pitchSource.connect(this.pitchGain)
    this.pitchGain.connect(this.panner)

    this.panner.connect(this.audioContext.destination)

    // The listener stays at the origin, and the engine is placed relative to
    // it - see update. In the cockpit the engine is then always in the same
    // place, and is set once. (The positions of the scene are UTM
    // coordinates, millions of meters, which the parameters' 32-bit floats
    // only hold to half a meter or so.)
    this.set(this.listener.positionX, 0, 0)
    this.set(this.listener.positionY, 0, 0)
    this.set(this.listener.positionZ, 0, 0)
  }

  // sets an audio parameter, unless it is within tolerance of what it was
  // last set to - see POSITION_TOLERANCE
  set(param, value, tolerance) {
    const last = this.values.get(param)
    if (last !== undefined && Math.abs(value - last) <= tolerance) return
    this.values.set(param, value)
    param.setValueAtTime(value, this.audioContext.currentTime)
  }

  update(camera, f16, throttle) {
    // the engine, as seen from the listener - the camera
    this.set(this.panner.positionX, f16.position.x - camera.position.x, POSITION_TOLERANCE)
    this.set(this.panner.positionY, f16.position.y - camera.position.y, POSITION_TOLERANCE)
    this.set(this.panner.positionZ, f16.position.z - camera.position.z, POSITION_TOLERANCE)

    const source = f16.matrixWorld.elements
    this.set(this.panner.orientationX, -source[4], DIRECTION_TOLERANCE)
    this.set(this.panner.orientationY, -source[5], DIRECTION_TOLERANCE)
    this.set(this.panner.orientationZ, -source[6], DIRECTION_TOLERANCE)

    const view = camera.matrixWorld.elements
    this.set(this.listener.forwardX, -view[8], DIRECTION_TOLERANCE)
    this.set(this.listener.forwardY, -view[9], DIRECTION_TOLERANCE)
    this.set(this.listener.forwardZ, -view[10], DIRECTION_TOLERANCE)

    this.set(this.listener.upX, view[4], DIRECTION_TOLERANCE)
    this.set(this.listener.upY, view[5], DIRECTION_TOLERANCE)
    this.set(this.listener.upZ, view[6], DIRECTION_TOLERANCE)

    // map throttle range 0 - 100 to frequency range 1000 - 6000 Hz
    const frequency = 1000 + throttle * 50
    const volumeFactor = frequency / 5000

    this.set(this.pitchSource.frequency, frequency, FREQUENCY_TOLERANCE)

    const noiseVolume = volumeFactor * volumeFactor + 0.4
    this.set(this.noiseGain.gain, noiseVolume, GAIN_TOLERANCE)

    const pitchVolume = 0.1 - 0.04 * volumeFactor
    this.set(this.pitchGain.gain, pitchVolume, GAIN_TOLERANCE)
  }
}
