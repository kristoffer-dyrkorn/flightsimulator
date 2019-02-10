#!/bin/bash

# First, download Sentinel files (85 in total - to cover the whole of Norway) from:
#
# https://kartkatalog.geonorge.no/metadata/uuid/42f35de3-c8eb-47be-972e-f0d5a80b6543
#
# Then, put them in a folder called sentinel/ . Run the script. NOTE: GDAL and ImageMagick is required. Install if needed.
# Output is written to the folder satellite/ . Move the files to the folder (project root)src/data/satellite.

# create virtual file representing the whole data set
gdalbuildvrt satellite.vrt sentinel/*.tif

# one tile is NxN data points
tile_size=1275

# distance between data points, in meters
resolution=10

# width and height of a single tile, in meters
((tile_extents = tile_size * resolution))

# TEST: tiles around start point
# tiles_min_x=53000
# tiles_min_y=6910000
# tiles_max_x=129500
# tiles_max_y=7012000

# set UTM coordinates of the tile set extents (whole of Norway)
tiles_min_x=-87250
tiles_min_y=6438250
tiles_max_x=1137000
tiles_max_y=7949000

for ((x=$tiles_min_x; x<=$tiles_max_x; x+=tile_extents))
do
	for ((y=$tiles_min_y; y<=$tiles_max_y; y+=tile_extents))
	do
        # calculate the UTM coordinates of the remaining corner points
        ((top_left_y = y + tile_extents))
        ((bottom_right_x = x + tile_extents))
        # create tiles in tiff format
        gdal_translate -projwin $x $top_left_y $bottom_right_x $y satellite.vrt satellite/$x-$y.tif
        # convert tiff files to jpg. convert is part of ImageMagick
        convert -define tiff:ignore-tags=32934,33550,33922,34735,34737,42113 -resize 1024x1024 -fill gray50 -gamma 0.75 -colorize 25% -channel G -level 0%,100%,0.9 -channel B +level 10%,100%,1.1 -quality 85% satellite/$x-$y.tif satellite/$x-$y.jpg
        rm satellite/$x-$y.tif
	done
done