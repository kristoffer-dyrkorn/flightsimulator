#!/bin/bash

# crate a virtual DTM consisting of all the DEM files
gdalbuildvrt norge.vrt n50m/*.dem

# create a GeoTIFF file for easier processing
# the coordinates provided here specify a bounding box covering all of Norway
gdalwarp -te -100000 6400000 1137000 8000000 -multi --config GDAL_CACHEMAX 1500 -wm 1500 norge.vrt norge.tif

# get DTM metadata
gdalinfo norge.tif > info.txt

# define tile size (NxN data points)
tile_size=256

# geographical distance between data points
resolution=$(cat info.txt | grep "Pixel Size" | cut -d "(" -f2 | cut -d "." -f1)

# geographical extents of a tile
((tile_extents = (tile_size - 1) * resolution))

# UTM coordinates of the corners of the DTM
lower_left=$(cat info.txt | grep "Lower Left")
upper_right=$(cat info.txt | grep "Upper Right")

# define a bounding box, in UTM coordinates, around the tiles we generate
tiles_min_x=33500
tiles_max_x=161000

tiles_min_y=6882500
tiles_max_y=7010000

lower_left_x=${lower_left:14:7}
lower_left_y=${lower_left:27:7}

upper_right_x=${upper_right:14:7}
upper_right_y=${upper_right:27:7}

# offsets for a tile within the DTM, measured in number of data points
((raster_start_x = (tiles_min_x - lower_left_x) / resolution))
((raster_start_y = -(tiles_max_y - upper_right_y) / resolution))

# reference to the upper left corner of the tile within the DTM
# note: the srcwin parameter, defining the source area, specifies increasing y values
# going southwards - while in the UTM model, increasing y values go northwards
start_x=raster_start_x
start_y=raster_start_y

# quantize all height values to 10 meter accuracy 
# so we can store heights as a byte value in a PNG
# this works well in Norway since max altitude is 2469 metres
# loss of accuracy is negligible as long as we don't use high resolution DTMs
common_params="-ot Byte -strict -a_nodata 0 -of png -scale 0 2469 0 247"

for ((x=$tiles_min_x; x<=$tiles_max_x; x+=tile_extents))
do
    # step in decreasing y direction since srcwin y coordinates run the opposite direction of geo y coordinates
	for ((y=$tiles_max_y; y>=$tiles_min_y; y-=tile_extents))
	do
        # calculate the UTM coordinate of the bottom left corner of the tile and use as file name
        ((bottom_left_y = y - tile_extents))
		gdal_translate $common_params -srcwin $((start_x)) $((start_y)) $tile_size $tile_size norge.tif geotiles/$x-$bottom_left_y.png
        ((start_y += (tile_size - 1)))
	done
    ((start_x += (tile_size - 1)))    
    start_y=raster_start_y
done

# remove non-needed metadata
rm geotiles/*.xml