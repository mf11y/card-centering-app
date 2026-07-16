import os

import torch
from ultralytics import YOLO

MODEL_PATH = "/app/models/best.pt"

# Four API workers with two inference threads each use the eight available CPU
# cores without letting every model process claim the entire machine.
torch.set_num_threads(int(os.getenv("TORCH_NUM_THREADS", "2")))
torch.set_num_interop_threads(int(os.getenv("TORCH_INTEROP_THREADS", "1")))

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLO(MODEL_PATH)
    return _model
