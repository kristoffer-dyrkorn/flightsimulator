import Interpolator from "./interpolator.js"

export default class DataTable2D {
  constructor(data) {
    this.data = data
  }

  setXRange(minValue, maxValue) {
    this.xIndex = new Interpolator(minValue, maxValue, this.data[0].length)
  }

  setYRange(minValue, maxValue) {
    this.yIndex = new Interpolator(minValue, maxValue, this.data.length)
  }

  lookup(rowValue, colValue) {
    this.xIndex.setInput(rowValue)
    this.yIndex.setInput(colValue)

    const v = this.xIndex.lookup(this.data[this.yIndex.start])
    const w = this.xIndex.lookup(this.data[this.yIndex.end])

    return Interpolator.lerp(this.yIndex.frac, v, w)
  }
}
