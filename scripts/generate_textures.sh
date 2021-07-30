#!/bin/bash

# vrt input file
inputfile=$1

# where to put output textures (basis files)
outputdir=$2

# tile extents, in meters
tile_extents=$3

# output texture size (2^n)
texture_size=$4

# set UTM coordinates of the tile set extents
minx=$5
miny=$6
maxx=$7
maxy=$8

echo "Texture resolution (meters per pixel):"
echo "scale=3;$tile_extents / $texture_size" | bc -l

tmpdir="tmpdir-textures"

# create directories if needed
mkdir -p $tmpdir
mkdir -p $outputdir

# empty the working directory
rm -f $tmpdir/*

# empty the output directory
rm -f $outputdir/*


for ((x=$minx; x<=$maxx; x+=tile_extents))
do
	for ((y=$miny; y<=$maxy; y+=tile_extents))
	do
        # calculate the UTM coordinates of the remaining corner points
        ((top_left_y = y + tile_extents))
        ((bottom_right_x = x + tile_extents))

        # extract tile from tiff
        gdal_translate -projwin $x $top_left_y $bottom_right_x $y $inputfile $tmpdir/$x-$y.png
        rm $tmpdir/$x-$y.png.aux.xml
	done
done

# create textures
for file in ./$tmpdir/*.png
do
    noextension=${file%.*}
    basename=${noextension##*/}

    # rescale to 2^n
    sips -z $texture_size $texture_size $file

    # create compressed texture
    ./basisu -mipmap -q 255 "$file" -output_file $outputdir/$basename.basis
done