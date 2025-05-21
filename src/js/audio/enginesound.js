export default class EngineSound {
  start(audioContext) {
    this.audioContext = audioContext
    this.listener = this.audioContext.listener

    this.panner = new PannerNode(this.audioContext)

    this.panner.coneInnerAngle = 30
    this.panner.coneOuterAngle = 120
    this.panner.coneOuterGain = 0.4
    this.panner.refDistance = 70
    this.panner.rolloffFactor = 2

    this.noiseSource = new AudioWorkletNode(this.audioContext, "brown-noise-processor")
    this.noiseGain = this.audioContext.createGain()
    this.noiseGain.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.noiseSource.connect(this.noiseGain)
    this.noiseGain.connect(this.panner)

    this.pitchSource = this.audioContext.createOscillator()
    this.pitchSource.type = "triangle"
    this.pitchSource.frequency.setValueAtTime(1000, this.audioContext.currentTime)
    this.pitchSource.start()

    this.pitchGain = this.audioContext.createGain()
    this.pitchVolume = 0
    this.pitchGain.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.pitchSource.connect(this.pitchGain)
    this.pitchGain.connect(this.panner)

    this.panner.connect(this.audioContext.destination)
  }

  update(camera, f16, throttle) {
    this.panner.positionX.setValueAtTime(f16.position.x, this.audioContext.currentTime)
    this.panner.positionY.setValueAtTime(f16.position.y, this.audioContext.currentTime)
    this.panner.positionZ.setValueAtTime(f16.position.z, this.audioContext.currentTime)

    const sourceDirection = [-f16.matrixWorld.elements[4], -f16.matrixWorld.elements[5], -f16.matrixWorld.elements[6]]

    this.panner.orientationX.setValueAtTime(sourceDirection[0], this.audioContext.currentTime)
    this.panner.orientationY.setValueAtTime(sourceDirection[1], this.audioContext.currentTime)
    this.panner.orientationZ.setValueAtTime(sourceDirection[2], this.audioContext.currentTime)

    this.listener.positionX.setValueAtTime(camera.position.x, this.audioContext.currentTime)
    this.listener.positionY.setValueAtTime(camera.position.y, this.audioContext.currentTime)
    this.listener.positionZ.setValueAtTime(camera.position.z, this.audioContext.currentTime)

    const listenerDirection = [
      -camera.matrixWorld.elements[8],
      -camera.matrixWorld.elements[9],
      -camera.matrixWorld.elements[10],
    ]

    this.listener.forwardX.setValueAtTime(listenerDirection[0], this.audioContext.currentTime)
    this.listener.forwardY.setValueAtTime(listenerDirection[1], this.audioContext.currentTime)
    this.listener.forwardZ.setValueAtTime(listenerDirection[2], this.audioContext.currentTime)

    const listenerUp = [camera.matrixWorld.elements[4], camera.matrixWorld.elements[5], camera.matrixWorld.elements[6]]

    this.listener.upX.setValueAtTime(listenerUp[0], this.audioContext.currentTime)
    this.listener.upY.setValueAtTime(listenerUp[1], this.audioContext.currentTime)
    this.listener.upZ.setValueAtTime(listenerUp[2], this.audioContext.currentTime)

    // map throttle range 0 - 100 to frequency range 1000 - 6000 Hz
    const frequency = 1000 + throttle * 50
    const volumeFactor = frequency / 5000

    this.pitchSource.frequency.setValueAtTime(frequency, this.audioContext.currentTime)

    const noiseVolume = volumeFactor * volumeFactor + 0.4
    this.noiseGain.gain.setValueAtTime(noiseVolume, this.audioContext.currentTime)

    const pitchVolume = 0.1 - 0.04 * volumeFactor
    this.pitchGain.gain.setValueAtTime(pitchVolume, this.audioContext.currentTime)
  }
}
