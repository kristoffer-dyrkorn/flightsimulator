const fs = require("fs");
const path = require("path");
const parseOBJ = require("parse-obj");

if (process.argv.length != 5) {
  console.log("Usage: node obj2msh.js input.obj output.msh tileExtents");
  process.exit();
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

const extents = Number(process.argv[4]);

// read tile bounds coordinates from file name
const name = path.basename(inputFile).split(".")[0];

console.log("Converting tile " + name + " to msh file.");

parseOBJ(fs.createReadStream(inputFile), function (err, mesh) {
  if (err) {
    throw new Error("Error parsing OBJ file: " + err);
  }

  const vertices = mesh.vertexPositions;
  const triangles = mesh.facePositions;

  // buffer length =
  // 1 * 16-bit: vertex count
  // vertexcount * (16 bits each of x, y, z): vertex coords
  // vertexcount * (16 bits each of u, v): texture coords
  // 1 * 16-bit: triangle count
  // trianglecount * (16 bits each of v0, v1, v2): vertex indices

  const bufferLength =
    2 +
    vertices.length * (2 + 2 + 2) +
    vertices.length * (2 + 2) +
    2 +
    triangles.length * (2 + 2 + 2);

  const fileData = Buffer.alloc(bufferLength);

  // write vertex count
  let offset = fileData.writeUInt16LE(vertices.length, 0);

  // write vertex coordinates
  for (let i = 0; i < vertices.length; i++) {
    offset = fileData.writeUInt16LE(vertices[i][0], offset);
    offset = fileData.writeUInt16LE(vertices[i][1], offset);

    let z = vertices[i][2];
    if (z < 0) z = 0;
    offset = fileData.writeUInt16LE(z, offset);
  }

  // write uv coordinates
  for (let i = 0; i < vertices.length; i++) {
    // scale u,v to 0..1 * (max value for UInt16) = 0..65535
    const u = Math.floor((65535.0 * vertices[i][0]) / extents);
    const v = Math.floor((65535.0 * vertices[i][1]) / extents);

    offset = fileData.writeUInt16LE(u, offset);
    // flip y coordinate, as per WebGL convention
    offset = fileData.writeUInt16LE(65535 - v, offset);
  }

  // write triangle counts
  offset = fileData.writeUInt16LE(triangles.length, offset);

  // write triangle indices
  for (let i = 0; i < triangles.length; i++) {
    offset = fileData.writeUInt16LE(triangles[i][0], offset);
    offset = fileData.writeUInt16LE(triangles[i][1], offset);
    offset = fileData.writeUInt16LE(triangles[i][2], offset);
  }

  fs.writeFileSync(outputFile, fileData);
});
