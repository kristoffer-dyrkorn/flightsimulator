import Interpolator from "./interpolator.js"

export default class DataTable1D {
  constructor(data) {
    this.data = data
  }

  setRange(minValue, maxValue) {
    this.index = new Interpolator(minValue, maxValue, this.data.length)
  }

  lookup(value) {
    this.index.setInput(value)
    return this.index.lookup(this.data)
  }
}
