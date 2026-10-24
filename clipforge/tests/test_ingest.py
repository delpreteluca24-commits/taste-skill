from clipforge.ingest import build_format, is_url, slugify


def test_is_url():
    assert is_url("https://youtu.be/x") and is_url("HTTP://kick.com/v") and not is_url("./video.mp4")


def test_slugify():
    assert slugify("Il mio Video: parte #2!") == "il-mio-video-parte-2"
    assert slugify("???") == "video"


def test_format_picks_language_track():
    fmts = [{"acodec": "opus", "language": "en"}, {"acodec": "opus", "language": "it-IT"}, {"acodec": "none"}]
    assert build_format(fmts, "it", 1080).startswith("bv*[height<=1080]+ba[language^=it]")


def test_format_without_language_match():
    fmts = [{"acodec": "opus", "language": "en"}]
    assert build_format(fmts, "it", 720) == "bv*[height<=720]+ba/b[height<=720]/b"
    assert build_format([], None, 1080) == "bv*[height<=1080]+ba/b[height<=1080]/b"
