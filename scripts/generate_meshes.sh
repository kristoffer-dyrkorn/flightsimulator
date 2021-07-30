#!/bin/bash

# vrt input file
inputfile=$1

# where to put output meshes (msh files)
outputdir=$2

# width and height of a single tile, in meters
tile_extents=$3

# resolution to resample source DTM to (distance between data points, in meters)
resolution=$4

# one tile is NxN data points
((tile_size = ( tile_extents / resolution ) + 1))

echo "Tile size: $tile_size points"

# set UTM coordinates of the tile set extents
tiles_min_x=$5
tiles_min_y=$6
tiles_max_x=$7
tiles_max_y=$8

tmpdir="tmpdir-meshes"

# create directories if needed
mkdir -p $tmpdir
mkdir -p $outputdir

# empty the working directory
rm -f $tmpdir/*

# empty the output directory
rm -f $outputdir/*

# resample source DEM to given resolution and
# use 16-bit grayscale PNGs to store height maps
common_params="-tr $resolution $resolution -r cubic -of png -ot Uint16"

for ((x=$tiles_min_x; x<=$tiles_max_x; x+=tile_extents))
do
	for ((y=$tiles_min_y; y<=$tiles_max_y; y+=tile_extents))
	do
        # calculate the UTM coordinates of the remaining corner points
        # add extra row and column since last row/column in this tile must equal first row/column of next tile
        ((top_left_y = y + tile_extents + resolution))
        ((bottom_right_x = x + tile_extents + resolution))
        gdal_translate $common_params -projwin $x $top_left_y $bottom_right_x $y $inputfile $tmpdir/$x-$y.png
        rm $tmpdir/$x-$y.png.aux.xml
	done
done

for file in ./$tmpdir/*.png
do
    noextension=${file%.*}
    basename=${noextension##*/}

    # create fullres obj file
    node png2obj $file $resolution > $tmpdir/$basename-fullres.obj

    # simplify to 10% of original triangle count
    ./simplify-keepborder $tmpdir/$basename-fullres.obj $tmpdir/$basename-lowres.obj 0.2

    # reorder tri indices for optimal gpu cache hit rate
    node optimize_vertex_order.js $tmpdir/$basename-lowres.obj $tmpdir/$basename-optimized.obj

    # create binary mesh file
    # NOTE texture coordinates are calculated from vertices and added here
    node obj2msh.js $tmpdir/$basename-optimized.obj $outputdir/$basename.msh $tile_extents

    rm $tmpdir/$basename-fullres.obj
    rm $tmpdir/$basename-lowres.obj
    rm $tmpdir/$basename-optimized.obj
done
