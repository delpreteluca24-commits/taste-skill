"""Frame sampling + detectors: MediaPipe faces, mouth activity, OpenCV optical-flow motion."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

log = logging.getLogger(__name__)
os.environ.setdefault("GLOG_minloglevel", "2")  # silence MediaPipe/TFLite C++ logs
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


class DetectError(RuntimeError):
    pass


@dataclass
class Face:
    x: float  # box in analysis-frame pixels
    y: float
    w: float
    h: float
    score: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


def _cv2():
    try:
        import cv2
    except ImportError as e:
        raise DetectError("opencv is not installed: pip install opencv-python-headless") from e
    return cv2


def sample_frames(path: Path, start: float, end: float, fps: float, width: int,
                  pairs: bool = False) -> Iterator[tuple[float, object, Optional[object]]]:
    """Yield (t_rel, frame, next_frame|None) at `fps`, frames resized to `width`. Sequential decode (no seeks)."""
    cv2 = _cv2()
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise DetectError(f"OpenCV cannot open {path}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, start) * 1000)
    step = 1.0 / fps
    next_t = 0.0
    frame_dt = 1.0 / src_fps
    t_rel = None

    def resize(img):
        h, w = img.shape[:2]
        return img if w <= width else cv2.resize(img, (width, int(h * width / w)), interpolation=cv2.INTER_AREA)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            pos = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            t_rel = pos - start if pos > 0 else (t_rel + frame_dt if t_rel is not None else 0.0)
            if t_rel < -frame_dt / 2:
                continue
            if t_rel > end - start:
                break
            if t_rel + frame_dt / 2 >= next_t:
                nxt = None
                if pairs:
                    ok2, f2 = cap.read()
                    nxt = resize(f2) if ok2 else None
                yield max(0.0, t_rel), resize(frame), nxt
                next_t += step
    finally:
        cap.release()


class FaceDetector:
    """MediaPipe Tasks face detector. The ~250 KB model is downloaded once into the cache."""

    def __init__(self, cache_dir: Path, model_url: str, min_conf: float = 0.5):
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions, vision
        except ImportError as e:
            raise DetectError("mediapipe is not installed: pip install mediapipe") from e
        except OSError as e:  # e.g. headless Linux without libEGL/libGLES
            raise DetectError(f"mediapipe cannot load native libs ({e}); on Linux: apt install libegl1 libgles2") from e
        model = Path(cache_dir) / "models" / Path(model_url).name
        if not model.exists():
            self._download(model_url, model)
        opts = vision.FaceDetectorOptions(base_options=BaseOptions(model_asset_path=str(model)),
                                          min_detection_confidence=min_conf)
        self._mp = mp
        try:
            self._det = vision.FaceDetector.create_from_options(opts)
        except (OSError, RuntimeError) as e:
            raise DetectError(f"MediaPipe face detector failed to start: {e}") from e

    @staticmethod
    def _download(url: str, dest: Path) -> None:
        import httpx

        log.info("Downloading face model %s", url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            r = httpx.get(url, timeout=60, follow_redirects=True)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise DetectError(f"Cannot download face model ({e}). Use --mode center or retry online.") from e
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(r.content)
        tmp.replace(dest)

    def _run(self, rgb, ox: int = 0) -> list[Face]:
        img = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        out = []
        for d in self._det.detect(img).detections:
            b = d.bounding_box
            out.append(Face(b.origin_x + ox, b.origin_y, b.width, b.height, d.categories[0].score))
        return out

    def detect(self, frame_bgr) -> list[Face]:
        """Full frame + left/right square tiles: the short-range model misses small faces in wide shots."""
        cv2 = _cv2()
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        faces = self._run(rgb)
        if w > h * 1.2:
            side = min(h, w)
            for ox in (0, w - side):
                faces += self._run(rgb[:, ox : ox + side].copy(), ox)
        return nms(faces)

    def close(self) -> None:
        self._det.close()


def iou(a: Face, b: Face) -> float:
    x1, y1 = max(a.x, b.x), max(a.y, b.y)
    x2, y2 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0


def nms(faces: list[Face], thr: float = 0.3) -> list[Face]:
    kept: list[Face] = []
    for f in sorted(faces, key=lambda f: -f.score):
        if all(iou(f, k) < thr for k in kept):
            kept.append(f)
    return kept


def mouth_activity(cur, nxt, face: Face) -> float:
    """Pixel change in the mouth region minus change in the eyes region (cancels head motion)."""
    if nxt is None:
        return 0.0
    cv2 = _cv2()
    import numpy as np

    H, W = cur.shape[:2]

    def roi(img, y0: float, y1: float):
        x0, x1 = int(max(0, face.x + face.w * 0.2)), int(min(W, face.x + face.w * 0.8))
        ya, yb = int(max(0, face.y + face.h * y0)), int(min(H, face.y + face.h * y1))
        if x1 - x0 < 2 or yb - ya < 2:
            return None
        return cv2.cvtColor(img[ya:yb, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)

    m0, m1 = roi(cur, 0.65, 1.0), roi(nxt, 0.65, 1.0)
    e0, e1 = roi(cur, 0.2, 0.45), roi(nxt, 0.2, 0.45)
    if m0 is None or m1 is None:
        return 0.0
    mouth = float(np.mean(np.abs(m1 - m0)))
    eyes = float(np.mean(np.abs(e1 - e0))) if e0 is not None and e1 is not None else 0.0
    return max(0.0, mouth - eyes)


def motion_center(prev_bgr, cur_bgr, min_energy: float = 0.4) -> Optional[float]:
    """x of the motion-energy centroid (camera pan removed), in analysis-frame pixels; None if static."""
    if prev_bgr is None:
        return None
    cv2 = _cv2()
    import numpy as np

    a = cv2.cvtColor(prev_bgr, cv2.COLOR_BGR2GRAY)
    b = cv2.cvtColor(cur_bgr, cv2.COLOR_BGR2GRAY)
    flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    flow -= np.median(flow.reshape(-1, 2), axis=0)  # remove global camera motion
    mag = np.linalg.norm(flow, axis=2)
    mag[mag < max(min_energy, float(np.percentile(mag, 90)))] = 0
    total = float(mag.sum())
    if total < 1e-3:
        return None
    cols = mag.sum(axis=0)
    return float((cols * np.arange(mag.shape[1])).sum() / total)
