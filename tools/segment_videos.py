#!/usr/bin/env python3
import argparse
import subprocess
import sys
import shutil
import tempfile
import os
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np

ALLOWED_EXTS = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}


def require_ffmpeg() -> None:
    if shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None:
        print('ERROR: ffmpeg/ffprobe not found in PATH. Please install ffmpeg.', file=sys.stderr)
        sys.exit(1)


def ffprobe_duration(input_path: str) -> float:
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input_path
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def run_ffmpeg(cmd: list) -> None:
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed with code {proc.returncode}")


def trim_file(input_file: Path, output_file: Path, trim_head: float, trim_tail: float, reencode: bool) -> bool:
    duration = ffprobe_duration(str(input_file))
    if duration <= 0:
        return False
    start = max(0.0, float(trim_head))
    end_time = max(0.0, duration - float(trim_tail))
    if end_time <= start:
        return False

    output_file.parent.mkdir(parents=True, exist_ok=True)

    if reencode:
        cmd = [
            'ffmpeg', '-y', '-i', str(input_file),
            '-ss', f'{start:.3f}', '-to', f'{end_time:.3f}',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(output_file)
        ]
    else:
        cmd = [
            'ffmpeg', '-y', '-i', str(input_file),
            '-ss', f'{start:.3f}', '-to', f'{end_time:.3f}',
            '-c', 'copy', str(output_file)
        ]
    run_ffmpeg(cmd)
    return True


def split_file(input_file: Path, temp_dir: Path, segment_seconds: float) -> list[Path]:
    pattern = temp_dir / (input_file.stem + '_part_%03d' + input_file.suffix)
    cmd = [
        'ffmpeg', '-y', '-i', str(input_file),
        '-c', 'copy', '-map', '0', '-f', 'segment',
        '-segment_time', f'{segment_seconds:.3f}', '-reset_timestamps', '1',
        str(pattern)
    ]
    run_ffmpeg(cmd)
    parts = sorted(temp_dir.glob(input_file.stem + '_part_*' + input_file.suffix))
    return parts


def encode_to_mov(input_file: Path, output_file: Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y', '-i', str(input_file),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(output_file)
    ]
    run_ffmpeg(cmd)


def build_out_name(stem: str, index: int) -> str:
    return f"{stem}_{index:03d}_.mov"


# ================= Template-based detection =================
def average_hash_from_frame(frame: np.ndarray) -> int:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)
    mean_val = float(np.mean(small))
    bits = (small > mean_val).astype(np.uint8).flatten()
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    return int(val)


def hamming64(a: int, b: int) -> int:
    return int(bin(a ^ b).count('1'))


def collect_hashes(video_path: Path, step_sec: float) -> Tuple[List[float], List[int]]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return [], []
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(1.0, cap.get(cv2.CAP_PROP_FPS))
    t = 0.0
    times: List[float] = []
    hashes: List[int] = []
    while t <= max(0.0, duration):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            t += step_sec
            continue
        hashes.append(average_hash_from_frame(frame))
        times.append(t)
        t += step_sec
    cap.release()
    return times, hashes


def median_hash(hashes: List[int]) -> int:
    if not hashes:
        return 0
    ones = [0] * 64
    for h in hashes:
        for i in range(64):
            if (h >> i) & 1:
                ones[i] += 1
    half = len(hashes) / 2.0
    out = 0
    for i in range(63, -1, -1):
        out <<= 1
        out |= 1 if ones[i] > half else 0
    return out


def scan_ad_positions(video_path: Path, ref_hash: int, step_sec: float, threshold_bits: int, suppress_window_sec: float) -> List[float]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(1.0, cap.get(cv2.CAP_PROP_FPS))
    t = 0.0
    matches: List[float] = []
    while t <= max(0.0, duration):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            t += step_sec
            continue
        h = average_hash_from_frame(frame)
        d = hamming64(h, ref_hash)
        if d <= threshold_bits:
            matches.append(t)
            t = t + max(step_sec, suppress_window_sec)
            continue
        t += step_sec
    cap.release()
    matches.sort()
    dedup: List[float] = []
    for mt in matches:
        if not dedup or (mt - dedup[-1]) >= (suppress_window_sec * 0.5):
            dedup.append(mt)
    return dedup


def cut_segment_to_mov(input_file: Path, start_sec: float, end_sec: float, output_file: Path) -> None:
    if end_sec <= start_sec:
        return
    output_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y', '-i', str(input_file),
        '-ss', f'{start_sec:.3f}', '-to', f'{end_sec:.3f}',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(output_file)
    ]
    run_ffmpeg(cmd)


