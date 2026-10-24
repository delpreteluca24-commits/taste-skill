import pytest

from clipforge.ffmpeg import escape_filter_path, parse_ffmpeg_banner
from clipforge.reframe import center_crop, crop_window


def test_landscape_1080p():
    c = center_crop(1920, 1080)
    assert (c.w, c.h, c.y) == (606, 1080, 0)
    assert c.x == 656
    assert c.x % 2 == 0 and c.x + c.w <= 1920


def test_4k():
    c = center_crop(3840, 2160)
    assert c.h == 2160 and c.w == 1214 and c.x + c.w <= 3840


def test_already_vertical():
    c = center_crop(1080, 1920)
    assert (c.w, c.h, c.x, c.y) == (1080, 1920, 0, 0)


def test_square_crops_width():
    c = center_crop(1080, 1080)
    assert c.h == 1080 and c.w == 606


def test_tall_source_crops_height():
    c = center_crop(1000, 2400)
    assert c.w == 1000 and c.h == 1776 and c.y % 2 == 0 and c.y + c.h <= 2400


@pytest.mark.parametrize("cx,expected_x", [(0, 0), (1920, 1314), (500, 196)])
def test_crop_clamped_to_frame(cx, expected_x):
    assert crop_window(1920, 1080, cx=cx).x == expected_x


def test_filter_string():
    assert center_crop(1920, 1080).filter(1080, 1920) == \
        "crop=606:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1"


def test_escape_filter_path_windows():
    assert escape_filter_path(r"C:\Users\me\fonts") == r"'C\:/Users/me/fonts'"


def test_parse_banner():
    txt = ("Input #0, mov\n  Duration: 01:02:03.50, start: 0\n"
           "  Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps\n  Stream #0:1: Audio: aac, 48000 Hz")
    p = parse_ffmpeg_banner(txt)
    assert p.duration == pytest.approx(3723.5) and (p.width, p.height) == (1920, 1080) and p.has_audio
