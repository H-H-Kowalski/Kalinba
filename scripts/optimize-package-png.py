#!/usr/bin/env python3
"""Re-encode PNGs losslessly. Keep pixels, dimensions and ancillary metadata.

Run with a Python environment containing Pillow. Dry run by default; --apply
updates smaller files only. No resizing, palette quantization or lossy encoding.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import zlib

from PIL import Image

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def chunks(data):
    assert data.startswith(SIGNATURE), 'Not a PNG'
    offset = len(SIGNATURE)
    result = []
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack('>I', data[offset + 8 + length:offset + 12 + length])[0]
        assert crc == zlib.crc32(kind + payload), 'PNG checksum mismatch'
        result.append((kind, payload))
        offset += length + 12
    assert offset == len(data)
    return result


def pack(parts):
    return SIGNATURE + b''.join(
        struct.pack('>I', len(payload)) + kind + payload +
        struct.pack('>I', zlib.crc32(kind + payload)) for kind, payload in parts)


def reencode(data):
    original_chunks = chunks(data)
    image = Image.open(io.BytesIO(data))
    # Restrict transformations to ordinary 8-bit RGB/RGBA files.
    if image.mode not in ('RGB', 'RGBA') or getattr(image, 'n_frames', 1) != 1:
        return data
    original_pixels = image.convert('RGBA').tobytes()
    ancillary = [(kind, payload) for kind, payload in original_chunks
                 if kind not in (b'IHDR', b'IDAT', b'IEND')]
    candidates = [data]
    variants = [image]
    # An all-255 alpha channel carries no information. Preserve real transparency.
    if (image.mode == 'RGBA' and image.getextrema()[3] == (255, 255)
            and not any(k in (b'tRNS', b'bKGD') for k, _ in ancillary)):
        variants.append(image.convert('RGB'))
    for variant in variants:
        output = io.BytesIO()
        variant.save(output, format='PNG', optimize=True, compress_level=9)
        encoded = chunks(output.getvalue())
        candidate = pack([encoded[0], *ancillary,
                          *(part for part in encoded if part[0] == b'IDAT'),
                          (b'IEND', b'')])
        decoded = Image.open(io.BytesIO(candidate))
        assert decoded.size == image.size
        assert decoded.convert('RGBA').tobytes() == original_pixels, 'Pixels changed'
        assert [(k, v) for k, v in chunks(candidate)
                if k not in (b'IHDR', b'IDAT', b'IEND')] == ancillary
        candidates.append(candidate)
    return min(candidates, key=len)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='assets/Image')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    rows = []
    for path in sorted(Path(args.directory).rglob('*.png')):
        before = path.read_bytes()
        after = reencode(before)
        if args.apply and len(after) < len(before):
            path.write_bytes(after)
        row = {'path': str(path), 'beforeBytes': len(before), 'afterBytes': len(after),
               'savedBytes': len(before) - len(after), 'pixelsIdentical': True,
               'metadataIdentical': True,
               'sha256': hashlib.sha256(after).hexdigest()}
        rows.append(row)
        print(f"{path}: {len(before)} -> {len(after)} bytes")
    report = {'applied': args.apply, 'savedBytes': sum(row['savedBytes'] for row in rows),
              'files': rows}
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"Total saved: {report['savedBytes']} bytes")


if __name__ == '__main__':
    main()
