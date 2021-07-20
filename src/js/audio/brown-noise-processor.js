class BrownNoiseProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const output = outputs[0]

    output.forEach((channel) => {
      let lastOut = 0
      for (let i = 0; i < channel.length; i++) {
        let noise = Math.random() * 2 - 1
        channel[i] = (lastOut + 0.02 * noise) / 1.02
        lastOut = channel[i]
        channel[i] *= 7.0
      }
    })

    return true
  }
}

registerProcessor("brown-noise-processor", BrownNoiseProcessor)
