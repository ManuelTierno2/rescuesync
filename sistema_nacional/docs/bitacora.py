"""Genera Bitacora_SistemaNacional.pdf (raíz del repo) desde docs/bitacora.json.
Uso: python3 sistema_nacional/docs/bitacora.py   (requiere reportlab)"""
import json, os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.units import cm
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, ListFlowable, ListItem, HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

here = os.path.dirname(os.path.abspath(__file__))
F = "/System/Library/Fonts/Supplemental/"
try:  # Arial embebida si está (macOS); si no, Helvetica estándar
    pdfmetrics.registerFont(TTFont("Arial", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("Arial-Bold", F + "Arial Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Italic", F + "Arial Italic.ttf"))
    pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial-Italic", boldItalic="Arial-Bold")
    REG, BOLD = "Arial", "Arial-Bold"
except Exception:
    REG, BOLD = "Helvetica", "Helvetica-Bold"

G = colors.HexColor("#1B5E45")
base = ParagraphStyle("b", fontName=REG, fontSize=9.5, leading=13.5, spaceAfter=5)
H1 = ParagraphStyle("h1", fontName=BOLD, fontSize=15, textColor=G, spaceBefore=6, spaceAfter=4, leading=19)
H2 = ParagraphStyle("h2", fontName=BOLD, fontSize=10.5, textColor=G, spaceBefore=7, spaceAfter=3)
meta = ParagraphStyle("m", parent=base, textColor=colors.HexColor("#666666"), fontSize=8.5)
cell = ParagraphStyle("c", parent=base, fontSize=9, leading=12, spaceAfter=0)

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def bullets(items):
    return ListFlowable([ListItem(Paragraph(esc(i), cell), leftIndent=14) for i in items], bulletType="bullet", start="•", bulletFontSize=8, leftIndent=14)

entries = json.load(open(os.path.join(here, "bitacora.json"), encoding="utf-8"))
s = [Paragraph("Sistema Nacional", ParagraphStyle("t", fontName=BOLD, fontSize=24, textColor=G, leading=28)),
     Paragraph("Bitácora de cambios - Entrega 3", ParagraphStyle("t2", fontName=BOLD, fontSize=13, spaceAfter=4)),
     Paragraph(f"{len(entries)} cambios registrados. El más reciente figura primero.", meta), Spacer(1, 8)]
for n, e in list(enumerate(entries, 1))[::-1]:
    blk = [HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#D5DDD8"), spaceBefore=4, spaceAfter=6),
           Paragraph(f"{n}. {esc(e['titulo'])}", H1), Paragraph(esc(e["fecha"]), meta), Paragraph(esc(e["resumen"]), base),
           Paragraph("Qué se hizo", H2), bullets(e["cambios"]),
           Paragraph("Archivos", H2), bullets(e["archivos"]),
           Paragraph("Verificación", H2), bullets(e["verificacion"])]
    if e.get("notas"): blk += [Paragraph("A tener en cuenta", H2), bullets(e["notas"])]
    s += blk + [Spacer(1, 10)]

def footer(c, d):
    c.setFont(REG, 8); c.setFillColor(colors.grey); c.drawRightString(letter[0] - 2 * cm, 1.2 * cm, f"Página {d.page}")
out = os.path.join(here, "..", "..", "Bitacora_SistemaNacional.pdf")
doc = BaseDocTemplate(out, pagesize=letter, leftMargin=2*cm, rightMargin=2*cm, topMargin=1.8*cm, bottomMargin=2*cm,
                      title="Sistema Nacional - Bitácora de cambios", author="RescueSync")
doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(2*cm, 2*cm, letter[0]-4*cm, letter[1]-3.8*cm)], onPage=footer)])
doc.build(s)
print(os.path.normpath(out))
