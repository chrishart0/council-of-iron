"""Optional local research server. Vendor/checkpoint live only under ignored data/."""
import os
import torch
import uvicorn
from jeff import models

original_load = models.load_decision_model

def load_cpu(**kwargs):
    model = original_load(**kwargs, cpu_threads=int(os.environ.get("JEFF_CPU_THREADS", "2")))
    return model.to(dtype=torch.bfloat16) if os.environ.get("JEFF_CPU_BF16") == "1" else model

models.load_decision_model = load_cpu
from jeff.server import app
uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "18765")))
