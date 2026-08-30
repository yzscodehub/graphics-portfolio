from __future__ import annotations

import json
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / "src/data/resume-content.json").read_text(encoding="utf-8"))
OUTPUT_DIR = ROOT / "public/resume"
INK, MUTED, SIGNAL = colors.HexColor("#151A1B"), colors.HexColor("#536166"), colors.HexColor("#159B80")
AMBER, LINE = colors.HexColor("#B87813"), colors.HexColor("#C9D0CE")


def public_profile() -> dict[str, str | bool]:
    handle = os.environ.get("PUBLIC_HANDLE", "YOUR_HANDLE")
    email = os.environ.get("PUBLIC_EMAIL", "PUBLIC_EMAIL")
    github_name = os.environ.get("GITHUB_USERNAME", "GITHUB_USERNAME")
    return {"handle": handle, "email": email, "github": f"https://github.com/{github_name}", "draft": "YOUR_" in handle or "PUBLIC_" in email or "GITHUB_" in github_name}


def page_decor(canvas, doc, locale: str, draft: bool) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(colors.HexColor("#080B0D"))
    canvas.rect(0, height - 18 * mm, width, 18 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#57E3C2"))
    canvas.setFont("Helvetica", 7)
    canvas.drawString(18 * mm, height - 11 * mm, "GRAPHICS SYSTEMS / PUBLIC RESUME")
    canvas.setFillColor(colors.HexColor("#8C9A9F"))
    canvas.drawRightString(width - 18 * mm, height - 11 * mm, f"{locale} / {doc.page}")
    if draft:
        canvas.setFillColor(colors.HexColor("#D86652"))
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawRightString(width - 18 * mm, 10 * mm, "DRAFT - PUBLIC IDENTITY PENDING")
    canvas.restoreState()


def build(locale: str) -> Path:
    is_zh = locale == "zh-CN"
    profile = public_profile()
    font, bold = ("MicrosoftYaHei", "MicrosoftYaHeiBold") if is_zh else ("Helvetica", "Helvetica-Bold")
    output = OUTPUT_DIR / f"resume-{locale}.pdf"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Title", parent=styles["Title"], fontName=bold, fontSize=25, leading=28, textColor=INK, spaceAfter=4 * mm)
    role = ParagraphStyle("Role", parent=styles["Normal"], fontName=font, fontSize=11, leading=14, textColor=SIGNAL, spaceAfter=3 * mm)
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName=font, fontSize=8.8, leading=12.4, textColor=INK, spaceAfter=2.2 * mm)
    small = ParagraphStyle("Small", parent=body, fontSize=7.4, leading=10, textColor=MUTED)
    heading = ParagraphStyle("Heading", parent=styles["Heading2"], fontName=bold, fontSize=12, leading=15, textColor=INK, spaceBefore=4 * mm, spaceAfter=2.5 * mm)
    label = ParagraphStyle("Label", parent=small, fontName=bold, fontSize=6.5, leading=8, textColor=AMBER, spaceAfter=1.2 * mm)
    story = [Spacer(1, 8 * mm), Paragraph(str(profile["handle"]), title), Paragraph("图形系统工程师" if is_zh else "Graphics Systems Engineer", role), Paragraph(f'{profile["email"]} &nbsp;&nbsp; {profile["github"]}', small), Spacer(1, 4 * mm), Paragraph("简介" if is_zh else "PROFILE", label), Paragraph(DATA["summary"][locale], body)]
    skill_cells = [[Paragraph(item["label"][locale], label), Paragraph(" / ".join(item["items"]), small)] for item in DATA["skills"]]
    skills = Table(skill_cells, colWidths=[34 * mm, 128 * mm], hAlign="LEFT")
    skills.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.extend([Paragraph("技能" if is_zh else "CAPABILITIES", heading), skills, Paragraph("经历" if is_zh else "EXPERIENCE", heading)])
    for entry in DATA["experience"]:
        block = [Paragraph(entry["period"][locale], label), Paragraph(entry["title"][locale], ParagraphStyle("Entry", parent=body, fontName=bold, fontSize=10.5, leading=13, spaceAfter=1.5 * mm))]
        block.extend(Paragraph(f"• {bullet}", body) for bullet in entry["bullets"][locale])
        block.extend([Paragraph(" / ".join(entry["technologies"]), small), Spacer(1, 2 * mm)])
        story.append(KeepTogether(block))
    story.append(Paragraph("公开实验" if is_zh else "PUBLIC LAB", heading))
    story.extend(Paragraph(f"• {item}", body) for item in DATA["highlights"][locale])
    doc = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=22 * mm, bottomMargin=16 * mm, title=f"{profile['handle']} - Resume", author=str(profile["handle"]))
    doc.build(story, onFirstPage=lambda c, d: page_decor(c, d, locale, bool(profile["draft"])), onLaterPages=lambda c, d: page_decor(c, d, locale, bool(profile["draft"])))
    return output


def main() -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    pdfmetrics.registerFont(TTFont("MicrosoftYaHei", "C:/Windows/Fonts/msyh.ttc", subfontIndex=0))
    pdfmetrics.registerFont(TTFont("MicrosoftYaHeiBold", "C:/Windows/Fonts/msyhbd.ttc", subfontIndex=0))
    for locale in ("zh-CN", "en"):
        print(build(locale))


if __name__ == "__main__":
    main()
