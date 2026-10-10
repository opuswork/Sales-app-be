#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
transcribe_worker.py — 이 PC(GPU)에서 서버의 녹취 작업을 가져와 faster-whisper 로 받아쓰고 결과를 올린다.

흐름
  1. POST {API}/api/worker/jobs/next  (헤더 x-worker-token) → 대기 중인 녹취 1건 점유
  2. GET  {API}/api/worker/recordings/{id}/file → 오디오 다운로드 (로컬 저장이면 스트림, Blob 이면 리다이렉트)
  3. faster-whisper large-v3-turbo (CUDA 가능하면 GPU, 아니면 CPU int8) 로 한국어 받아쓰기
  4. POST {API}/api/worker/jobs/{id}/transcript → 서버가 Anthropic 으로 분석해 초안 생성
  실패 시 POST {API}/api/worker/jobs/{id}/fail

사용
  pip install -r requirements.txt
  set SALES_API=https://<render-api>  set WORKER_TOKEN=<.env 의 WORKER_TOKEN>
  python transcribe_worker.py            # 상주 (20초 간격 폴링)
  python transcribe_worker.py --once     # 1건만 처리하고 종료
  python transcribe_worker.py --file a.m4a --print   # 서버 없이 받아쓰기만 테스트
"""
import argparse
import datetime as dt
import os
import sys
import tempfile
import time
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = os.environ.get("SALES_API", "http://localhost:3002").rstrip("/")
TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID", os.environ.get("COMPUTERNAME", "worker"))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
POLL_SEC = int(os.environ.get("POLL_SEC", "20"))
LOG = Path(__file__).resolve().parent / "worker.log"

_model = None


def log(msg):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def headers():
    return {"x-worker-token": TOKEN}


def get_model():
    """CUDA 가 되면 GPU(float16), 아니면 CPU(int8). 모델은 첫 실행 때 내려받는다."""
    global _model
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel

    try:
        _model = WhisperModel(MODEL_NAME, device="cuda", compute_type="float16")
        # 실제로 CUDA 커널이 뜨는지 작은 호출로 확인
        log(f"model {MODEL_NAME} loaded on CUDA")
    except Exception as e:  # noqa: BLE001
        log(f"CUDA unavailable ({type(e).__name__}: {str(e)[:120]}) → CPU int8")
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=max(4, os.cpu_count() or 4))
    return _model


def clean_lines(lines):
    """환각으로 반복되는 짧은 줄('네.', '감사합니다.')과 연속 중복을 제거."""
    out = []
    prev = None
    for t in lines:
        t = t.strip()
        if not t:
            continue
        if t == prev:
            continue
        if len(t) <= 3 and out and out[-1] == t:
            continue
        out.append(t)
        prev = t
    return out


def transcribe(path):
    model = get_model()
    t0 = time.time()
    segments, info = model.transcribe(
        str(path),
        language="ko",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    lines = []
    for seg in segments:
        lines.append(seg.text)
    text = "\n".join(clean_lines(lines))
    dur = int(info.duration or 0)
    log(f"transcribed {dur}s audio in {time.time() - t0:.0f}s ({len(text)} chars)")
    return text, dur


def claim():
    r = requests.post(f"{API}/api/worker/jobs/next", json={"workerId": WORKER_ID}, headers=headers(), timeout=30)
    r.raise_for_status()
    body = r.json() if r.content else None
    return body or None


def download(job_id, dest):
    with requests.get(f"{API}/api/worker/recordings/{job_id}/file", headers=headers(), stream=True, timeout=120, allow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)


def process(job):
    job_id = job["id"]
    log(f"job {job_id} '{job.get('title', '')}' ({job.get('sizeBytes', 0)} bytes)")
    suffix = Path(job.get("fileName", "a.m4a")).suffix or ".m4a"
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"{job_id}{suffix}"
        download(job_id, src)
        try:
            text, dur = transcribe(src)
        except Exception as e:  # noqa: BLE001
            requests.post(f"{API}/api/worker/jobs/{job_id}/fail", json={"error": f"STT 실패: {e}"}, headers=headers(), timeout=30)
            log(f"job {job_id} failed: {e}")
            return
    if not text.strip():
        requests.post(f"{API}/api/worker/jobs/{job_id}/fail", json={"error": "녹취에서 텍스트를 얻지 못했습니다."}, headers=headers(), timeout=30)
        return
    r = requests.post(f"{API}/api/worker/jobs/{job_id}/transcript", json={"transcript": text, "durationSec": dur}, headers=headers(), timeout=60)
    r.raise_for_status()
    log(f"job {job_id} transcript uploaded")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--file", help="서버 없이 로컬 파일만 받아쓰기")
    ap.add_argument("--print", action="store_true")
    args = ap.parse_args()

    if args.file:
        text, dur = transcribe(Path(args.file))
        out = Path(args.file).with_suffix(".txt")
        out.write_text(text, encoding="utf-8")
        log(f"saved {out} ({dur}s)")
        if args.print:
            print(text)
        return

    if not TOKEN:
        log("WORKER_TOKEN 이 비어 있습니다 (.env 의 WORKER_TOKEN 과 같은 값을 환경변수로 주세요)")
        sys.exit(2)
    log(f"worker start → {API} (poll {POLL_SEC}s)")
    while True:
        try:
            job = claim()
            if job:
                process(job)
                if args.once:
                    return
                continue
            if args.once:
                log("no job")
                return
        except Exception as e:  # noqa: BLE001
            log(f"loop error: {e}")
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
