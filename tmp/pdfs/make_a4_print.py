from __future__ import annotations

from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation
from pypdf._page import PageObject
from reportlab.pdfgen import canvas


SOURCE = Path("/Users/feihe/Downloads/2026年新五年级高端班入学诊断.pdf")
OUTPUT = Path(
    "/Users/feihe/Workspace/Relay/output/pdf/2026年新五年级高端班入学诊断_A4打印版.pdf"
)


def footer_overlay(width: float, height: float, page_no: int, total: int) -> PageObject:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))

    # Remove the original A3-centered footer, which would be split in half.
    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, width, 74, stroke=0, fill=1)

    # Hide the original center divider at the new outer page edge.
    pdf.rect(0, 0, 2, height, stroke=0, fill=1)
    pdf.rect(width - 2, 0, 2, height, stroke=0, fill=1)

    # Restore the lower rule after covering the old footer band.
    pdf.setStrokeColorRGB(0.08, 0.43, 0.41)
    pdf.setLineWidth(0.8)
    pdf.line(42, 67, width - 42, 67)

    # Add a compact, printer-safe replacement footer.
    pdf.setFillColorRGB(0.35, 0.35, 0.35)
    pdf.setFont("Helvetica", 8)
    pdf.drawCentredString(width / 2, 28, f"{page_no} / {total}")
    pdf.save()

    buffer.seek(0)
    return PdfReader(buffer).pages[0]


def main() -> None:
    reader = PdfReader(SOURCE)
    writer = PdfWriter()
    total = len(reader.pages) * 2
    out_page_no = 0

    for source_page in reader.pages:
        source_width = float(source_page.mediabox.width)
        source_height = float(source_page.mediabox.height)
        a4_width = source_width / 2

        for side in range(2):
            out_page_no += 1
            page = PageObject.create_blank_page(width=a4_width, height=source_height)
            page.merge_transformed_page(
                source_page,
                Transformation().translate(tx=-side * a4_width, ty=0),
            )
            page.merge_page(
                footer_overlay(a4_width, source_height, out_page_no, total)
            )
            writer.add_page(page)

    metadata = dict(reader.metadata or {})
    metadata.update(
        {
            "/Title": "2026年新五年级高端班入学诊断 - A4打印版",
            "/Subject": "由原始A3横向双栏版拆分为A4竖向打印版",
        }
    )
    writer.add_metadata(metadata)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("wb") as stream:
        writer.write(stream)


if __name__ == "__main__":
    main()
