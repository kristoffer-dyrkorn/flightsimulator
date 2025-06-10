// int **getHyperCube(double **X,double *V,ND_INFO ndinfo){

function getHyperCube(headerTables, parameters, dimensions) {
  const indexMatrix = Array.from({ length: dimensions.length }, () => new Array(2))

  for (let i = 0; i < dimensions.length; i++) {
    const indexMax = dimensions[i]
    const xmax = headerTables[i][indexMax - 1]
    const xmin = headerTables[i][0]

    const x = parameters[i]

    //		if(x<xmin || x>xmax)
    //			console.log("Point lies outside data grid");

    for (let j = 0; j < indexMax - 1; j++) {
      if (x == headerTables[i][j]) {
        indexMatrix[i][0] = indexMatrix[i][1] = j
        break
      }
      if (x == headerTables[i][j + 1]) {
        indexMatrix[i][0] = indexMatrix[i][1] = j + 1
        break
      }
      if (x > headerTables[i][j] && x < headerTables[i][j + 1]) {
        indexMatrix[i][0] = j
        indexMatrix[i][1] = j + 1
        break
      }
    }
  }
  return indexMatrix
}

// int getLinIndex(int *indexVector,ND_INFO ndinfo){

function getLinIndex(indexVector, dimensions) {
  let linIndex = 0
  for (let i = 0; i < dimensions.length; i++) {
    let P = 1
    for (let j = 0; j < i; j++) P = P * dimensions[j]
    linIndex = linIndex + P * indexVector[i]
  }
  return linIndex
}

// function linearInterpolate(double*T,double *V,double **X,ND_INFO ndinfo){

function linearInterpolate(T, parameters, xPoint, dimensions) {
  const indexVector = new Array(dimensions.length)

  let n = dimensions.length
  let nVertices = 1 << n

  // copy the T array - by *value*
  let oldT = T.slice()

  let dimNum = 0

  while (n > 0) {
    let m = n - 1
    nVertices = 1 << m
    const newT = new Array(nVertices)
    for (let i = 0; i < nVertices; i++) {
      for (let j = 0; j < m; j++) {
        const mask = 1 << j
        indexVector[j] = (mask & i) >> j
      }
      let index1 = 0
      let index2 = 0
      for (let j = 0; j < m; j++) {
        index1 = index1 + (1 << (j + 1)) * indexVector[j]
        index2 = index2 + (1 << j) * indexVector[j]
      }
      let f1 = oldT[index1]
      let f2 = oldT[index1 + 1]
      if (xPoint[dimNum][0] != xPoint[dimNum][1]) {
        const lambda = (parameters[dimNum] - xPoint[dimNum][0]) / (xPoint[dimNum][1] - xPoint[dimNum][0])
        newT[index2] = lambda * f2 + (1 - lambda) * f1
      } else newT[index2] = f1
    }

    // copy the newT array - by *value*
    oldT = newT.slice()
    n = m
    dimNum++
  }
  return oldT[0]
}

//function interpolate(double **X,double *Y,double *x,ND_INFO ndinfo){

export function interpolate(headerTables, dataTable, parameters, dimensions) {
  const indexVector = new Array(dimensions.length)

  const xPoint = Array.from({ length: dimensions.length }, () => new Array(2))
  const indexMatrix = getHyperCube(headerTables, parameters, dimensions)

  const nVertices = 1 << dimensions.length
  const T = new Array(nVertices)

  for (let i = 0; i < dimensions.length; i++) {
    const low = indexMatrix[i][0]
    const high = indexMatrix[i][1]
    xPoint[i][0] = headerTables[i][low]
    xPoint[i][1] = headerTables[i][high]
  }

  for (let i = 0; i < nVertices; i++) {
    for (let j = 0; j < dimensions.length; j++) {
      const mask = 1 << j
      const val = (mask & i) >> j
      indexVector[j] = indexMatrix[j][val]
    }
    const index = getLinIndex(indexVector, dimensions)
    T[i] = dataTable[index]
  }

  return linearInterpolate(T, parameters, xPoint, dimensions)
}
