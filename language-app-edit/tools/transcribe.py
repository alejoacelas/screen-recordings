"""Transcribe media/audio.wav with word timestamps into data/words.json."""
import json, sys
import mlx_whisper

out = mlx_whisper.transcribe(
    sys.argv[1], path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
    word_timestamps=True, language="en", condition_on_previous_text=False)
words = [{"w": w["word"], "s": round(w["start"], 2), "e": round(w["end"], 2)}
         for seg in out["segments"] for w in seg.get("words", [])]
json.dump({"segments": [{"s": s["start"], "e": s["end"], "t": s["text"]} for s in out["segments"]],
           "words": words}, open(sys.argv[2], "w"), ensure_ascii=False)
print(len(words), "words")
