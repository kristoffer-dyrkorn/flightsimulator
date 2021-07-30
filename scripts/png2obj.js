const fs = require("fs");
const PNG = require("pngjs3").PNG;

if (process.argv.length != 4) {
  console.log("Usage: node png2obj input.png demResolution > output.obj");
  process.exit();
}

const pngFile = process.argv[2];

const demResolution = Number(process.argv[3]);

fs.createReadStream(pngFile)
  // skipRescale = true keeps input data to 16 bit
  .pipe(new PNG({ skipRescale: true }))
  .on("parsed", function () {
    // output vertex coordinates
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // reverse y axis (flip y)
        // stepping y from this.height-1 down to 0 does somehow not work
        const idx = (this.width * (this.height - y - 1) + x) << 2;

        // coordinates are relative to lower left corner
        const px = x * demResolution;
        const py = y * demResolution;
        const pz = this.data[idx];

        console.log(`v ${px} ${py} ${pz}`);
      }
    }

    /*
    // NOT NEEDED, added in a later stage (obj2msh)
    // output texture coordinates
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // coordinates are 0..1
        const tx = x / this.width;
        const ty = y / this.width;

        console.log(`vt ${tx.toFixed(4)} ${ty.toFixed(4)}`);
      }
    }
*/

    // output triangles
    for (let y = 0; y < this.height - 1; y++) {
      for (let x = 0; x < this.width - 1; x++) {
        // vertex indices are 1-based, so add 1
        const v1 = y * this.width + x + 1;
        const v2 = v1 + 1;
        const v3 = v1 + this.width;

        const v4 = v1 + 1;
        const v5 = v4 + this.width;
        const v6 = v5 - 1;

        // output faces with uv coords
        //        console.log(`f ${v1}/${v1} ${v2}/${v2} ${v3}/${v3}`);
        //        console.log(`f ${v4}/${v4} ${v5}/${v5} ${v6}/${v6}`);

        console.log(`f ${v1} ${v2} ${v3}`);
        console.log(`f ${v4} ${v5} ${v6}`);
      }
    }
  });
