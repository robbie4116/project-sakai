"""
generate_tiles.py - one-time asset generation from source rasters

Sources:
  tublay_satellite-highres.tif   - Full Tublay municipality detail imagery (high resolution)
  benguet_satellite.tif          - Benguet province context imagery (wide coverage)

Outputs:
  tiles/plots/plot_000.jpg ... plot_255.jpg  (256 Ambassador plot images)
  tiles/plots/outside_000.jpg ...            (hidden Tublay outside plot images)
  tiles/map/{z}/{x}/{y}.jpg                  (XYZ detail tiles, zoom 12-16)
  tiles/map/empty.jpg                        (fallback tile)
  tiles/context/{z}/{x}/{y}.jpg              (XYZ context tiles, zoom 10-13)
  tiles/context/empty.jpg                    (fallback tile)

Run: python generate_tiles.py
Requires: pip install rasterio Pillow numpy
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window

# CONFIG
DETAIL_SOURCE_TIF = "tublay_satellite-highres.tif"
CONTEXT_SOURCE_TIF = "benguet_satellite.tif"
PLOT_OUT_DIR = Path("tiles/plots")
DETAIL_MAP_OUT_DIR = Path("tiles/map")
CONTEXT_MAP_OUT_DIR = Path("tiles/context")
OUTSIDE_PLOT_PREFIX = "outside_"
PLOT_SIZE = 512
MAP_TILE_PX = 256
JPEG_QUALITY = 85
DETAIL_TILE_QUALITY = 80
CONTEXT_TILE_QUALITY = 74
DETAIL_MIN_ZOOM = 12
DETAIL_MAX_ZOOM = 16
CONTEXT_MIN_ZOOM = 10
CONTEXT_MAX_ZOOM = 13
OUTSIDE_TILE_FILL = (14, 26, 14)

# Authoritative bounds from Benguet_Tublay_boundary.geojson
TUBLAY_BBOX_N = 16.5514979
TUBLAY_BBOX_S = 16.4547903
TUBLAY_BBOX_E = 120.7004932
TUBLAY_BBOX_W = 120.5665814

# Ambassador bounding box (from Boundary_AMBASSADOR_TUBLAY.geojson -> WGS84)
BBOX_N = 16.522177
BBOX_S = 16.455994
BBOX_E = 120.700493
BBOX_W = 120.636396
TILE_BBOX_N = TUBLAY_BBOX_N
TILE_BBOX_S = TUBLAY_BBOX_S
TILE_BBOX_E = TUBLAY_BBOX_E
TILE_BBOX_W = TUBLAY_BBOX_W

AMBASSADOR_POLY = [[16.52175,120.65732],[16.52146,120.65749],[16.52106,120.65766],[16.52078,120.65785],[16.52044,120.65805],[16.52023,120.65822],[16.52004,120.65839],[16.51947,120.65880],[16.51932,120.65886],[16.51918,120.65905],[16.51894,120.65934],[16.51850,120.65998],[16.51823,120.66004],[16.51806,120.66004],[16.51786,120.66002],[16.51773,120.65994],[16.51759,120.65984],[16.51743,120.65985],[16.51686,120.65981],[16.51654,120.65978],[16.51635,120.65990],[16.51629,120.66003],[16.51622,120.66039],[16.51610,120.66075],[16.51602,120.66107],[16.51602,120.66145],[16.51595,120.66196],[16.51595,120.66232],[16.51602,120.66247],[16.51614,120.66265],[16.51627,120.66291],[16.51626,120.66309],[16.51605,120.66327],[16.51577,120.66337],[16.51539,120.66341],[16.51499,120.66361],[16.51474,120.66395],[16.51411,120.66445],[16.51393,120.66480],[16.51367,120.66544],[16.51343,120.66588],[16.51326,120.66601],[16.51311,120.66599],[16.51279,120.66600],[16.51258,120.66628],[16.51252,120.66667],[16.51226,120.66697],[16.51169,120.66730],[16.51120,120.66753],[16.51074,120.66808],[16.51060,120.66849],[16.51068,120.66882],[16.51081,120.66916],[16.51082,120.66952],[16.51079,120.66969],[16.51065,120.66967],[16.51048,120.66968],[16.51024,120.66968],[16.51001,120.66966],[16.50984,120.66958],[16.50962,120.66958],[16.50938,120.66972],[16.50896,120.66997],[16.50855,120.67017],[16.50546,120.67247],[16.50092,120.67611],[16.49810,120.67817],[16.49410,120.68144],[16.49382,120.68249],[16.49351,120.68379],[16.49289,120.68691],[16.49237,120.69010],[16.49179,120.69408],[16.49062,120.69625],[16.48918,120.69750],[16.48627,120.70049],[16.48447,120.69938],[16.48441,120.69781],[16.48469,120.69594],[16.48163,120.69243],[16.47152,120.69676],[16.46945,120.69318],[16.46676,120.68555],[16.46546,120.68195],[16.46060,120.67305],[16.45599,120.66304],[16.45700,120.66262],[16.45795,120.66229],[16.45878,120.66221],[16.45938,120.66227],[16.45970,120.66239],[16.46013,120.66270],[16.46059,120.66266],[16.46095,120.66230],[16.46131,120.66208],[16.46162,120.66237],[16.46189,120.66253],[16.46203,120.66240],[16.46219,120.66217],[16.46268,120.66228],[16.46318,120.66231],[16.46377,120.66223],[16.46440,120.66233],[16.46489,120.66286],[16.46547,120.66324],[16.46641,120.66347],[16.46741,120.66382],[16.46790,120.66374],[16.46864,120.66364],[16.46851,120.66201],[16.46867,120.66042],[16.46976,120.65818],[16.47305,120.65795],[16.47321,120.65794],[16.47361,120.65790],[16.47674,120.65805],[16.48003,120.65779],[16.47992,120.65655],[16.47990,120.65592],[16.47985,120.65543],[16.47969,120.65498],[16.47945,120.65463],[16.47947,120.65430],[16.47964,120.65409],[16.47998,120.65388],[16.48000,120.65368],[16.47982,120.65355],[16.47969,120.65332],[16.47980,120.65315],[16.47998,120.65258],[16.48094,120.65272],[16.48202,120.65291],[16.48536,120.64788],[16.48893,120.64326],[16.49453,120.63981],[16.49609,120.63856],[16.49851,120.63661],[16.49881,120.63640],[16.49909,120.63643],[16.49940,120.63674],[16.49955,120.63702],[16.49969,120.63725],[16.49991,120.63746],[16.50002,120.63778],[16.50007,120.63812],[16.50026,120.63887],[16.50038,120.63909],[16.50051,120.63920],[16.50070,120.63934],[16.50081,120.63959],[16.50089,120.63972],[16.50120,120.64020],[16.50132,120.64049],[16.50150,120.64065],[16.50178,120.64076],[16.50227,120.64123],[16.50270,120.64176],[16.50338,120.64612],[16.50366,120.64638],[16.50374,120.64666],[16.50378,120.64698],[16.50394,120.64708],[16.50417,120.64711],[16.50445,120.64711],[16.50464,120.64714],[16.50496,120.64761],[16.50526,120.64794],[16.50559,120.64816],[16.50575,120.64849],[16.50570,120.64869],[16.50557,120.64876],[16.50538,120.64891],[16.50534,120.64913],[16.50552,120.64924],[16.50577,120.64942],[16.50627,120.64952],[16.50653,120.64947],[16.50684,120.64945],[16.50710,120.64950],[16.50734,120.64967],[16.50753,120.64993],[16.50811,120.65032],[16.50829,120.65010],[16.50844,120.64987],[16.50859,120.64971],[16.50883,120.64959],[16.50912,120.64943],[16.50952,120.64946],[16.50993,120.64948],[16.51023,120.64939],[16.51055,120.64928],[16.51076,120.64927],[16.51101,120.64953],[16.51123,120.64975],[16.51140,120.64982],[16.51152,120.65004],[16.51166,120.65042],[16.51170,120.65068],[16.51182,120.65085],[16.51182,120.65101],[16.51183,120.65149],[16.51198,120.65176],[16.51224,120.65200],[16.51256,120.65223],[16.51293,120.65235],[16.51322,120.65235],[16.51358,120.65234],[16.51389,120.65254],[16.51403,120.65283],[16.51416,120.65297],[16.51434,120.65312],[16.51469,120.65314],[16.51505,120.65315],[16.51532,120.65315],[16.51545,120.65313],[16.51560,120.65295],[16.51571,120.65277],[16.51579,120.65263],[16.51595,120.65247],[16.51604,120.65250],[16.51620,120.65265],[16.51638,120.65260],[16.51657,120.65249],[16.51670,120.65244],[16.51688,120.65245],[16.51701,120.65259],[16.51712,120.65278],[16.51716,120.65306],[16.51728,120.65323],[16.51756,120.65324],[16.51782,120.65331],[16.51812,120.65353],[16.51837,120.65377],[16.51845,120.65391],[16.51854,120.65418],[16.51865,120.65442],[16.51878,120.65474],[16.51879,120.65494],[16.51884,120.65507],[16.51890,120.65516],[16.51891,120.65527],[16.51889,120.65539],[16.51896,120.65552],[16.51927,120.65572],[16.51949,120.65583],[16.51987,120.65610],[16.52018,120.65643],[16.52037,120.65657],[16.52062,120.65666],[16.52084,120.65666],[16.52113,120.65665],[16.52138,120.65665],[16.52153,120.65671],[16.52168,120.65690],[16.52181,120.65703],[16.52198,120.65711],[16.52218,120.65723]]

# Wider satellite-looking context bounds from benguet_satellite.tif.
# At zooms 10-13 this is about 346 tiles, which is practical for an
# offline static bundle while giving field users meaningful orientation.
CONTEXT_BBOX_N = 16.93070509876553
CONTEXT_BBOX_S = 16.1724728083975
CONTEXT_BBOX_E = 120.9375
CONTEXT_BBOX_W = 120.43212890625

# 256 plots (16x16 grid, matching AMBASSADOR_PLOTS order)
PLOTS = [
    {"idx": 0, "latS": 16.518041, "latN": 16.522177, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 1, "latS": 16.518041, "latN": 16.522177, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 2, "latS": 16.518041, "latN": 16.522177, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 3, "latS": 16.518041, "latN": 16.522177, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 4, "latS": 16.518041, "latN": 16.522177, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 5, "latS": 16.518041, "latN": 16.522177, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 6, "latS": 16.518041, "latN": 16.522177, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 7, "latS": 16.518041, "latN": 16.522177, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 8, "latS": 16.518041, "latN": 16.522177, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 9, "latS": 16.518041, "latN": 16.522177, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 10, "latS": 16.518041, "latN": 16.522177, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 11, "latS": 16.518041, "latN": 16.522177, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 12, "latS": 16.518041, "latN": 16.522177, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 13, "latS": 16.518041, "latN": 16.522177, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 14, "latS": 16.518041, "latN": 16.522177, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 15, "latS": 16.518041, "latN": 16.522177, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 16, "latS": 16.513904, "latN": 16.518041, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 17, "latS": 16.513904, "latN": 16.518041, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 18, "latS": 16.513904, "latN": 16.518041, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 19, "latS": 16.513904, "latN": 16.518041, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 20, "latS": 16.513904, "latN": 16.518041, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 21, "latS": 16.513904, "latN": 16.518041, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 22, "latS": 16.513904, "latN": 16.518041, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 23, "latS": 16.513904, "latN": 16.518041, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 24, "latS": 16.513904, "latN": 16.518041, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 25, "latS": 16.513904, "latN": 16.518041, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 26, "latS": 16.513904, "latN": 16.518041, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 27, "latS": 16.513904, "latN": 16.518041, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 28, "latS": 16.513904, "latN": 16.518041, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 29, "latS": 16.513904, "latN": 16.518041, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 30, "latS": 16.513904, "latN": 16.518041, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 31, "latS": 16.513904, "latN": 16.518041, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 32, "latS": 16.509768, "latN": 16.513904, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 33, "latS": 16.509768, "latN": 16.513904, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 34, "latS": 16.509768, "latN": 16.513904, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 35, "latS": 16.509768, "latN": 16.513904, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 36, "latS": 16.509768, "latN": 16.513904, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 37, "latS": 16.509768, "latN": 16.513904, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 38, "latS": 16.509768, "latN": 16.513904, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 39, "latS": 16.509768, "latN": 16.513904, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 40, "latS": 16.509768, "latN": 16.513904, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 41, "latS": 16.509768, "latN": 16.513904, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 42, "latS": 16.509768, "latN": 16.513904, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 43, "latS": 16.509768, "latN": 16.513904, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 44, "latS": 16.509768, "latN": 16.513904, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 45, "latS": 16.509768, "latN": 16.513904, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 46, "latS": 16.509768, "latN": 16.513904, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 47, "latS": 16.509768, "latN": 16.513904, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 48, "latS": 16.505631, "latN": 16.509768, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 49, "latS": 16.505631, "latN": 16.509768, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 50, "latS": 16.505631, "latN": 16.509768, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 51, "latS": 16.505631, "latN": 16.509768, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 52, "latS": 16.505631, "latN": 16.509768, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 53, "latS": 16.505631, "latN": 16.509768, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 54, "latS": 16.505631, "latN": 16.509768, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 55, "latS": 16.505631, "latN": 16.509768, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 56, "latS": 16.505631, "latN": 16.509768, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 57, "latS": 16.505631, "latN": 16.509768, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 58, "latS": 16.505631, "latN": 16.509768, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 59, "latS": 16.505631, "latN": 16.509768, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 60, "latS": 16.505631, "latN": 16.509768, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 61, "latS": 16.505631, "latN": 16.509768, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 62, "latS": 16.505631, "latN": 16.509768, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 63, "latS": 16.505631, "latN": 16.509768, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 64, "latS": 16.501495, "latN": 16.505631, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 65, "latS": 16.501495, "latN": 16.505631, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 66, "latS": 16.501495, "latN": 16.505631, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 67, "latS": 16.501495, "latN": 16.505631, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 68, "latS": 16.501495, "latN": 16.505631, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 69, "latS": 16.501495, "latN": 16.505631, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 70, "latS": 16.501495, "latN": 16.505631, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 71, "latS": 16.501495, "latN": 16.505631, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 72, "latS": 16.501495, "latN": 16.505631, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 73, "latS": 16.501495, "latN": 16.505631, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 74, "latS": 16.501495, "latN": 16.505631, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 75, "latS": 16.501495, "latN": 16.505631, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 76, "latS": 16.501495, "latN": 16.505631, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 77, "latS": 16.501495, "latN": 16.505631, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 78, "latS": 16.501495, "latN": 16.505631, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 79, "latS": 16.501495, "latN": 16.505631, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 80, "latS": 16.497358, "latN": 16.501495, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 81, "latS": 16.497358, "latN": 16.501495, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 82, "latS": 16.497358, "latN": 16.501495, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 83, "latS": 16.497358, "latN": 16.501495, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 84, "latS": 16.497358, "latN": 16.501495, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 85, "latS": 16.497358, "latN": 16.501495, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 86, "latS": 16.497358, "latN": 16.501495, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 87, "latS": 16.497358, "latN": 16.501495, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 88, "latS": 16.497358, "latN": 16.501495, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 89, "latS": 16.497358, "latN": 16.501495, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 90, "latS": 16.497358, "latN": 16.501495, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 91, "latS": 16.497358, "latN": 16.501495, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 92, "latS": 16.497358, "latN": 16.501495, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 93, "latS": 16.497358, "latN": 16.501495, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 94, "latS": 16.497358, "latN": 16.501495, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 95, "latS": 16.497358, "latN": 16.501495, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 96, "latS": 16.493222, "latN": 16.497358, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 97, "latS": 16.493222, "latN": 16.497358, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 98, "latS": 16.493222, "latN": 16.497358, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 99, "latS": 16.493222, "latN": 16.497358, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 100, "latS": 16.493222, "latN": 16.497358, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 101, "latS": 16.493222, "latN": 16.497358, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 102, "latS": 16.493222, "latN": 16.497358, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 103, "latS": 16.493222, "latN": 16.497358, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 104, "latS": 16.493222, "latN": 16.497358, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 105, "latS": 16.493222, "latN": 16.497358, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 106, "latS": 16.493222, "latN": 16.497358, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 107, "latS": 16.493222, "latN": 16.497358, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 108, "latS": 16.493222, "latN": 16.497358, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 109, "latS": 16.493222, "latN": 16.497358, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 110, "latS": 16.493222, "latN": 16.497358, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 111, "latS": 16.493222, "latN": 16.497358, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 112, "latS": 16.489086, "latN": 16.493222, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 113, "latS": 16.489086, "latN": 16.493222, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 114, "latS": 16.489086, "latN": 16.493222, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 115, "latS": 16.489086, "latN": 16.493222, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 116, "latS": 16.489086, "latN": 16.493222, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 117, "latS": 16.489086, "latN": 16.493222, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 118, "latS": 16.489086, "latN": 16.493222, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 119, "latS": 16.489086, "latN": 16.493222, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 120, "latS": 16.489086, "latN": 16.493222, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 121, "latS": 16.489086, "latN": 16.493222, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 122, "latS": 16.489086, "latN": 16.493222, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 123, "latS": 16.489086, "latN": 16.493222, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 124, "latS": 16.489086, "latN": 16.493222, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 125, "latS": 16.489086, "latN": 16.493222, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 126, "latS": 16.489086, "latN": 16.493222, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 127, "latS": 16.489086, "latN": 16.493222, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 128, "latS": 16.484949, "latN": 16.489086, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 129, "latS": 16.484949, "latN": 16.489086, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 130, "latS": 16.484949, "latN": 16.489086, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 131, "latS": 16.484949, "latN": 16.489086, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 132, "latS": 16.484949, "latN": 16.489086, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 133, "latS": 16.484949, "latN": 16.489086, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 134, "latS": 16.484949, "latN": 16.489086, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 135, "latS": 16.484949, "latN": 16.489086, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 136, "latS": 16.484949, "latN": 16.489086, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 137, "latS": 16.484949, "latN": 16.489086, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 138, "latS": 16.484949, "latN": 16.489086, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 139, "latS": 16.484949, "latN": 16.489086, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 140, "latS": 16.484949, "latN": 16.489086, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 141, "latS": 16.484949, "latN": 16.489086, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 142, "latS": 16.484949, "latN": 16.489086, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 143, "latS": 16.484949, "latN": 16.489086, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 144, "latS": 16.480813, "latN": 16.484949, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 145, "latS": 16.480813, "latN": 16.484949, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 146, "latS": 16.480813, "latN": 16.484949, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 147, "latS": 16.480813, "latN": 16.484949, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 148, "latS": 16.480813, "latN": 16.484949, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 149, "latS": 16.480813, "latN": 16.484949, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 150, "latS": 16.480813, "latN": 16.484949, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 151, "latS": 16.480813, "latN": 16.484949, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 152, "latS": 16.480813, "latN": 16.484949, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 153, "latS": 16.480813, "latN": 16.484949, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 154, "latS": 16.480813, "latN": 16.484949, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 155, "latS": 16.480813, "latN": 16.484949, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 156, "latS": 16.480813, "latN": 16.484949, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 157, "latS": 16.480813, "latN": 16.484949, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 158, "latS": 16.480813, "latN": 16.484949, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 159, "latS": 16.480813, "latN": 16.484949, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 160, "latS": 16.476676, "latN": 16.480813, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 161, "latS": 16.476676, "latN": 16.480813, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 162, "latS": 16.476676, "latN": 16.480813, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 163, "latS": 16.476676, "latN": 16.480813, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 164, "latS": 16.476676, "latN": 16.480813, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 165, "latS": 16.476676, "latN": 16.480813, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 166, "latS": 16.476676, "latN": 16.480813, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 167, "latS": 16.476676, "latN": 16.480813, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 168, "latS": 16.476676, "latN": 16.480813, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 169, "latS": 16.476676, "latN": 16.480813, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 170, "latS": 16.476676, "latN": 16.480813, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 171, "latS": 16.476676, "latN": 16.480813, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 172, "latS": 16.476676, "latN": 16.480813, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 173, "latS": 16.476676, "latN": 16.480813, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 174, "latS": 16.476676, "latN": 16.480813, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 175, "latS": 16.476676, "latN": 16.480813, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 176, "latS": 16.47254, "latN": 16.476676, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 177, "latS": 16.47254, "latN": 16.476676, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 178, "latS": 16.47254, "latN": 16.476676, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 179, "latS": 16.47254, "latN": 16.476676, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 180, "latS": 16.47254, "latN": 16.476676, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 181, "latS": 16.47254, "latN": 16.476676, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 182, "latS": 16.47254, "latN": 16.476676, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 183, "latS": 16.47254, "latN": 16.476676, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 184, "latS": 16.47254, "latN": 16.476676, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 185, "latS": 16.47254, "latN": 16.476676, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 186, "latS": 16.47254, "latN": 16.476676, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 187, "latS": 16.47254, "latN": 16.476676, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 188, "latS": 16.47254, "latN": 16.476676, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 189, "latS": 16.47254, "latN": 16.476676, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 190, "latS": 16.47254, "latN": 16.476676, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 191, "latS": 16.47254, "latN": 16.476676, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 192, "latS": 16.468403, "latN": 16.47254, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 193, "latS": 16.468403, "latN": 16.47254, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 194, "latS": 16.468403, "latN": 16.47254, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 195, "latS": 16.468403, "latN": 16.47254, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 196, "latS": 16.468403, "latN": 16.47254, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 197, "latS": 16.468403, "latN": 16.47254, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 198, "latS": 16.468403, "latN": 16.47254, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 199, "latS": 16.468403, "latN": 16.47254, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 200, "latS": 16.468403, "latN": 16.47254, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 201, "latS": 16.468403, "latN": 16.47254, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 202, "latS": 16.468403, "latN": 16.47254, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 203, "latS": 16.468403, "latN": 16.47254, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 204, "latS": 16.468403, "latN": 16.47254, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 205, "latS": 16.468403, "latN": 16.47254, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 206, "latS": 16.468403, "latN": 16.47254, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 207, "latS": 16.468403, "latN": 16.47254, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 208, "latS": 16.464267, "latN": 16.468403, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 209, "latS": 16.464267, "latN": 16.468403, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 210, "latS": 16.464267, "latN": 16.468403, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 211, "latS": 16.464267, "latN": 16.468403, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 212, "latS": 16.464267, "latN": 16.468403, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 213, "latS": 16.464267, "latN": 16.468403, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 214, "latS": 16.464267, "latN": 16.468403, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 215, "latS": 16.464267, "latN": 16.468403, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 216, "latS": 16.464267, "latN": 16.468403, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 217, "latS": 16.464267, "latN": 16.468403, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 218, "latS": 16.464267, "latN": 16.468403, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 219, "latS": 16.464267, "latN": 16.468403, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 220, "latS": 16.464267, "latN": 16.468403, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 221, "latS": 16.464267, "latN": 16.468403, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 222, "latS": 16.464267, "latN": 16.468403, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 223, "latS": 16.464267, "latN": 16.468403, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 224, "latS": 16.46013, "latN": 16.464267, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 225, "latS": 16.46013, "latN": 16.464267, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 226, "latS": 16.46013, "latN": 16.464267, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 227, "latS": 16.46013, "latN": 16.464267, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 228, "latS": 16.46013, "latN": 16.464267, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 229, "latS": 16.46013, "latN": 16.464267, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 230, "latS": 16.46013, "latN": 16.464267, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 231, "latS": 16.46013, "latN": 16.464267, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 232, "latS": 16.46013, "latN": 16.464267, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 233, "latS": 16.46013, "latN": 16.464267, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 234, "latS": 16.46013, "latN": 16.464267, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 235, "latS": 16.46013, "latN": 16.464267, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 236, "latS": 16.46013, "latN": 16.464267, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 237, "latS": 16.46013, "latN": 16.464267, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 238, "latS": 16.46013, "latN": 16.464267, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 239, "latS": 16.46013, "latN": 16.464267, "lngW": 120.696487, "lngE": 120.700493},
    {"idx": 240, "latS": 16.455994, "latN": 16.46013, "lngW": 120.636396, "lngE": 120.640402},
    {"idx": 241, "latS": 16.455994, "latN": 16.46013, "lngW": 120.640402, "lngE": 120.644408},
    {"idx": 242, "latS": 16.455994, "latN": 16.46013, "lngW": 120.644408, "lngE": 120.648414},
    {"idx": 243, "latS": 16.455994, "latN": 16.46013, "lngW": 120.648414, "lngE": 120.65242},
    {"idx": 244, "latS": 16.455994, "latN": 16.46013, "lngW": 120.65242, "lngE": 120.656426},
    {"idx": 245, "latS": 16.455994, "latN": 16.46013, "lngW": 120.656426, "lngE": 120.660432},
    {"idx": 246, "latS": 16.455994, "latN": 16.46013, "lngW": 120.660432, "lngE": 120.664438},
    {"idx": 247, "latS": 16.455994, "latN": 16.46013, "lngW": 120.664438, "lngE": 120.668444},
    {"idx": 248, "latS": 16.455994, "latN": 16.46013, "lngW": 120.668444, "lngE": 120.672451},
    {"idx": 249, "latS": 16.455994, "latN": 16.46013, "lngW": 120.672451, "lngE": 120.676457},
    {"idx": 250, "latS": 16.455994, "latN": 16.46013, "lngW": 120.676457, "lngE": 120.680463},
    {"idx": 251, "latS": 16.455994, "latN": 16.46013, "lngW": 120.680463, "lngE": 120.684469},
    {"idx": 252, "latS": 16.455994, "latN": 16.46013, "lngW": 120.684469, "lngE": 120.688475},
    {"idx": 253, "latS": 16.455994, "latN": 16.46013, "lngW": 120.688475, "lngE": 120.692481},
    {"idx": 254, "latS": 16.455994, "latN": 16.46013, "lngW": 120.692481, "lngE": 120.696487},
    {"idx": 255, "latS": 16.455994, "latN": 16.46013, "lngW": 120.696487, "lngE": 120.700493}
]

AMBASSADOR_GRID_BOUNDS = {
    "latS": min(p["latS"] for p in PLOTS),
    "latN": max(p["latN"] for p in PLOTS),
    "lngW": min(p["lngW"] for p in PLOTS),
    "lngE": max(p["lngE"] for p in PLOTS),
}
AMBASSADOR_GRID_ROWS = 16
AMBASSADOR_GRID_COLS = 16
GEOMETRY_EPSILON = 1e-12


def lat_lng_to_pixel(src, lat, lng):
    """Convert WGS84 lat/lng to pixel row/col in the source raster."""
    col, row = ~src.transform * (lng, lat)
    return int(row), int(col)


def lat_lng_to_float_pixel(src, lat, lng):
    """Convert WGS84 lat/lng to fractional pixel row/col in the source raster."""
    col, row = ~src.transform * (lng, lat)
    return row, col


def crop_band(src, row0, col0, row1, col1):
    """Read a window from source, return numpy array (bands, h, w)."""
    h = row1 - row0
    w = col1 - col0
    window = Window(col0, row0, w, h)
    return src.read(window=window)


RGB_BANDS = [1, 2, 3]


def arr_to_pil(arr):
    """Convert (bands, h, w) uint8 array to PIL RGB Image."""
    rgb = np.stack([arr[0], arr[1], arr[2]], axis=2)
    return Image.fromarray(rgb.astype(np.uint8))


def read_xyz_tile(src, lat_n, lat_s, lng_w, lng_e):
    """Read a full XYZ tile extent and pad areas outside the source raster."""
    r0, c0 = lat_lng_to_float_pixel(src, lat_n, lng_w)
    r1, c1 = lat_lng_to_float_pixel(src, lat_s, lng_e)
    row0, row1 = min(r0, r1), max(r0, r1)
    col0, col1 = min(c0, c1), max(c0, c1)
    window = Window(col0, row0, col1 - col0, row1 - row0)
    arr = src.read(
        RGB_BANDS,
        window=window,
        out_shape=(3, MAP_TILE_PX, MAP_TILE_PX),
        boundless=True,
        fill_value=0,
        resampling=Resampling.bilinear,
    )
    outside_source = np.all(arr == 0, axis=0)
    if outside_source.any():
        for band, value in enumerate(OUTSIDE_TILE_FILL):
            arr[band, outside_source] = value
    return arr


def deg2tile(lat, lng, zoom):
    """Return (x, y) tile coordinates for a lat/lng at given zoom."""
    n = 2**zoom
    x = int((lng + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def tile_bounds(x, y, zoom):
    """Return (lat_N, lat_S, lng_W, lng_E) for an XYZ tile."""
    n = 2**zoom
    lng_w = x / n * 360 - 180
    lng_e = (x + 1) / n * 360 - 180

    def merc_to_lat(merc_y):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * merc_y / n))))

    lat_n = merc_to_lat(y)
    lat_s = merc_to_lat(y + 1)
    return lat_n, lat_s, lng_w, lng_e


def point_in_polygon(lat, lng, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_rect(lat, lng, rect):
    return rect["latS"] <= lat <= rect["latN"] and rect["lngW"] <= lng <= rect["lngE"]


def plot_overlaps_rect(plot, rect):
    return (
        plot["latS"] < rect["latN"] - GEOMETRY_EPSILON
        and plot["latN"] > rect["latS"] + GEOMETRY_EPSILON
        and plot["lngW"] < rect["lngE"] - GEOMETRY_EPSILON
        and plot["lngE"] > rect["lngW"] + GEOMETRY_EPSILON
    )


def orientation(a, b, c):
    value = (b["lng"] - a["lng"]) * (c["lat"] - b["lat"]) - (b["lat"] - a["lat"]) * (c["lng"] - b["lng"])
    if abs(value) < 1e-12:
        return 0
    return 1 if value > 0 else 2


def on_segment(a, b, c):
    return (
        b["lng"] <= max(a["lng"], c["lng"]) + 1e-12
        and b["lng"] >= min(a["lng"], c["lng"]) - 1e-12
        and b["lat"] <= max(a["lat"], c["lat"]) + 1e-12
        and b["lat"] >= min(a["lat"], c["lat"]) - 1e-12
    )


def segments_intersect(a, b, c, d):
    o1 = orientation(a, b, c)
    o2 = orientation(a, b, d)
    o3 = orientation(c, d, a)
    o4 = orientation(c, d, b)
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and on_segment(a, c, b):
        return True
    if o2 == 0 and on_segment(a, d, b):
        return True
    if o3 == 0 and on_segment(c, a, d):
        return True
    if o4 == 0 and on_segment(c, b, d):
        return True
    return False


def plot_corners(plot):
    return [
        {"lat": plot["latN"], "lng": plot["lngW"]},
        {"lat": plot["latN"], "lng": plot["lngE"]},
        {"lat": plot["latS"], "lng": plot["lngE"]},
        {"lat": plot["latS"], "lng": plot["lngW"]},
    ]


def plot_overlaps_polygon(plot, poly):
    corners = plot_corners(plot)
    if any(point_in_polygon(pt["lat"], pt["lng"], poly) for pt in corners):
        return True
    if any(point_in_rect(lat, lng, plot) for lat, lng in poly):
        return True

    for i, a in enumerate(corners):
        b = corners[(i + 1) % len(corners)]
        for j in range(len(poly)):
            c = {"lat": poly[j][0], "lng": poly[j][1]}
            d = {"lat": poly[(j + 1) % len(poly)][0], "lng": poly[(j + 1) % len(poly)][1]}
            if segments_intersect(a, b, c, d):
                return True
    return False


def build_outside_plots():
    plot_lat = (AMBASSADOR_GRID_BOUNDS["latN"] - AMBASSADOR_GRID_BOUNDS["latS"]) / AMBASSADOR_GRID_ROWS
    plot_lng = (AMBASSADOR_GRID_BOUNDS["lngE"] - AMBASSADOR_GRID_BOUNDS["lngW"]) / AMBASSADOR_GRID_COLS
    row_start = math.ceil((AMBASSADOR_GRID_BOUNDS["latN"] - TUBLAY_BBOX_N) / plot_lat)
    row_end = math.floor((AMBASSADOR_GRID_BOUNDS["latN"] - TUBLAY_BBOX_S) / plot_lat)
    col_start = math.ceil((TUBLAY_BBOX_W - AMBASSADOR_GRID_BOUNDS["lngW"]) / plot_lng)
    col_end = math.floor((TUBLAY_BBOX_E - AMBASSADOR_GRID_BOUNDS["lngW"]) / plot_lng)
    plots = []
    for r in range(row_start, row_end):
        lat_n = AMBASSADOR_GRID_BOUNDS["latN"] - r * plot_lat
        lat_s = lat_n - plot_lat
        for c in range(col_start, col_end):
            lng_w = AMBASSADOR_GRID_BOUNDS["lngW"] + c * plot_lng
            lng_e = lng_w + plot_lng
            center_lat = (lat_n + lat_s) / 2
            center_lng = (lng_w + lng_e) / 2
            candidate = {
                "latS": lat_s,
                "latN": lat_n,
                "lngW": lng_w,
                "lngE": lng_e,
                "centerLat": center_lat,
                "centerLng": center_lng,
            }
            if plot_overlaps_rect(candidate, AMBASSADOR_GRID_BOUNDS):
                continue
            if plot_overlaps_polygon(candidate, AMBASSADOR_POLY):
                continue
            outside_seq = len(plots)
            plots.append({
                **candidate,
                "idx": len(PLOTS) + outside_seq,
                "outsideSeq": outside_seq,
            })
    return plots


def generate_plot_crops(src):
    # Tiles are sampled directly from the EPSG:4326 source raster by converting
    # lat/lng bounds to pixel coordinates. At latitude ~16.5 and zoom 12-16,
    # the distortion is small enough for this field app.
    PLOT_OUT_DIR.mkdir(parents=True, exist_ok=True)
    plot_jobs = [(p, "plot_", p["idx"]) for p in PLOTS]
    plot_jobs += [(p, OUTSIDE_PLOT_PREFIX, p["outsideSeq"]) for p in build_outside_plots()]
    for p, prefix, file_idx in plot_jobs:
        row0, col0 = lat_lng_to_pixel(src, p["latN"], p["lngW"])
        row1, col1 = lat_lng_to_pixel(src, p["latS"], p["lngE"])
        row0, row1 = max(0, min(row0, row1)), min(src.height, max(row0, row1))
        col0, col1 = max(0, min(col0, col1)), min(src.width, max(col0, col1))
        if row1 - row0 < 2 or col1 - col0 < 2:
            print(f"  WARNING: {prefix}{file_idx:03d} has insufficient coverage in TIF - skipping")
            continue
        arr = crop_band(src, row0, col0, row1, col1)
        img = arr_to_pil(arr).resize((PLOT_SIZE, PLOT_SIZE), Image.LANCZOS)
        out = PLOT_OUT_DIR / f"{prefix}{file_idx:03d}.jpg"
        img.save(out, "JPEG", quality=JPEG_QUALITY)
        print(f"  {prefix}{file_idx:03d}.jpg  {img.size}")
    print(f"Done: {len(plot_jobs)} plot images -> {PLOT_OUT_DIR}/")


def generate_map_tiles(src, out_dir, min_zoom, max_zoom, bounds, quality, label):
    out_dir.mkdir(parents=True, exist_ok=True)

    empty = Image.new("RGB", (MAP_TILE_PX, MAP_TILE_PX), color=OUTSIDE_TILE_FILL)
    empty.save(out_dir / "empty.jpg", "JPEG", quality=60)

    lat_n, lat_s, lng_e, lng_w = bounds
    total = 0
    for zoom in range(min_zoom, max_zoom + 1):
        x0, y0 = deg2tile(lat_n, lng_w, zoom)
        x1, y1 = deg2tile(lat_s, lng_e, zoom)
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        count = (x1 - x0 + 1) * (y1 - y0 + 1)
        print(f"{label} zoom {zoom}: x {x0}-{x1}, y {y0}-{y1}  ({count} tiles)")
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                out_path = out_dir / str(zoom) / str(tx) / f"{ty}.jpg"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e = tile_bounds(tx, ty, zoom)
                arr = read_xyz_tile(src, tile_lat_n, tile_lat_s, tile_lng_w, tile_lng_e)
                img = arr_to_pil(arr)
                img.save(out_path, "JPEG", quality=quality)
                total += 1
    print(f"Done: {total} {label} tiles -> {out_dir}/")


def generate_detail_map_tiles(src):
    generate_map_tiles(
        src,
        DETAIL_MAP_OUT_DIR,
        DETAIL_MIN_ZOOM,
        DETAIL_MAX_ZOOM,
        (TILE_BBOX_N, TILE_BBOX_S, TILE_BBOX_E, TILE_BBOX_W),
        DETAIL_TILE_QUALITY,
        "detail",
    )


def generate_context_map_tiles(src):
    generate_map_tiles(
        src,
        CONTEXT_MAP_OUT_DIR,
        CONTEXT_MIN_ZOOM,
        CONTEXT_MAX_ZOOM,
        (CONTEXT_BBOX_N, CONTEXT_BBOX_S, CONTEXT_BBOX_E, CONTEXT_BBOX_W),
        CONTEXT_TILE_QUALITY,
        "context",
    )


if __name__ == "__main__":
    print(f"Opening detail source {DETAIL_SOURCE_TIF}...")
    with rasterio.open(DETAIL_SOURCE_TIF) as detail_src:
        print(f"  {detail_src.width}x{detail_src.height} px, {detail_src.count} bands, CRS={detail_src.crs}")
        print("\n-- Generating plot crops --")
        generate_plot_crops(detail_src)
        print("\n-- Generating detail map tiles --")
        generate_detail_map_tiles(detail_src)

    print(f"\nOpening context source {CONTEXT_SOURCE_TIF}...")
    with rasterio.open(CONTEXT_SOURCE_TIF) as context_src:
        print(f"  {context_src.width}x{context_src.height} px, {context_src.count} bands, CRS={context_src.crs}")
        print("\n-- Generating context map tiles --")
        generate_context_map_tiles(context_src)

    print("\nAll done. Commit the tiles/ directory.")
