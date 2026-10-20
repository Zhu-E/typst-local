"""Converts a PDF into an editable Word document that keeps the PDF's layout.

Usage: pdf2docx_convert.py INPUT.pdf OUTPUT.docx [WORKERS]

Used by the server's "Download → Word" (see server/docx.js).
"""
import sys

from pdf2docx import Converter


def main():
    src, dst = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    converter = Converter(src)
    try:
        # Only rebuild real (bordered) tables; aligned text stays text, which
        # is much easier to edit than layout tables.
        converter.convert(dst, parse_stream_table=False, multi_processing=workers > 1, cpu_count=workers)
    finally:
        converter.close()


if __name__ == "__main__":
    main()