def process_video_by_template(input_file: Path, output_dir: Path, template_file: Path, step_sec: float, threshold_bits: int, min_interval_sec: float, min_duration: float) -> List[Path]:
    created: List[Path] = []
    tmpl_times, tmpl_hashes = collect_hashes(template_file, step_sec=max(0.25, step_sec))
    if not tmpl_hashes:
        return created
    tmpl_hash = median_hash(tmpl_hashes)
    tmpl_dur = ffprobe_duration(str(template_file))
    if tmpl_dur <= 0:
        tmpl_dur = max(1.0, len(tmpl_hashes) * max(0.25, step_sec))

    suppress = max(min_interval_sec, tmpl_dur * 0.8)
    ad_positions = scan_ad_positions(input_file, tmpl_hash, step_sec=step_sec, threshold_bits=threshold_bits, suppress_window_sec=suppress)
    if len(ad_positions) < 2:
        return created

    seg_index = 1
    for i in range(len(ad_positions) - 1):
        seg_start = ad_positions[i] + tmpl_dur
        seg_end = ad_positions[i + 1]
        if (seg_end - seg_start) < max(0.0, float(min_duration)):
            continue
        out_name = build_out_name(input_file.stem, seg_index)
        out_path = output_dir / out_name
        cut_segment_to_mov(input_file, seg_start, seg_end, out_path)
        if ffprobe_duration(str(out_path)) >= max(0.0, float(min_duration)):
            created.append(out_path)
            seg_index += 1
        else:
            try:
                out_path.unlink()
            except Exception:
                pass
    return created


# ================= NEW: Template Selection =================
def count_ad_matches(video_path: Path, template_file: Path, step_sec: float, threshold_bits: int) -> int:
    tmpl_times, tmpl_hashes = collect_hashes(template_file, step_sec=max(0.25, step_sec))
    if not tmpl_hashes:
        return 0
    ref_hash = median_hash(tmpl_hashes)
    tmpl_dur = ffprobe_duration(str(template_file))
    if tmpl_dur <= 0:
        tmpl_dur = max(1.0, len(tmpl_hashes) * max(0.25, step_sec))
    suppress = max(10.0, tmpl_dur * 0.8)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(1.0, cap.get(cv2.CAP_PROP_FPS))
    t = 0.0
    count = 0
    while t <= duration:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            t += step_sec
            continue
        h = average_hash_from_frame(frame)
        if hamming64(h, ref_hash) <= threshold_bits:
            count += 1
            t += suppress
            continue
        t += step_sec
    cap.release()
    return count


def select_best_template(video_path: Path, template_files: List[Path], step_sec: float, threshold_bits: int) -> Path | None:
    results = []
    for tmpl in template_files:
        try:
            matches = count_ad_matches(video_path, tmpl, step_sec, threshold_bits)
            if matches > 0:
                results.append((matches, tmpl))
                print(f"  [Template Test] {tmpl.name}: {matches} match(es)")
        except Exception as e:
            print(f"  [Template Error] {tmpl.name}: {e}", file=sys.stderr)

    if not results:
        return None
    results.sort(key=lambda x: (-x[0], x[1].name))
    best = results[0][1]
    print(f"  [Selected] {best.name} with {results[0][0]} match(es)")
    return best
# =========================================================


def process_video(input_file: Path, output_dir: Path, segment_seconds: float, trim_head: float, trim_tail: float, reencode: bool, min_duration: float) -> list[Path]:
    created: list[Path] = []
    if segment_seconds and segment_seconds > 0:
        with tempfile.TemporaryDirectory(prefix='seg_') as td:
            td_path = Path(td)
            parts = split_file(input_file, td_path, segment_seconds)
            if not parts:
                return created
            for idx, part in enumerate(parts, start=1):
                duration = ffprobe_duration(str(part))
                if duration <= 0:
                    continue
                out_name = build_out_name(input_file.stem, idx)
                out_path = output_dir / out_name
                if trim_head or trim_tail:
                    ok = trim_file(part, out_path, trim_head, trim_tail, True)
                    if not ok:
                        continue
                else:
                    encode_to_mov(part, out_path)
                if ffprobe_duration(str(out_path)) < max(0.0, float(min_duration)):
                    try:
                        out_path.unlink()
                    except Exception:
                        pass
                    continue
                created.append(out_path)
    else:
        out_name = build_out_name(input_file.stem, 1)
        out_path = output_dir / out_name
        if trim_head or trim_tail:
            ok = trim_file(input_file, out_path, trim_head, trim_tail, True)
            if ok and ffprobe_duration(str(out_path)) >= max(0.0, float(min_duration)):
                created.append(out_path)
        else:
            encode_to_mov(input_file, out_path)
            if ffprobe_duration(str(out_path)) >= max(0.0, float(min_duration)):
                created.append(out_path)
    return created


