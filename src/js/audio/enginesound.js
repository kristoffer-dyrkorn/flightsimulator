export default class EngineSound {
  constructor(audioContext) {
    this.audioContext = audioContext

    this.noiseSource = new AudioWorkletNode(this.audioContext, "brown-noise-processor")

    this.noiseGain = this.audioContext.createGain()
    this.noiseGain.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.noiseSource.connect(this.noiseGain)
    this.noiseGain.connect(this.audioContext.destination)

    this.pitchSource = this.audioContext.createOscillator()
    this.pitchSource.type = "triangle"
    this.pitchSource.frequency.setValueAtTime(1000, this.audioContext.currentTime)

    this.pitchGain = this.audioContext.createGain()
    this.pitchVolume = 0
    this.pitchGain.gain.setValueAtTime(0, this.audioContext.currentTime)

    this.pitchSource.connect(this.pitchGain)
    this.pitchGain.connect(this.audioContext.destination)

    this.pitchSource.start()
  }

  setOutput(throttle) {
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
