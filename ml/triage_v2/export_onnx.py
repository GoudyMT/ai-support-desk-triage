"""Writing a trained model as the frozen bundle the scorer and the browser load.

Needs the training environment. The bundle's sentence model is stored with 8-bit weights:
a quarter of the size, and the model every published number is measured on.
"""

import json
import shutil
import tempfile
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from optimum.onnxruntime import ORTModelForFeatureExtraction

from triage_v2.score_onnx import bundle_fingerprint


def export(model, out_dir):
    """
    Writes the bundle for a trained model.

    Args:
        model: A TrainedModel from train_sentence.fit.
        out_dir: The folder to write; created if missing.

    Returns:
        The token limit under `max_length` and the bundle fingerprint under
        `fingerprint`.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        saved, full = Path(work) / "saved", Path(work) / "full"
        model.encoder.save(str(saved))
        ORTModelForFeatureExtraction.from_pretrained(str(saved), export=True).save_pretrained(str(full))
        quantize_dynamic(str(full / "model.onnx"), str(out_dir / "model_quantized.onnx"), weight_type=QuantType.QUInt8)
        shutil.copyfile(saved / "tokenizer.json", out_dir / "tokenizer.json")

    heads = {}
    for field in model.heads:
        layer = model.heads[field]
        heads[field] = {
            "classes": model.classes[field],
            "weight": layer.weight.detach().cpu().tolist(),
            "bias": layer.bias.detach().cpu().tolist(),
        }
    (out_dir / "heads.json").write_text(json.dumps(heads) + "\n", encoding="utf-8", newline="\n")

    manifest = {"max_length": model.max_length}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n")
    return {**manifest, "fingerprint": bundle_fingerprint(out_dir)}
