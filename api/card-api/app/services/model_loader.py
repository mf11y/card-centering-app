from ultralytics import YOLO

MODEL_PATH = "/app/models/best.pt"

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLO(MODEL_PATH)
    return _model