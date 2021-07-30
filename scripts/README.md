## Scripts to generate meshes and textures

These scripts read DEMs and satelitte photos from Kartverket and convert the data to the formats used in the simulator.

Sources:

- DEM files: https://kartkatalog.geonorge.no/metadata/kartverket/dtm-50/e25d0104-0858-4d06-bba8-d154514c11d2
- Satelitte photos: https://kartkatalog.geonorge.no/metadata/uuid/42f35de3-c8eb-47be-972e-f0d5a80b6543

## How to run

Use GDAL to create a VRT file containing all the files for a given data source (DEM files or satelitte files).

To generate meshes, run `generate_meshes.sh`. Needed input parameteres are:
Input file, output directory, tile size (meters), tile resolution (meters) and geographic extents.

To generate texture files, run `generate_textures.sh`. Needed input parameters are:
Input file, output directory, tile size (meters), texture size (pixels) and geographic extents.

Note: Data generation for all of Norway will take several hours.
