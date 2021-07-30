const fs = require("fs");
const path = require("path");
const parseOBJ = require("parse-obj");

// Optimize vertex order for cache optimization
// JavaScript conversion of Martin Storsjo's implementation of the
// Forsyth algorithm, see: https://www.martin.st/thesis/

if (process.argv.length != 4) {
  console.log("Usage: node optimize_vertex_order input.obj output.obj");
  process.exit();
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

// read tile bounds coordinates from file name
const name = path.basename(inputFile).split(".")[0];

console.log("Optimizing tile: " + name);

/** --- */

const VERTEX_CACHE_SIZE = 8;
const CACHE_FUNCTION_LENGTH = 32;

const SCORE_SCALING = 7281;

// The size of the precalculated tables
const CACHE_SCORE_TABLE_SIZE = 32;
const VALENCE_SCORE_TABLE_SIZE = 32;

// Precalculated tables
const cachePositionScore = [];
const valenceScore = [];

// Score function constants
const CACHE_DECAY_POWER = 1.5;
const LAST_TRI_SCORE = 0.75;
const VALENCE_BOOST_SCALE = 2.0;
const VALENCE_BOOST_POWER = 0.5;

// Precalculate the tables
function initForsyth() {
  for (let i = 0; i < CACHE_SCORE_TABLE_SIZE; i++) {
    let score = 0;
    if (i < 3) {
      // This vertex was used in the last triangle,
      // so it has a fixed score, which ever of the three
      // it's in. Otherwise, you can get very different
      // answers depending on whether you add
      // the triangle 1,2,3 or 3,1,2 - which is silly
      score = LAST_TRI_SCORE;
    } else {
      // Points for being high in the cache.
      const scaler = 1.0 / (CACHE_FUNCTION_LENGTH - 3);
      let score = 1.0 - (i - 3) * scaler;
      score = Math.pow(score, CACHE_DECAY_POWER);
    }
    cachePositionScore[i] = SCORE_SCALING * score;
  }

  for (let i = 1; i < VALENCE_SCORE_TABLE_SIZE; i++) {
    // Bonus points for having a low number of tris still to
    // use the vert, so we get rid of lone verts quickly
    const valenceBoost = Math.pow(i, -VALENCE_BOOST_POWER);
    const score = VALENCE_BOOST_SCALE * valenceBoost;
    valenceScore[i] = SCORE_SCALING * score;
  }
}

// Calculate the score for a vertex
function findVertexScore(numActiveTris, cachePosition) {
  if (numActiveTris === 0) {
    // No triangles need this vertex!
    return 0;
  }

  let score = 0;
  if (cachePosition < 0) {
    // Vertex is not in LRU cache - no score
  } else {
    score = cachePositionScore[cachePosition];
  }

  if (numActiveTris < VALENCE_SCORE_TABLE_SIZE)
    score += valenceScore[numActiveTris];
  return score;
}

// The main reordering function
function reorderForsyth(indices, nTriangles, nVertices) {
  const numActiveTris = new Array(nVertices).fill(0);

  // First scan over the vertex data, count the total number of
  // occurrances of each vertex
  for (let i = 0; i < 3 * nTriangles; i++) {
    numActiveTris[indices[i]]++;
  }

  // Allocate the rest of the arrays
  const offsets = [];
  const lastScore = [];
  const cacheTag = [];

  let triangleAdded = [];
  let triangleScore = new Array(nTriangles).fill(0);
  let triangleIndices = [];

  // Count the triangle array offset for each vertex,
  // initialize the rest of the data.
  let sum = 0;
  for (let i = 0; i < nVertices; i++) {
    offsets[i] = sum;
    sum += numActiveTris[i];
    numActiveTris[i] = 0;
    cacheTag[i] = -1;
  }

  // Fill the vertex data structures with indices to the triangles
  // using each vertex
  for (let i = 0; i < nTriangles; i++) {
    for (let j = 0; j < 3; j++) {
      const v = indices[3 * i + j];
      triangleIndices[offsets[v] + numActiveTris[v]] = i;
      numActiveTris[v]++;
    }
  }

  // Initialize the score for all vertices
  for (let i = 0; i < nVertices; i++) {
    lastScore[i] = findVertexScore(numActiveTris[i], cacheTag[i]);
    for (let j = 0; j < numActiveTris[i]; j++)
      triangleScore[triangleIndices[offsets[i] + j]] += lastScore[i];
  }

  // Find the best triangle
  let bestTriangle = -1;
  let bestScore = -1;

  for (let i = 0; i < nTriangles; i++) {
    if (triangleScore[i] > bestScore) {
      bestScore = triangleScore[i];
      bestTriangle = i;
    }
  }

  // Allocate the output array
  const outTriangles = [];
  let outPos = 0;

  // Initialize the cache
  const cache = [];
  for (let i = 0; i < VERTEX_CACHE_SIZE + 3; i++) cache[i] = -1;

  let scanPos = 0;

  // Output the currently best triangle, as long as there
  // are triangles left to output
  while (bestTriangle >= 0) {
    // Mark the triangle as added
    triangleAdded[bestTriangle] = true;
    // Output this triangle
    outTriangles[outPos++] = bestTriangle;
    for (let i = 0; i < 3; i++) {
      // Update this vertex
      const v = indices[3 * bestTriangle + i];

      // Check the current cache position, if it
      // is in the cache
      let endpos = cacheTag[v];
      if (endpos < 0) endpos = VERTEX_CACHE_SIZE + i;
      // Move all cache entries from the previous position
      // in the cache to the new target position (i) one
      // step backwards
      for (let j = endpos; j > i; j--) {
        cache[j] = cache[j - 1];
        // If this cache slot contains a real
        // vertex, update its cache tag
        if (cache[j] >= 0) cacheTag[cache[j]]++;
      }
      // Insert the current vertex into its new target
      // slot
      cache[i] = v;
      cacheTag[v] = i;

      // Find the current triangle in the list of active
      // triangles and remove it (moving the last
      // triangle in the list to the slot of this triangle).
      for (let j = 0; j < numActiveTris[v]; j++) {
        if (triangleIndices[offsets[v] + j] == bestTriangle) {
          triangleIndices[offsets[v] + j] =
            triangleIndices[offsets[v] + numActiveTris[v] - 1];
          break;
        }
      }
      // Shorten the list
      numActiveTris[v]--;
    }
    // Update the scores of all triangles in the cache
    for (let i = 0; i < VERTEX_CACHE_SIZE + 3; i++) {
      let v = cache[i];
      if (v < 0) break;
      // This vertex has been pushed outside of the
      // actual cache
      if (i >= VERTEX_CACHE_SIZE) {
        cacheTag[v] = -1;
        cache[i] = -1;
      }
      const newScore = findVertexScore(numActiveTris[v], cacheTag[v]);
      const diff = newScore - lastScore[v];
      for (let j = 0; j < numActiveTris[v]; j++)
        triangleScore[triangleIndices[offsets[v] + j]] += diff;
      lastScore[v] = newScore;
    }
    // Find the best triangle referenced by vertices in the cache
    bestTriangle = -1;
    bestScore = -1;
    for (let i = 0; i < VERTEX_CACHE_SIZE; i++) {
      if (cache[i] < 0) break;
      const v = cache[i];
      for (let j = 0; j < numActiveTris[v]; j++) {
        const t = triangleIndices[offsets[v] + j];
        if (triangleScore[t] > bestScore) {
          bestTriangle = t;
          bestScore = triangleScore[t];
        }
      }
    }
    // If no active triangle was found at all, continue
    // scanning the whole list of triangles
    if (bestTriangle < 0) {
      for (; scanPos < nTriangles; scanPos++) {
        if (!triangleAdded[scanPos]) {
          bestTriangle = scanPos;
          break;
        }
      }
    }
  }

  // Convert the triangle index array into a full triangle list
  const outIndices = [];
  outPos = 0;
  for (let i = 0; i < nTriangles; i++) {
    const t = outTriangles[i];
    for (let j = 0; j < 3; j++) {
      const v = indices[3 * t + j];
      outIndices[outPos++] = v;
    }
  }

  return outIndices;
}

/** --- */

parseOBJ(fs.createReadStream(inputFile), function (err, mesh) {
  if (err) {
    throw new Error("Error parsing OBJ file: " + err);
  }

  const triangles = mesh.facePositions;
  const vertices = mesh.vertexPositions;

  const indices = [];
  for (let i = 0; i < triangles.length; i++) {
    indices.push(triangles[i][0]);
    indices.push(triangles[i][1]);
    indices.push(triangles[i][2]);
  }

  initForsyth();

  const newIndices = reorderForsyth(indices, triangles.length, vertices.length);

  let out = `o ${name}.obj\n`;

  for (let i = 0; i < vertices.length; i++) {
    const x = vertices[i][0];
    const y = vertices[i][1];
    const z = vertices[i][2];
    out += `v ${x} ${y} ${z}\n`;
  }

  for (let i = 0; i < newIndices.length / 3; i++) {
    const v0 = newIndices[3 * i + 0] + 1;
    const v1 = newIndices[3 * i + 1] + 1;
    const v2 = newIndices[3 * i + 2] + 1;
    out += `f ${v0} ${v1} ${v2}\n`;
  }

  fs.writeFileSync(outputFile, out, "utf8");
});
