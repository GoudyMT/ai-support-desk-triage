"""Writes the token numbers and answers the bundle gives for a list of hard texts.

The browser splits text into tokens with its own code (`web/src/model/wordPiece.ts`)
and scores with its own runtime (`web/src/model/sentenceScorer.ts`). Their tests
compare both with these numbers, made by the same `tokenizers` and `onnxruntime`
the model was trained and scored with.

Non-ASCII characters are built from code points, so this file stays ASCII.
"""

import argparse
import json
from pathlib import Path

from triage_v2.score_onnx import bundle_fingerprint, load_tokenizer, score

LONG_WORD_CHARS = 101
LONG_TICKET_REPEATS = 120


def cases():
    """Returns (name, text) pairs, each reaching a different rule of the tokenizer."""
    return [
        ("plain", "My invoice was charged twice this month."),
        ("upper and digits", "ORDER ORD-482913 arrived on March 3, 2026 at 10:45AM"),
        ("mask tokens", "Reach me at [EMAIL_ADDRESS] or [PHONE_NUMBER]; order [ORDER_NUMBER], card [CARD_NUMBER]."),
        ("special tokens typed", "Please [MASK] this [CLS] and [SEP] and [PAD] and [UNK] now"),
        ("lower special words", "the [mask] and [cls] stay as text"),
        ("accents", "caf" + chr(0xE9) + " na" + chr(0xEF) + "ve r" + chr(0xE9) + "sum" + chr(0xE9) + " " + chr(0xC5) + "ngstr" + chr(0xF6) + "m"),
        ("combining mark", "cafe" + chr(0x301) + " ok"),
        ("chinese", chr(0x8BA2) + chr(0x5355) + "issue " + chr(0x95EE) + chr(0x9898)),
        ("control and spaces", "tab\there" + chr(0) + "null" + chr(0xFFFD) + "bad" + chr(0x200B) + "zw\r\nnext" + chr(0xA0) + "nbsp"),
        ("emoji", "help " + chr(0x1F600) + " now " + chr(0x1F44D) + chr(0x1F3FD)),
        ("punctuation", "$12.50!!! (refund?) - it's \"broken\"... #42 @team ~/path a_b"),
        ("unknown pieces", "zzqxj flibbertigibbet antidisestablishmentarianism"),
        ("long word", "x" * LONG_WORD_CHARS + " end"),
        ("empty", ""),
        ("only spaces", "   \n\t "),
        ("long ticket", " ".join(["The export page times out after the latest update."] * LONG_TICKET_REPEATS)),
    ]


def main():
    """Writes the cases and their token numbers as JSON."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--bundle", required=True, help="the model folder")
    parser.add_argument("--out", required=True, help="where to write the cases (web/src/model/bundle.cases.json)")
    args = parser.parse_args()
    tokenizer = load_tokenizer(args.bundle)
    tokenizer.no_padding()
    fingerprint = bundle_fingerprint(args.bundle)
    written = []
    for name, text in cases():
        # One ticket at a time, as the desk scores: the 8-bit model's rounding
        # depends on the other tickets in a batch.
        (answer,) = score(args.bundle, [{"id": name, "maskedText": text}], fingerprint, threads=1)
        written.append({
            "name": name,
            "text": text,
            "ids": tokenizer.encode(text).ids,
            "category": answer["category"],
            "categoryProbability": answer["category_probs"][answer["category"]],
            "priority": answer["priority"],
            "priorityProbability": answer["priority_probs"][answer["priority"]],
        })
    Path(args.out).write_text(json.dumps(written, ensure_ascii=True, indent=1) + "\n", encoding="utf-8")
    print(f"    Cases: {len(written)} -> {args.out}")


if __name__ == "__main__":
    main()