def iter_videos(input_dir: Path):
    for root, _dirs, files in os.walk(input_dir):
        for name in files:
            ext = Path(name).suffix.lower()
            if ext in ALLOWED_EXTS:
                yield Path(root) / name


def main():
    parser = argparse.ArgumentParser(description='Segment videos by detecting ad/logo clips.')
    parser.add_argument('--input', required=True, help='Input file or folder')
    parser.add_argument('--output', required=True, help='Output folder')
    parser.add_argument('--segment-duration', type=float, default=0.0, help='Fixed segment length (seconds)')
    parser.add_argument('--trim-head', type=float, default=0.0, help='Trim start of each segment')
    parser.add_argument('--trim-tail', type=float, default=0.0, help='Trim end of each segment')
    parser.add_argument('--min-duration', type=float, default=0.5, help='Drop short clips')
    parser.add_argument('--reencode', action='store_true', help='Re-encode for precision')

    parser.add_argument('--template', type=str, default='', help='Single template file')
    parser.add_argument('--template-dir', type=str, default='', help='Folder of template files (auto-select best)')

    parser.add_argument('--detect-step', type=float, default=0.5, help='Frame scan interval')
    parser.add_argument('--detect-threshold', type=int, default=50, help='Hamming distance threshold')
    parser.add_argument('--detect-min-gap', type=float, default=120.0, help='Min gap between ads')

    args = parser.parse_args()

    # === XỬ LÝ TEMPLATE ===
    template_files: List[Path] = []
    use_template = False

    if args.template and args.template_dir:
        print("ERROR: Use --template OR --template-dir, not both.", file=sys.stderr)
        sys.exit(1)

    if args.template:
        tmpl_path = Path(args.template).expanduser().resolve()
        if not tmpl_path.exists() or tmpl_path.suffix.lower() not in ALLOWED_EXTS:
            print(f"ERROR: Invalid template file: {tmpl_path}", file=sys.stderr)
            sys.exit(1)
        template_files = [tmpl_path]
        use_template = True
        print(f"[INFO] Using template: {tmpl_path.name}")

    if args.template_dir:
        tmpl_dir = Path(args.template_dir).expanduser().resolve()
        if not tmpl_dir.is_dir():
            print(f"ERROR: Template dir not found: {tmpl_dir}", file=sys.stderr)
            sys.exit(1)
        template_files = [p for p in tmpl_dir.iterdir() if p.is_file() and p.suffix.lower() in ALLOWED_EXTS]
        if not template_files:
            print(f"ERROR: No video files in template dir: {tmpl_dir}", file=sys.stderr)
            sys.exit(1)
        use_template = True
        print(f"[INFO] Found {len(template_files)} template(s) in {tmpl_dir}")

    # === XỬ LÝ INPUT ===
    in_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.output).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not in_path.exists():
        print(f'ERROR: Input path not found: {in_path}', file=sys.stderr)
        sys.exit(1)

    require_ffmpeg()

    to_process: List[Path] = []
    if in_path.is_file():
        if in_path.suffix.lower() in ALLOWED_EXTS:
            to_process.append(in_path)
        else:
            print(f'Skip unsupported file: {in_path.name}', file=sys.stderr)
    else:
        for video_path in iter_videos(in_path):
            to_process.append(video_path)

    total_inputs = total_outputs = 0

    for video_path in to_process:
        total_inputs += 1
        try:
            if use_template:
                if len(template_files) == 1:
                    best_template = template_files[0]
                else:
                    best_template = select_best_template(
                        video_path, template_files,
                        step_sec=max(0.25, float(args.detect_step)),
                        threshold_bits=max(0, min(64, int(args.detect_threshold)))
                    )
                    if not best_template:
                        print(f'[SKIP] {video_path.name}: No template matched', file=sys.stderr)
                        continue

                outputs = process_video_by_template(
                    video_path, out_dir, best_template,
                    step_sec=max(0.25, float(args.detect_step)),
                    threshold_bits=max(0, min(64, int(args.detect_threshold))),
                    min_interval_sec=max(0.1, float(args.detect_min_gap)),
                    min_duration=float(args.min_duration),
                )
            else:
                outputs = process_video(
                    video_path, out_dir,
                    args.segment_duration, args.trim_head, args.trim_tail,
                    args.reencode, args.min_duration
                )

            total_outputs += len(outputs)
            print(f'[OK] {video_path.name} -> {len(outputs)} file(s)')
        except Exception as e:
            print(f'[ERR] {video_path.name}: {e}', file=sys.stderr)

    print(f'Done. Processed {total_inputs} videos -> {total_outputs} outputs into {out_dir}')


if __name__ == '__main__':
    main()