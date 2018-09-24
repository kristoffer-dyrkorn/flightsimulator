export default class Enginesound {
  constructor() {
    const Context = window.AudioContext || webkitAudioContext
    this.audioContext = new Context()

    // create a 1 channel buffer containing 5 seconds of audio
    this.noiseBuffer = this.audioContext.createBuffer(1, 5 * this.audioContext.sampleRate, this.audioContext.sampleRate)

    // generate brown noise. Taken from https://noisehack.com/generate-noise-web-audio-api/
    for (let channel = 0; channel < this.noiseBuffer.numberOfChannels; channel++) {
      let buffer = this.noiseBuffer.getChannelData(channel)
      let lastOut = 0
      for (let i = 0; i < buffer.length; i++) {
        let noise = Math.random() * 2 - 1
        buffer[i] = (lastOut + 0.02 * noise) / 1.02
        lastOut = buffer[i]
        buffer[i] *= 5.5
      }
    }

    this.noiseSource = this.audioContext.createBufferSource()
    this.noiseSource.buffer = this.noiseBuffer
    this.noiseSource.loop = true

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

    this.noiseSource.start()
    this.pitchSource.start()
  }

  resume() {
    this.audioContext.resume()
  }

  setOutput(throttle) {
    // map throttle range 0 - 100 to frequency range 1000 - 6000 Hz
    const frequency = 1000 + throttle * 50
    const volumeFactor = frequency / 5000

    this.pitchSource.frequency.setValueAtTime(frequency, this.audioContext.currentTime)

    const noiseVolume = volumeFactor * volumeFactor + 0.4
    this.noiseGain.gain.setValueAtTime(noiseVolume, this.audioContext.currentTime)

    const pitchVolume = 0.1 - 0.05 * volumeFactor
    this.pitchGain.gain.setValueAtTime(pitchVolume, this.audioContext.currentTime)
  }
}
